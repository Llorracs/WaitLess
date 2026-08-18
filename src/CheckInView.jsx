/**
 * ============================================
 * WAITLESS — Check-In View (Door Scanner)
 * ============================================
 *
 * FILE: src/CheckInView.jsx
 *
 * Route: /{venueSlug}/checkin
 *
 * Door-staff facing scanner. PIN-gated using the venue's bartender_pin
 * (same one used for /manager and other staff views — set in admin).
 *
 * Flow:
 *   1. PIN gate (verifyBartenderPin against venues.bartender_pin)
 *   2. Event picker — staff selects which event they're working the door for
 *      (auto-selects if only one event is within ±12 hours)
 *   3. Scanner — camera feed via html5-qrcode, scans continuously
 *   4. On a successful QR decode, calls process_checkin RPC
 *   5. Big green/red feedback overlay with attendee name + reason text
 *   6. Tabs: SCAN / MANUAL / RECENT
 *
 * Multi-device:
 *   Any number of staff can open this URL at the same time. The RPC is
 *   atomic (row lock + status check) so concurrent scans of the same
 *   ticket can't double-check-in. The check-in counter at the top updates
 *   via Supabase realtime subscription scoped to this event_id, so all
 *   devices see the same totals in near real-time.
 *
 * Library:
 *   html5-qrcode (npm install html5-qrcode) — needs to be in package.json.
 *   If it isn't yet, add: "html5-qrcode": "^2.3.8"
 * ============================================
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  supabase,
  verifyBartenderPin,
} from "./lib/barOrderService";
import { Html5Qrcode } from "html5-qrcode";
import DemoStepGuide, { advanceDemoStep } from "./DemoStepGuide";

// ============================================================================
// CONSTANTS
// ============================================================================

const FEEDBACK_DURATION_SUCCESS = 1200;   // green flash auto-clears (ms)
const FEEDBACK_DURATION_ERROR   = 2500;   // red flash auto-clears (ms)
const RESCAN_COOLDOWN_MS        = 1500;   // ignore re-scans of same code within this window
const MAX_RECENT                = 15;     // recent check-ins shown in side log

// ============================================================================
// HELPERS
// ============================================================================

function formatRelativeTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function vibrateSuccess() {
  try { if (navigator.vibrate) navigator.vibrate(100); } catch {}
}
function vibrateError() {
  try { if (navigator.vibrate) navigator.vibrate([80, 60, 80]); } catch {}
}

// Map reason codes from the RPC to UI-friendly copy.
const REASON_COPY = {
  not_found:           "Ticket not found",
  wrong_venue:         "Wrong venue",
  wrong_event:         "Wrong event",
  event_missing:       "Event not found",
  doors_not_open:      "Doors not open yet",
  event_ended:         "Event has ended",
  already_checked_in:  "Already checked in",
  refunded:            "Refunded — not valid",
  invalid_status:      "Invalid ticket",
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CheckInView({ venue, BRAND }) {
  // ---- AUTH ----
  const [authenticated, setAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  // ---- EVENT PICKER ----
  const [events, setEvents] = useState(null); // null = loading
  const [selectedEvent, setSelectedEvent] = useState(null);

  // ---- SCAN STATE ----
  const [activeTab, setActiveTab] = useState("scan"); // scan | manual | recent
  const [feedback, setFeedback] = useState(null);     // {kind, text, subtext} | null
  const [recentScans, setRecentScans] = useState([]); // newest first
  const [stats, setStats] = useState({ checkedIn: 0, total: 0 });

  // ---- MANUAL LOOKUP ----
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState([]);
  const [manualSearching, setManualSearching] = useState(false);

  // ---- INTERNAL REFS ----
  const scannerRef = useRef(null);          // html5-qrcode instance
  const scannerDivId = "waitless-qr-scanner";
  const lastScanRef = useRef({ token: null, at: 0 }); // dedupe rapid re-scans

  // ==========================================================================
  // PIN HANDLER
  // ==========================================================================
  const handlePinCheck = async (fullPin) => {
    const valid = await verifyBartenderPin(venue.id, fullPin);
    if (valid) {
      setAuthenticated(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput("");
    }
  };

  // ==========================================================================
  // LOAD EVENTS WHEN AUTHED
  // ==========================================================================
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    async function loadEvents() {
      // Pull events for this venue that are within a reasonable check-in
      // window. We bias towards "happening right now or soon" — show
      // events whose starts_at is within ±2 days. Most door staff are
      // working a specific event right now, not browsing the catalog.
      const now = new Date();
      const start = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const end   = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from("events")
        .select("id, slug, name, starts_at, ends_at, doors_at, status")
        .eq("venue_id", venue.id)
        .gte("starts_at", start.toISOString())
        .lte("starts_at", end.toISOString())
        .order("starts_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to load events:", error);
        setEvents([]);
        return;
      }

      const list = data || [];
      setEvents(list);

      // Auto-select if there's exactly one event in the window
      if (list.length === 1) {
        setSelectedEvent(list[0]);
      }
    }

    loadEvents();
    return () => { cancelled = true; };
  }, [authenticated, venue.id]);

  // ==========================================================================
  // LOAD STATS FOR SELECTED EVENT + REALTIME SUBSCRIPTION
  // ==========================================================================
  useEffect(() => {
    if (!selectedEvent) return;
    let cancelled = false;

    async function refreshStats() {
      // Total = all non-refunded tickets for this event
      // Checked in = subset where status = 'checked_in'
      const { count: totalCount } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", selectedEvent.id)
        .neq("status", "refunded");

      const { count: checkedInCount } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", selectedEvent.id)
        .eq("status", "checked_in");

      if (cancelled) return;
      setStats({
        total: totalCount || 0,
        checkedIn: checkedInCount || 0,
      });
    }

    refreshStats();

    // Realtime subscription — any ticket status change in this event triggers
    // a stats refresh. Multi-device safe.
    const channel = supabase
      .channel(`tickets-checkin-${selectedEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${selectedEvent.id}`,
        },
        () => { if (!cancelled) refreshStats(); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [selectedEvent]);

  // ==========================================================================
  // QR SCANNER LIFECYCLE
  //
  // Starts when: authenticated && selectedEvent && activeTab === 'scan' && no feedback
  // Stops when:  any of those becomes false (including when feedback is showing,
  //              to prevent re-firing during the success/error display)
  // ==========================================================================
  useEffect(() => {
    if (!authenticated || !selectedEvent) return;
    if (activeTab !== "scan") return;
    if (feedback) return; // pause scanning while feedback is on-screen

    let stopped = false;
    let scanner = null;

    async function startScanner() {
      try {
        scanner = new Html5Qrcode(scannerDivId, { verbose: false });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            // Scan region as large as possible: ~85% of the shorter viewport
            // edge, computed against the actual full-screen container.
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              const size = Math.floor(minEdge * 0.85);
              return { width: size, height: size };
            },
            aspectRatio: window.innerWidth / window.innerHeight,
          },
          (decodedText) => {
            if (stopped) return;
            handleScannedToken(decodedText);
          },
          (_errMsg) => {
            // Per-frame decode failures are normal (most frames have no QR);
            // ignore quietly.
          }
        );
      } catch (err) {
        console.error("Camera start failed:", err);
        setFeedback({
          kind: "error",
          text: "CAMERA UNAVAILABLE",
          subtext: "Tap 'MANUAL' to look up tickets by name.",
          autoHide: false,
        });
      }
    }

    startScanner();

    return () => {
      stopped = true;
      if (scanner) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [authenticated, selectedEvent, activeTab, feedback]);

  // ==========================================================================
  // SCAN HANDLER
  // ==========================================================================
  const handleScannedToken = useCallback(async (rawToken) => {
    const token = (rawToken || "").trim();
    if (!token) return;

    // Dedupe — ignore the same token re-scanned within the cooldown window
    const now = Date.now();
    if (lastScanRef.current.token === token &&
        (now - lastScanRef.current.at) < RESCAN_COOLDOWN_MS) {
      return;
    }
    lastScanRef.current = { token, at: now };

    await processCheckin(token);
  }, [selectedEvent, venue.id, venue.owner_id]);

  // ==========================================================================
  // RPC CALL — used by both scanner and manual lookup
  // ==========================================================================
  const processCheckin = useCallback(async (qrToken) => {
    if (!selectedEvent) return;

    try {
      const { data, error } = await supabase.rpc("process_checkin", {
        p_qr_token: qrToken,
        p_event_id: selectedEvent.id,
        p_venue_id: venue.id,
        // venue.owner_id is the closest thing we have to "the person at
        // the door" without a real auth user. Logged for accountability.
        p_checked_in_by: venue.owner_id || null,
      });

      if (error) {
        console.error("RPC error:", error);
        vibrateError();
        setFeedback({
          kind: "error",
          text: "SYSTEM ERROR",
          subtext: error.message || "Try again",
        });
        scheduleClearFeedback(FEEDBACK_DURATION_ERROR);
        return;
      }

      // RPC returns jsonb with ok=true/false
      if (data?.ok) {
        vibrateSuccess();
        // Demo walkthrough: a real check-in just happened, so the guide's
        // next instruction is "scan the same ticket again". No-ops on any
        // venue that isn't 'demo'.
        if (venue.slug === "demo") advanceDemoStep("tickets", 3);
        setFeedback({
          kind: "success",
          text: "CHECKED IN",
          subtext: data.attendee_name || "",
        });
        setRecentScans((prev) => [
          {
            id: data.ticket_id,
            name: data.attendee_name || "(no name)",
            email: data.attendee_email,
            at: data.checked_in_at,
            kind: "success",
          },
          ...prev,
        ].slice(0, MAX_RECENT));
        scheduleClearFeedback(FEEDBACK_DURATION_SUCCESS);
      } else {
        vibrateError();
        const reasonText = REASON_COPY[data?.reason] || "REJECTED";

        // Subtext changes per reason — show useful context
        let subtext = data?.attendee_name || "";
        if (data?.reason === "already_checked_in" && data?.checked_in_at) {
          subtext = `${data.attendee_name || ""} — entered ${formatRelativeTime(data.checked_in_at)}`;
        } else if (data?.reason === "doors_not_open" && data?.doors_at) {
          const t = new Date(data.doors_at).toLocaleTimeString("en-US", {
            hour: "numeric", minute: "2-digit",
          });
          subtext = `Doors open at ${t}`;
        }

        setFeedback({
          kind: "error",
          text: reasonText.toUpperCase(),
          subtext,
        });

        setRecentScans((prev) => [
          {
            id: data?.ticket_id || `r-${Date.now()}`,
            name: data?.attendee_name || "(no name)",
            email: data?.attendee_email,
            at: new Date().toISOString(),
            kind: "error",
            reason: data?.reason,
          },
          ...prev,
        ].slice(0, MAX_RECENT));

        scheduleClearFeedback(FEEDBACK_DURATION_ERROR);
      }
    } catch (err) {
      console.error("processCheckin threw:", err);
      vibrateError();
      setFeedback({
        kind: "error",
        text: "NETWORK ERROR",
        subtext: "Check connection and try again",
      });
      scheduleClearFeedback(FEEDBACK_DURATION_ERROR);
    }
  }, [selectedEvent, venue.id, venue.owner_id]);

  const feedbackTimerRef = useRef(null);
  const scheduleClearFeedback = useCallback((delay) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, delay);
  }, []);
  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  // ==========================================================================
  // MANUAL LOOKUP (debounced)
  // ==========================================================================
  useEffect(() => {
    if (activeTab !== "manual") return;
    if (!selectedEvent) return;

    const trimmed = manualQuery.trim();
    if (trimmed.length < 2) {
      setManualResults([]);
      setManualSearching(false);
      return;
    }

    setManualSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("find_tickets_for_checkin", {
          p_event_id: selectedEvent.id,
          p_venue_id: venue.id,
          p_query: trimmed,
        });

        if (error) {
          console.error("Manual lookup error:", error);
          setManualResults([]);
        } else {
          setManualResults(data || []);
        }
      } catch (err) {
        console.error("Manual lookup threw:", err);
        setManualResults([]);
      } finally {
        setManualSearching(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [manualQuery, activeTab, selectedEvent, venue.id]);

  // ==========================================================================
  // RENDER — PIN screen
  // ==========================================================================
  if (!authenticated) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div style={{ background: BRAND.darkGray, borderRadius: 24, padding: "36px 28px", maxWidth: 320, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, border: "1px solid #333" }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase" }}>
            Door Check-In
          </div>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={BRAND.accent} strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p style={{ fontSize: 13, color: BRAND.gray, textAlign: "center", margin: 0, lineHeight: 1.5 }}>
            Enter the venue PIN to begin scanning tickets.
          </p>
          <div style={{ display: "flex", gap: 12, margin: "8px 0" }}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: pinInput.length > i ? (pinError ? BRAND.danger : BRAND.accent) : "transparent",
                  border: `2px solid ${pinError ? BRAND.danger : pinInput.length > i ? BRAND.accent : "#444"}`,
                  transition: "all 0.15s ease",
                }}
              />
            ))}
          </div>
          {pinError && (
            <div style={{ fontSize: 12, color: BRAND.danger, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>
              WRONG PIN
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%" }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"].map((key, idx) => (
              <button
                key={idx}
                onClick={() => {
                  if (key === null) return;
                  setPinError(false);
                  if (key === "del") {
                    setPinInput((p) => p.slice(0, -1));
                  } else {
                    const next = pinInput + String(key);
                    setPinInput(next);
                    if (next.length === 4) {
                      setTimeout(() => handlePinCheck(next), 200);
                    }
                  }
                }}
                style={{
                  padding: "16px",
                  background: key === null ? "transparent" : "#222",
                  border: key === null ? "none" : "1px solid #333",
                  borderRadius: 12,
                  color: key === "del" ? BRAND.dimText : BRAND.white,
                  fontFamily: key === "del" ? "'Space Mono', monospace" : "'Oswald', sans-serif",
                  fontSize: key === "del" ? 11 : 22,
                  fontWeight: 600,
                  cursor: key === null ? "default" : "pointer",
                  letterSpacing: key === "del" ? 1 : 0,
                  visibility: key === null ? "hidden" : "visible",
                }}
              >
                {key === "del" ? "DEL" : key}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // RENDER — Event picker
  // ==========================================================================
  if (!selectedEvent) {
    if (events === null) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #222", borderTopColor: BRAND.accent, animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      );
    }

    return (
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "28px 20px 60px" }}>
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 4, margin: 0, background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            {venue.name.toUpperCase()}
          </h1>
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 3, color: BRAND.accent, margin: "4px 0 0" }}>
            DOOR CHECK-IN
          </p>
        </div>

        <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase", marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${BRAND.accentMuted}` }}>
          Which event tonight?
        </h2>

        {events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: BRAND.gray }}>
            <div style={{ fontSize: 40, opacity: 0.3, marginBottom: 12 }}>📅</div>
            <p style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 2, margin: 0 }}>NO EVENTS NEARBY</p>
            <p style={{ fontSize: 12, color: BRAND.dimText, marginTop: 8, lineHeight: 1.5 }}>
              No events with a start time within the next 2 days. Check that your event is published in admin.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {events.map((ev) => {
              const start = new Date(ev.starts_at);
              const dateLabel = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              const timeLabel = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
              return (
                <button
                  key={ev.id}
                  onClick={() => setSelectedEvent(ev)}
                  style={{
                    background: BRAND.cardBg, borderRadius: 14, padding: "16px 18px",
                    border: "1px solid #222", textAlign: "left", cursor: "pointer",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}
                >
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 17, fontWeight: 600, letterSpacing: 0.5, color: BRAND.white }}>
                    {ev.name}
                  </div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: BRAND.gray, letterSpacing: 1 }}>
                    {dateLabel.toUpperCase()} · {timeLabel}
                    {ev.status !== "published" && (
                      <span style={{ marginLeft: 10, color: BRAND.warning }}>{ev.status?.toUpperCase()}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ==========================================================================
  // RENDER — Main check-in UI
  // ==========================================================================
  const isScanTab = activeTab === "scan";

  return (
    <div style={{ minHeight: "100vh", background: BRAND.black, color: BRAND.white }}>
      {/* Forces the html5-qrcode video (and its internal canvas overlay) to
          fill the container edge-to-edge instead of the library's own
          computed inline size. `100dvh` falls back to `100vh` on browsers
          that don't support it (declared first, overridden second). */}
      <style>{`
        #${scannerDivId} {
          height: 100vh;
          height: 100dvh;
        }
        #${scannerDivId} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
      `}</style>

      {/* Full-screen camera feed — only mounted while the SCAN tab is active.
          Sits behind the header/caption overlays (zIndex 1). */}
      {isScanTab && (
        <div
          id={scannerDivId}
          style={{
            position: "fixed", top: 0, left: 0, right: 0,
            width: "100vw", height: "100vh",
            background: "#000", zIndex: 1,
          }}
        />
      )}

      {/* Header — event name + stats + change-event button. Floats as a
          translucent overlay over the camera feed on the SCAN tab; solid
          and in-flow (sticky) on MANUAL / RECENT. Safe-area padding keeps
          it clear of the iPhone notch/status bar in installed-PWA mode. */}
      <div style={{
        position: isScanTab ? "fixed" : "sticky",
        top: 0, left: 0, right: 0, zIndex: 100,
        background: isScanTab ? "rgba(10,10,10,0.6)" : BRAND.black,
        backdropFilter: isScanTab ? "blur(14px)" : undefined,
        WebkitBackdropFilter: isScanTab ? "blur(14px)" : undefined,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}>
          <div style={{
            padding: "10px 16px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: BRAND.accent, letterSpacing: 2 }}>
                CHECK-IN
              </div>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: 1, color: BRAND.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedEvent.name}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, marginRight: 10 }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, color: BRAND.accent, lineHeight: 1 }}>
                {stats.checkedIn} / {stats.total}
              </div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 8, color: BRAND.dimText, letterSpacing: 1 }}>
                CHECKED IN
              </div>
            </div>
            <button
              onClick={() => { setSelectedEvent(null); setRecentScans([]); }}
              style={{ background: "transparent", border: "1px solid #333", borderRadius: 10, padding: "6px 10px", color: BRAND.gray, fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 1, cursor: "pointer" }}
            >
              CHANGE
            </button>
          </div>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 0, borderTop: isScanTab ? "1px solid rgba(255,255,255,0.08)" : "none" }}>
            {[
              { key: "scan",   label: "SCAN" },
              { key: "manual", label: "MANUAL" },
              { key: "recent", label: `RECENT (${recentScans.length})` },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1, padding: "12px 8px", background: "transparent",
                  border: "none", borderBottom: activeTab === tab.key ? `2px solid ${BRAND.accent}` : "2px solid transparent",
                  color: activeTab === tab.key ? BRAND.accent : BRAND.gray,
                  fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 2, cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* SCAN TAB caption — floats over the bottom of the camera feed */}
      {isScanTab && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
          display: "flex", justifyContent: "center",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          pointerEvents: "none",
        }}>
          <span style={{
            background: "rgba(10,10,10,0.6)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
            padding: "10px 18px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.1)",
            fontSize: 12, color: BRAND.gray, fontFamily: "'Space Mono', monospace", letterSpacing: 1,
          }}>
            POINT CAMERA AT TICKET QR CODE
          </span>
        </div>
      )}

      {/* MANUAL TAB */}
      {activeTab === "manual" && (
        <div style={{ padding: "16px 16px 80px" }}>
          <input
            type="search"
            placeholder="Search by name or email…"
            value={manualQuery}
            onChange={(e) => setManualQuery(e.target.value)}
            autoFocus
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 12,
              background: BRAND.cardBg, border: "1px solid #333",
              color: BRAND.white, fontFamily: "'Inter', sans-serif", fontSize: 15,
              outline: "none", boxSizing: "border-box",
            }}
          />

          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {manualSearching && (
              <div style={{ textAlign: "center", color: BRAND.gray, fontSize: 12, padding: "20px 0", fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>
                SEARCHING…
              </div>
            )}
            {!manualSearching && manualQuery.trim().length >= 2 && manualResults.length === 0 && (
              <div style={{ textAlign: "center", color: BRAND.gray, fontSize: 12, padding: "20px 0", fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>
                NO MATCHES
              </div>
            )}
            {!manualSearching && manualResults.map((t) => {
              const isCheckedIn = t.status === "checked_in";
              const isRefunded = t.status === "refunded";
              return (
                <div
                  key={t.ticket_id}
                  style={{
                    background: BRAND.cardBg, borderRadius: 12, padding: "12px 14px",
                    border: "1px solid #222", display: "flex", justifyContent: "space-between",
                    alignItems: "center", gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 500, color: BRAND.white, marginBottom: 2 }}>
                      {t.attendee_name || "(no name)"}
                    </div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.gray, letterSpacing: 0.5 }}>
                      {t.attendee_email} · {t.ticket_type_name}
                    </div>
                    {isCheckedIn && (
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.success, letterSpacing: 1, marginTop: 4 }}>
                        ✓ CHECKED IN {formatRelativeTime(t.checked_in_at).toUpperCase()}
                      </div>
                    )}
                    {isRefunded && (
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.danger, letterSpacing: 1, marginTop: 4 }}>
                        REFUNDED
                      </div>
                    )}
                  </div>
                  {!isCheckedIn && !isRefunded && (
                    <button
                      onClick={() => processCheckin(t.qr_token)}
                      style={{
                        padding: "10px 14px", background: BRAND.success, border: "none",
                        borderRadius: 10, color: "#000", fontFamily: "'Oswald', sans-serif",
                        fontSize: 12, fontWeight: 700, letterSpacing: 2, cursor: "pointer", whiteSpace: "nowrap",
                      }}
                    >
                      CHECK IN
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* RECENT TAB */}
      {activeTab === "recent" && (
        <div style={{ padding: "16px 16px 80px" }}>
          {recentScans.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: BRAND.gray }}>
              <div style={{ fontSize: 40, opacity: 0.3, marginBottom: 12 }}>🎟️</div>
              <p style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 2, margin: 0 }}>NO SCANS YET</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recentScans.map((scan) => (
                <div
                  key={scan.id + scan.at}
                  style={{
                    padding: "10px 14px", borderRadius: 10,
                    background: scan.kind === "success" ? `${BRAND.success}11` : `${BRAND.danger}11`,
                    border: `1px solid ${scan.kind === "success" ? BRAND.success + "44" : BRAND.danger + "44"}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, color: BRAND.white, fontWeight: 500 }}>
                      {scan.name}
                    </div>
                    {scan.email && (
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: BRAND.dimText, letterSpacing: 0.5 }}>
                        {scan.email}
                      </div>
                    )}
                    {scan.reason && (
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: BRAND.danger, letterSpacing: 1, marginTop: 2 }}>
                        {(REASON_COPY[scan.reason] || scan.reason).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.gray, whiteSpace: "nowrap" }}>
                    {formatRelativeTime(scan.at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* DEMO WALKTHROUGH GUIDE — renders only on the 'demo' venue.
          On the SCAN tab it's lifted clear of the camera caption pill so the
          two don't stack on top of each other. The feedback overlay below
          sits at a higher zIndex, so a green/red flash still covers it. */}
      <DemoStepGuide venue={venue} BRAND={BRAND} track="tickets" bottomOffset={isScanTab ? 72 : 0} />

      {/* FEEDBACK OVERLAY — appears over everything when a scan completes */}
      {feedback && (
        <div
          onClick={() => setFeedback(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 500,
            background: feedback.kind === "success" ? `${BRAND.success}ee` : `${BRAND.danger}ee`,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: 24, textAlign: "center", cursor: "pointer",
            animation: "fbFadeIn 0.15s ease",
          }}
        >
          <style>{`@keyframes fbFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
          <div style={{ fontSize: 80, marginBottom: 8, lineHeight: 1 }}>
            {feedback.kind === "success" ? "✓" : "✕"}
          </div>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 32, fontWeight: 700, letterSpacing: 4, color: "#000", margin: "8px 0", lineHeight: 1.1 }}>
            {feedback.text}
          </div>
          {feedback.subtext && (
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 500, color: "#000", letterSpacing: 1, marginTop: 4, maxWidth: 480 }}>
              {feedback.subtext}
            </div>
          )}
          <div style={{ marginTop: 24, fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#000", opacity: 0.6, letterSpacing: 2 }}>
            TAP TO DISMISS
          </div>
        </div>
      )}
    </div>
  );
}
