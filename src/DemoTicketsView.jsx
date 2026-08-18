/**
 * ============================================
 * WAITLESS — Demo Ticketing Walkthrough
 * ============================================
 *
 * FILE: src/DemoTicketsView.jsx
 *
 * Rendered by the TICKETS tab of the /demo tab bar (App.jsx).
 *
 * A guided 3-step tour of the ticketing product:
 *
 *   Step 1 — SELECT: the real buyer-facing tier picker, reading the real
 *            events / ticket_types rows for the demo venue. The only thing
 *            swapped out is the checkout button: instead of POSTing to
 *            create-ticket-checkout.js and bouncing to Square's hosted
 *            page (a dead end for a demo), it calls demo-comp-ticket.js.
 *
 *   Step 2 — TICKET: the comp ticket's QR, shown immediately. This is a
 *            real tickets row with a real qr_token, optionally emailed.
 *
 *   Step 3 — SCAN: hand off to /demo/checkin with the PIN on screen. The
 *            scan is NOT simulated — it runs the same process_checkin RPC
 *            a paying venue uses, so the first scan genuinely turns green
 *            and a second scan of the same code genuinely rejects as
 *            already checked in.
 *
 * Props:
 *   - venue: the demo venue object (from App.jsx)
 *   - BRAND: theming object (from App.jsx)
 * ============================================
 */

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/barOrderService";
import DemoStepGuide, { advanceDemoStep, resetDemoStep } from "./DemoStepGuide";

// Mirrors MAX_TICKETS_PER_REQUEST in netlify/functions/demo-comp-ticket.js.
// The server is authoritative; this just keeps the stepper honest.
const MAX_DEMO_TICKETS = 2;

// The issued ticket is persisted so it survives leaving this tab. Without
// this, switching to PATRON/BAR (or reloading) unmounts the component and
// the QR is gone for good — with no way back short of issuing a new ticket.
// TTL matches the 24h comp sweep in demo-comp-ticket.cjs, so we never show
// a QR whose row the server has already deleted.
const TICKET_STORAGE_PREFIX = "waitless_demo_ticket_";
const TICKET_TTL_MS = 24 * 60 * 60 * 1000;

const STEPS = [
  { n: 1, label: "SELECT" },
  { n: 2, label: "YOUR TICKET" },
  { n: 3, label: "SCAN IT" },
];

// ============================================================================
// HELPERS
// ============================================================================

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatEventDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}

function formatEventTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function DemoTicketsView({ venue, BRAND }) {
  const [step, setStep] = useState(1);

  // ---- DATA ----
  const [event, setEvent] = useState(null);
  const [ticketTypes, setTicketTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // ---- SELECTION ----
  const [cart, setCart] = useState({});
  const [email, setEmail] = useState("");

  // ---- ISSUE ----
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState(null);
  const [issued, setIssued] = useState(null); // { tickets, emailed, event }

  // Index of the ticket being presented full-screen, or null.
  const [presenting, setPresenting] = useState(null);

  // The demo PIN is public by design — it's printed on the landing page too.
  const demoPin = venue.bartender_pin || "1234";

  const ticketStorageKey = `${TICKET_STORAGE_PREFIX}${venue.id}`;

  // ==========================================================================
  // RESTORE A PREVIOUSLY ISSUED TICKET
  //
  // Runs before the event load so someone returning from the scanner (or from
  // another demo tab) lands straight back on their ticket instead of an empty
  // picker.
  // ==========================================================================
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ticketStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.issued?.tickets?.length) return;
      if (Date.now() - (saved.savedAt || 0) > TICKET_TTL_MS) {
        localStorage.removeItem(ticketStorageKey);
        return;
      }
      setIssued(saved.issued);
      setStep(saved.step === 3 ? 3 : 2);
    } catch {
      try { localStorage.removeItem(ticketStorageKey); } catch {}
    }
  }, [ticketStorageKey]);

  // Persist whenever the ticket or step changes.
  useEffect(() => {
    if (!issued) return;
    try {
      localStorage.setItem(
        ticketStorageKey,
        JSON.stringify({ issued, step, savedAt: Date.now() })
      );
    } catch {}
  }, [issued, step, ticketStorageKey]);

  // ==========================================================================
  // LOAD THE DEMO EVENT + TIERS
  // ==========================================================================
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: evs, error: evErr } = await supabase
          .from("events")
          .select("*")
          .eq("venue_id", venue.id)
          .eq("status", "published")
          .order("starts_at", { ascending: true })
          .limit(1);

        if (evErr) throw evErr;
        if (!evs || evs.length === 0) {
          if (!cancelled) { setLoadError("no_event"); setLoading(false); }
          return;
        }

        const ev = evs[0];
        const { data: tts, error: ttErr } = await supabase
          .from("ticket_types")
          .select("*")
          .eq("event_id", ev.id)
          .eq("active", true)
          .order("sort_order");

        if (ttErr) throw ttErr;

        if (!cancelled) {
          setEvent(ev);
          setTicketTypes(tts || []);
          setLoading(false);
        }
      } catch (e) {
        console.error("Demo ticketing load failed:", e);
        if (!cancelled) { setLoadError("error"); setLoading(false); }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [venue.id]);

  // ==========================================================================
  // CART
  // ==========================================================================
  const cartQty = useMemo(
    () => Object.values(cart).reduce((s, q) => s + q, 0),
    [cart]
  );

  const cartFaceCents = useMemo(() => {
    return Object.entries(cart).reduce((sum, [ttId, qty]) => {
      const tt = ticketTypes.find((t) => t.id === ttId);
      return tt ? sum + tt.price_cents * qty : sum;
    }, 0);
  }, [cart, ticketTypes]);

  function updateQty(ttId, delta) {
    setCart((prev) => {
      const current = prev[ttId] || 0;
      const otherQty = Object.entries(prev)
        .filter(([id]) => id !== ttId)
        .reduce((s, [, q]) => s + q, 0);

      let next = Math.max(0, current + delta);
      next = Math.min(next, MAX_DEMO_TICKETS - otherQty);

      if (next === 0) {
        const { [ttId]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [ttId]: next };
    });
  }

  // ==========================================================================
  // ISSUE THE COMP TICKET
  // ==========================================================================
  async function handleGetDemoTicket() {
    if (cartQty === 0) return;
    setIssuing(true);
    setIssueError(null);

    try {
      const selections = Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([ticketTypeId, qty]) => ({ ticketTypeId, qty }));

      const resp = await fetch("/.netlify/functions/demo-comp-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueSlug: venue.slug,
          selections,
          email: email.trim() || null,
        }),
      });

      const data = await resp.json();

      if (!data.success) {
        setIssueError(data.error || "Could not issue a demo ticket. Try again.");
        setIssuing(false);
        return;
      }

      setIssued(data);
      setStep(2);
      setIssuing(false);
      // Ticket exists — the guide's next instruction is "go scan it".
      advanceDemoStep("tickets", 2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      console.error("Demo comp ticket failed:", e);
      setIssueError("Network error. Check your connection and try again.");
      setIssuing(false);
    }
  }

  function restart() {
    setIssued(null);
    setCart({});
    setEmail("");
    setIssueError(null);
    setStep(1);
    resetDemoStep("tickets");
    try { localStorage.removeItem(ticketStorageKey); } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ==========================================================================
  // RENDER — loading / error
  // ==========================================================================
  if (loading) {
    return (
      <Centered BRAND={BRAND}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          border: "3px solid #222", borderTopColor: BRAND.accent,
          animation: "spin 1s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: BRAND.dimText, letterSpacing: 2 }}>
          LOADING DEMO EVENT…
        </p>
      </Centered>
    );
  }

  if (loadError) {
    return (
      <Centered BRAND={BRAND}>
        <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, letterSpacing: 3, color: BRAND.white, margin: 0 }}>
          {loadError === "no_event" ? "NO DEMO EVENT YET" : "COULDN'T LOAD THE DEMO"}
        </h2>
        <p style={{ color: BRAND.gray, fontSize: 13, textAlign: "center", maxWidth: 400, lineHeight: 1.6 }}>
          {loadError === "no_event"
            ? "The demo venue doesn't have a published event yet. Seed one in Supabase and reload this page."
            : "Something went wrong loading the demo event. Try refreshing."}
        </p>
      </Centered>
    );
  }

  // ==========================================================================
  // RENDER — walkthrough
  // ==========================================================================
  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "20px 16px 80px" }}>
      {/* Intro */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.accent, letterSpacing: 3, marginBottom: 6 }}>
          PAPERLESS TICKETING
        </div>
        <h1 style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 24, fontWeight: 700,
          letterSpacing: 2, margin: "0 0 8px",
          background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          SELL A TICKET. SCAN IT AT THE DOOR.
        </h1>
        <p style={{ fontSize: 13, color: BRAND.gray, lineHeight: 1.6, margin: 0 }}>
          Three steps, start to finish. The ticket you get is a real ticket in a
          real database — the door scan at the end is not simulated.
        </p>
      </div>

      {/* Step indicator */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {STEPS.map((s) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <div key={s.n} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{
                height: 3, borderRadius: 2,
                background: active || done ? BRAND.accent : "#222",
              }} />
              <div style={{
                fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 1,
                color: active ? BRAND.accent : done ? BRAND.gray : BRAND.dimText,
              }}>
                {done ? "✓" : s.n}. {s.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* ================= STEP 1 — SELECT ================= */}
      {step === 1 && (
        <>
          <EventHeader event={event} venue={venue} BRAND={BRAND} />

          <SectionHeader BRAND={BRAND}>Select Tickets</SectionHeader>

          {ticketTypes.length === 0 ? (
            <div style={{
              padding: "32px 20px", textAlign: "center", background: BRAND.cardBg,
              border: "1px dashed #333", borderRadius: 14, color: BRAND.gray, fontSize: 13,
            }}>
              No ticket types set up on the demo event yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ticketTypes.map((tt) => (
                <TierCard
                  key={tt.id}
                  tt={tt}
                  qty={cart[tt.id] || 0}
                  cartQty={cartQty}
                  onDec={() => updateQty(tt.id, -1)}
                  onInc={() => updateQty(tt.id, +1)}
                  BRAND={BRAND}
                />
              ))}
            </div>
          )}

          {/* Honest note about what's being swapped */}
          <div style={{
            marginTop: 16, padding: "12px 14px", borderRadius: 10,
            background: `${BRAND.primary}11`, border: `1px solid ${BRAND.primary}33`,
            fontSize: 12, color: BRAND.gray, lineHeight: 1.6,
          }}>
            <strong style={{ color: BRAND.white }}>This is the real buyer screen.</strong> On a
            live venue the button below goes to Square checkout and the buyer pays{" "}
            {formatCents(cartFaceCents || (ticketTypes[0]?.price_cents ?? 0))}. For the demo
            we skip payment and comp you the ticket instead.
          </div>

          {/* Optional email */}
          <div style={{ marginTop: 20 }}>
            <label style={{
              display: "block", fontFamily: "'Oswald', sans-serif", fontSize: 11,
              fontWeight: 600, color: BRAND.gray, letterSpacing: 2,
              textTransform: "uppercase", marginBottom: 6,
            }}>
              Email (optional)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              inputMode="email"
              autoComplete="email"
              style={{
                width: "100%", padding: "12px 14px", background: "#0a0a0a",
                border: "1px solid #333", borderRadius: 8, color: BRAND.white,
                fontFamily: "'Inter', sans-serif", fontSize: 14,
                outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: 11, color: BRAND.dimText, marginTop: 4 }}>
              Leave blank if you'd rather not — the QR shows on the next screen either way.
            </div>
          </div>

          {issueError && (
            <div style={{
              marginTop: 16, padding: "14px 16px", background: "#e74c3c15",
              border: "1px solid #e74c3c44", borderRadius: 10,
              color: "#e74c3c", fontSize: 13, lineHeight: 1.5,
            }}>
              {issueError}
            </div>
          )}

          <button
            onClick={handleGetDemoTicket}
            disabled={cartQty === 0 || issuing}
            style={{
              marginTop: 20, width: "100%", padding: "18px",
              background: cartQty === 0 || issuing
                ? "#222"
                : `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
              border: "none", borderRadius: 14,
              color: cartQty === 0 || issuing ? BRAND.dimText : BRAND.white,
              fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
              letterSpacing: 3, cursor: cartQty === 0 || issuing ? "not-allowed" : "pointer",
              boxShadow: cartQty > 0 && !issuing ? `0 4px 30px ${BRAND.primaryGlow}` : "none",
              transition: "all 0.2s",
            }}
          >
            {issuing
              ? "ISSUING TICKET…"
              : cartQty === 0
                ? "SELECT A TICKET TO CONTINUE"
                : `GET A FREE DEMO TICKET${cartQty > 1 ? ` (${cartQty})` : ""}`}
          </button>

          <p style={{
            textAlign: "center", fontSize: 10, color: BRAND.dimText, marginTop: 12,
            fontFamily: "'Space Mono', monospace", letterSpacing: 1,
          }}>
            NO CARD REQUIRED · NO CHARGE
          </p>
        </>
      )}

      {/* ================= STEP 2 — YOUR TICKET ================= */}
      {step === 2 && issued && (
        <>
          <div style={{
            padding: "14px 16px", borderRadius: 12, marginBottom: 20,
            background: `${BRAND.success}15`, border: `1px solid ${BRAND.success}44`,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>✓</span>
            <div style={{ fontSize: 13, color: BRAND.white, lineHeight: 1.5 }}>
              <strong>Ticket issued.</strong>{" "}
              {issued.emailed
                ? "We also sent it to your email."
                : "It's on screen below — no email needed."}
            </div>
          </div>

          <SectionHeader BRAND={BRAND}>
            Your {issued.tickets.length > 1 ? "Tickets" : "Ticket"}
          </SectionHeader>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {issued.tickets.map((t, i) => (
              <TicketCard
                key={t.id}
                ticket={t}
                index={i}
                total={issued.tickets.length}
                size={240}
                onPresent={() => setPresenting(i)}
              />
            ))}
          </div>

          <div style={{
            marginTop: 20, padding: "14px 16px", borderRadius: 10,
            background: BRAND.cardBg, border: "1px solid #222",
            fontSize: 12, color: BRAND.gray, lineHeight: 1.6,
          }}>
            This QR is backed by a real row in the tickets table with status{" "}
            <strong style={{ color: BRAND.white }}>valid</strong>. Nothing about the next
            step is mocked — the scanner checks this exact token.
          </div>

          <button
            onClick={() => {
              setStep(3);
              // Advance on THIS device's tap. The scan itself happens on the
              // door device, which can't reach this device's localStorage,
              // so waiting for it would strand the guide on step 2 forever.
              advanceDemoStep("tickets", 3);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            style={{
              marginTop: 20, width: "100%", padding: "18px",
              background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
              border: "none", borderRadius: 14, color: BRAND.white,
              fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
              letterSpacing: 3, cursor: "pointer",
              boxShadow: `0 4px 30px ${BRAND.primaryGlow}`,
            }}
          >
            NEXT — SCAN IT AT THE DOOR
          </button>

          {/* Mid-pitch escape hatch: once a ticket has been checked in it can
              only ever show red again, so getting a fresh one is the only way
              to demo the green path a second time. */}
          <button
            onClick={restart}
            style={{
              marginTop: 10, width: "100%", padding: "14px",
              background: "transparent", border: "1px solid #333", borderRadius: 12,
              color: BRAND.gray, fontFamily: "'Oswald', sans-serif", fontSize: 13,
              fontWeight: 600, letterSpacing: 2, cursor: "pointer",
            }}
          >
            GET ANOTHER TICKET
          </button>
        </>
      )}

      {/* ================= STEP 3 — SCAN IT ================= */}
      {step === 3 && issued && (
        <>
          <SectionHeader BRAND={BRAND}>Scan It At The Door</SectionHeader>

          <div style={{ fontSize: 14, color: BRAND.gray, lineHeight: 1.7, marginBottom: 20 }}>
            Point a <strong style={{ color: BRAND.white }}>second device</strong> at the QR
            below. Only have one phone? Open the scanner, tap{" "}
            <strong style={{ color: BRAND.white }}>MANUAL</strong>, and search{" "}
            <strong style={{ color: BRAND.white }}>Demo Guest</strong> — it checks in the
            same way, through the same database.
          </div>

          {/* The QR stays on THIS screen. It's the thing being scanned, so
              hiding it behind a back button would make the instruction above
              impossible to follow on a single screen. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
            {issued.tickets.map((t, i) => (
              <TicketCard
                key={t.id}
                ticket={t}
                index={i}
                total={issued.tickets.length}
                size={200}
                onPresent={() => setPresenting(i)}
              />
            ))}
          </div>

          {/* PIN callout */}
          <div style={{
            padding: "18px 20px", borderRadius: 14, marginBottom: 16,
            background: BRAND.cardBg, border: `1px solid ${BRAND.accent}44`,
            textAlign: "center",
          }}>
            <div style={{
              fontFamily: "'Space Mono', monospace", fontSize: 9,
              color: BRAND.accent, letterSpacing: 3, marginBottom: 8,
            }}>
              DOOR PIN
            </div>
            <div style={{
              fontFamily: "'Oswald', sans-serif", fontSize: 36, fontWeight: 700,
              letterSpacing: 12, color: BRAND.white, lineHeight: 1,
            }}>
              {demoPin}
            </div>
            <div style={{ fontSize: 11, color: BRAND.dimText, marginTop: 8 }}>
              Enter this when the scanner asks for a PIN
            </div>
          </div>

          <a
            href={`/${venue.slug}/checkin`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block", width: "100%", padding: "18px", boxSizing: "border-box",
              background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
              border: "none", borderRadius: 14, color: BRAND.white,
              fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
              letterSpacing: 3, cursor: "pointer", textAlign: "center",
              textDecoration: "none", boxShadow: `0 4px 30px ${BRAND.primaryGlow}`,
            }}
          >
            OPEN THE DOOR SCANNER →
          </a>

          {/* The payoff instruction */}
          <div style={{
            marginTop: 20, padding: "16px 18px", borderRadius: 12,
            background: `${BRAND.accent}11`, border: `1px solid ${BRAND.accent}33`,
          }}>
            <div style={{
              fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
              letterSpacing: 2, color: BRAND.accent, marginBottom: 8,
            }}>
              TRY SCANNING IT TWICE
            </div>
            <div style={{ fontSize: 13, color: BRAND.gray, lineHeight: 1.7 }}>
              The first scan turns <strong style={{ color: BRAND.success }}>green</strong> and
              checks the ticket in. Scan the same code again and it turns{" "}
              <strong style={{ color: BRAND.danger }}>red</strong> — "already checked in,"
              with the time it was first used. That's the same atomic check that stops
              a screenshotted ticket getting two people through your door.
              <br /><br />
              This ticket is spent now — it can only show red from here. Tap{" "}
              <strong style={{ color: BRAND.white }}>GET ANOTHER TICKET</strong> below to
              run the green path again for the next person.
            </div>
          </div>

          <div style={{
            marginTop: 16, padding: "14px 16px", borderRadius: 10,
            background: BRAND.cardBg, border: "1px solid #222",
            fontSize: 12, color: BRAND.dimText, lineHeight: 1.6,
          }}>
            Demo tickets and their check-in status are cleared automatically after 24
            hours, so the demo always starts fresh.
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              onClick={() => { setStep(2); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              style={{
                flex: 1, padding: "14px",
                background: "transparent", border: `1px solid ${BRAND.accent}55`, borderRadius: 12,
                color: BRAND.accent, fontFamily: "'Oswald', sans-serif", fontSize: 13,
                fontWeight: 600, letterSpacing: 2, cursor: "pointer",
              }}
            >
              ← MY TICKET
            </button>
            <button
              onClick={restart}
              style={{
                flex: 1, padding: "14px",
                background: "transparent", border: "1px solid #333", borderRadius: 12,
                color: BRAND.gray, fontFamily: "'Oswald', sans-serif", fontSize: 13,
                fontWeight: 600, letterSpacing: 2, cursor: "pointer",
              }}
            >
              GET ANOTHER TICKET
            </button>
          </div>
        </>
      )}

      <DemoStepGuide venue={venue} BRAND={BRAND} track="tickets" />

      {/* Full-screen QR — sits above the step guide (zIndex 400) so the
          presentation surface is genuinely uncluttered while being scanned. */}
      {presenting != null && issued?.tickets?.[presenting] && (
        <PresentedTicket
          ticket={issued.tickets[presenting]}
          onClose={() => setPresenting(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * Full-bleed white screen showing nothing but the QR, for holding up to
 * someone else's scanner.
 *
 * This exists instead of opening a real browser tab: window.open() here
 * would fire after an await (issuing the ticket is async), which breaks the
 * user-gesture chain and gets blocked silently by mobile Safari. It's also
 * simply easier to scan — a phone-to-phone scan is much more reliable
 * against a large, high-contrast, undimmed target than a small QR sitting
 * inside a dark page.
 */
function PresentedTicket({ ticket, onClose }) {
  // Keep the screen awake while the QR is being scanned. Best-effort:
  // unsupported on some browsers, and the lock is dropped when the tab is
  // backgrounded, so we re-acquire on visibility change.
  useEffect(() => {
    let lock = null;
    let released = false;

    async function acquire() {
      try {
        if ("wakeLock" in navigator) {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Denied or unsupported — the QR still displays fine.
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible" && !released) acquire();
    }

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      try { lock?.release(); } catch {}
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 600, background: "#fff",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 20,
        padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px)",
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close full screen ticket"
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 16,
          width: 44, height: 44, borderRadius: 22,
          border: "1px solid #ddd", background: "#fff", color: "#666",
          fontSize: 20, lineHeight: 1, cursor: "pointer",
        }}
      >
        ✕
      </button>

      {/* Sized off the smaller viewport edge so it's as large as it can be
          in either orientation without overflowing. */}
      <img
        src={ticket.qrUrl}
        alt="Demo ticket QR code"
        style={{
          width: "min(86vw, 62vh)", height: "auto",
          imageRendering: "pixelated",
        }}
      />

      <div style={{
        fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#999",
        letterSpacing: 1, wordBreak: "break-all", textAlign: "center", maxWidth: 320,
      }}>
        {ticket.qrToken}
      </div>

      <div style={{
        fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
        letterSpacing: 2, color: "#1E4D8C", textAlign: "center",
      }}>
        HOLD THIS UP TO THE SCANNER
      </div>
    </div>
  );
}

function Centered({ children, BRAND }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "60vh", padding: 24, gap: 14,
      color: BRAND.white,
    }}>
      {children}
    </div>
  );
}

/**
 * The ticket itself. Rendered on step 2 (the reveal) and again on step 3
 * (where it's the thing actually being scanned) so the QR is never more
 * than a scroll away once issued.
 */
function TicketCard({ ticket, index, total, size = 240, onPresent }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 16, padding: "24px 20px",
      textAlign: "center",
    }}>
      <div style={{
        fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600,
        letterSpacing: 3, color: "#1E4D8C", textTransform: "uppercase",
        marginBottom: 4,
      }}>
        {ticket.ticketTypeName}
      </div>
      {total > 1 && (
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, color: "#888", marginBottom: 12 }}>
          Ticket {index + 1} of {total}
        </div>
      )}
      <img
        src={ticket.qrUrl}
        alt="Demo ticket QR code"
        width={size}
        height={size}
        style={{ display: "block", margin: "8px auto 0", maxWidth: "100%", height: "auto" }}
      />
      <div style={{
        fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#999",
        letterSpacing: 1, marginTop: 12, wordBreak: "break-all",
      }}>
        {ticket.qrToken}
      </div>

      {onPresent && (
        <button
          onClick={onPresent}
          style={{
            marginTop: 16, width: "100%", padding: "14px",
            background: "#0a0a0a", border: "none", borderRadius: 10, color: "#fff",
            fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700,
            letterSpacing: 2, cursor: "pointer",
          }}
        >
          SHOW FULL SCREEN TO SCAN
        </button>
      )}
    </div>
  );
}

function SectionHeader({ children, BRAND }) {
  return (
    <h2 style={{
      fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
      letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase",
      marginBottom: 12, paddingBottom: 8, marginTop: 24,
      borderBottom: `1px solid ${BRAND.accentMuted}`,
    }}>
      {children}
    </h2>
  );
}

function EventHeader({ event, venue, BRAND }) {
  return (
    <div style={{
      padding: "18px 20px", background: BRAND.cardBg, borderRadius: 14,
      border: "1px solid #222",
    }}>
      <div style={{
        fontFamily: "'Space Mono', monospace", fontSize: 10,
        color: BRAND.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6,
      }}>
        {venue.name}
      </div>
      <div style={{
        fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700,
        letterSpacing: 1, color: BRAND.white, lineHeight: 1.2, marginBottom: 10,
      }}>
        {event.name}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {event.starts_at && (
          <div style={{ fontSize: 13, color: BRAND.gray }}>
            📅 {formatEventDate(event.starts_at)}
            {event.doors_at
              ? ` · Doors ${formatEventTime(event.doors_at)}`
              : ` · ${formatEventTime(event.starts_at)}`}
          </div>
        )}
        {event.location_name && (
          <div style={{ fontSize: 13, color: BRAND.gray }}>
            📍 {event.location_name}
          </div>
        )}
      </div>
    </div>
  );
}

function TierCard({ tt, qty, cartQty, onDec, onInc, BRAND }) {
  const remaining = tt.quantity_total != null
    ? tt.quantity_total - (tt.quantity_sold || 0)
    : null;
  const canInc = cartQty < MAX_DEMO_TICKETS;
  const canDec = qty > 0;

  return (
    <div style={{
      padding: "16px 18px", background: BRAND.cardBg, borderRadius: 14,
      border: `1px solid ${qty > 0 ? BRAND.primary + "66" : "#222"}`,
      display: "flex", justifyContent: "space-between", alignItems: "center",
      gap: 16, flexWrap: "wrap", transition: "border-color 0.2s",
    }}>
      <div style={{ flex: 1, minWidth: 170 }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 17, fontWeight: 600,
          letterSpacing: 1, color: BRAND.white, marginBottom: 3,
        }}>
          {tt.name}
        </div>
        {tt.description && (
          <div style={{ fontSize: 12, color: BRAND.gray, marginBottom: 6, lineHeight: 1.5 }}>
            {tt.description}
          </div>
        )}
        <div style={{
          fontFamily: "'Space Mono', monospace", fontSize: 16,
          color: BRAND.accent, fontWeight: 700,
        }}>
          {formatCents(tt.price_cents)}
        </div>
        {remaining != null && remaining <= 10 && remaining > 0 && (
          <div style={{
            display: "inline-block", marginTop: 8, padding: "3px 10px",
            background: `${BRAND.accent}22`, border: `1px solid ${BRAND.accentMuted}`,
            borderRadius: 4, fontFamily: "'Space Mono', monospace",
            fontSize: 9, color: BRAND.accent, letterSpacing: 2,
          }}>
            ONLY {remaining} LEFT
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={onDec}
          disabled={!canDec}
          style={{
            width: 36, height: 36, borderRadius: "50%",
            border: `1px solid ${qty > 0 ? BRAND.primary : BRAND.dimText}`,
            background: "transparent", color: qty > 0 ? BRAND.primary : BRAND.dimText,
            fontSize: 22, lineHeight: 1, cursor: canDec ? "pointer" : "not-allowed",
            opacity: canDec ? 1 : 0.4,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          −
        </button>
        <span style={{
          fontFamily: "'Space Mono', monospace", fontSize: 18, width: 24,
          textAlign: "center", color: qty > 0 ? BRAND.primary : BRAND.gray, fontWeight: 700,
        }}>
          {qty}
        </span>
        <button
          onClick={onInc}
          disabled={!canInc}
          style={{
            width: 36, height: 36, borderRadius: "50%",
            border: `1px solid ${canInc ? BRAND.primary : BRAND.dimText}`,
            background: canInc && qty > 0 ? BRAND.primary : "transparent",
            color: canInc && qty > 0 ? BRAND.white : BRAND.primary,
            fontSize: 20, lineHeight: 1, cursor: canInc ? "pointer" : "not-allowed",
            opacity: canInc ? 1 : 0.4,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
