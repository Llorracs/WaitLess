/**
 * ============================================
 * WAITLESS — Demo Step Guide (guided walkthrough overlay)
 * ============================================
 *
 * FILE: src/DemoStepGuide.jsx
 *
 * A small persistent card pinned to the bottom of the screen telling a
 * visitor what to do next, so the /demo venue can be handed to someone
 * cold and drive itself.
 *
 * TWO INDEPENDENT TRACKS:
 *   "ordering" — the mobile ordering loop (PATRON → BAR → PATRON)
 *   "tickets"  — the paperless ticketing loop (buy → scan → scan again)
 * Each keeps its own step in its own localStorage key, so poking at one
 * doesn't disturb the other and either can be replayed on its own.
 *
 * WHY STATE LIVES IN localStorage, NOT REACT:
 *   Both tracks span more than one screen, and the ticketing track spans
 *   two BROWSER TABS — the visitor opens /demo/checkin separately so they
 *   can scan the QR shown on the first screen. React state can't cross
 *   that. So the step is persisted and synced two ways:
 *     - across tabs via the native 'storage' event
 *     - within a tab via a custom 'waitless-demo-step' event, because
 *       'storage' deliberately does not fire in the tab that wrote it
 *
 * DESIGN CONSTRAINTS:
 *   - Never a full-screen modal, never a dark scrim
 *   - Wrapper is pointerEvents:none so taps pass through everywhere except
 *     the card itself, which re-enables them for its own buttons
 *   - Sits above the iOS safe area; bottomOffset lifts it clear of other
 *     bottom-pinned UI (the check-in camera caption, the patron cart bar)
 *   - Renders ONLY on the venue whose slug is exactly 'demo'
 * ============================================
 */

import { useState, useEffect, useCallback } from "react";

// ============================================================================
// TRACK DEFINITIONS
// ============================================================================

// The venue slug this guide is allowed to appear on. Anything else renders
// nothing — a real venue must never see demo chrome.
const DEMO_SLUG = "demo";

const TRACKS = {
  ordering: {
    key: "waitless_demo_step_ordering",
    steps: [
      { text: "Tap any drink to add it to your order." },
      { text: "Open your cart and place the order." },
      { text: "Now tap BAR at the top — your order is already there." },
      // The payoff: the loop closing back on the patron's own screen.
      { text: "Mark it ready, then tap PATRON to watch it turn green.", emphasized: true },
    ],
  },
  // Runs on the GUEST's device (the prospect you hand the demo to).
  tickets: {
    key: "waitless_demo_step_tickets",
    steps: [
      { text: "Pick a ticket, then tap Get a Free Demo Ticket." },
      { text: "Show this QR to be scanned — or open the scanner yourself on another device." },
      { text: "Now scan the same ticket again.", emphasized: true },
    ],
  },
  // Runs on the DOOR device (/demo/checkin) — typically the seller's own
  // phone while pitching. Separate from the guest track because the two
  // devices are at different points in the story, and localStorage does not
  // sync between them.
  scanner: {
    key: "waitless_demo_step_scanner",
    steps: [
      { text: "Point the camera at the guest's ticket QR." },
      { text: "Now scan the same ticket again.", emphasized: true },
    ],
  },
};

const DEMO_STEP_EVENT = "waitless-demo-step";

// ============================================================================
// SHARED STEP STATE
// ============================================================================

function trackConfig(track) {
  return TRACKS[track] || TRACKS.ordering;
}

function readState(track) {
  const cfg = trackConfig(track);
  const total = cfg.steps.length;
  try {
    const raw = localStorage.getItem(cfg.key);
    if (!raw) return { step: 1, dismissed: false };
    const parsed = JSON.parse(raw);
    const step = Math.min(total, Math.max(1, parseInt(parsed?.step, 10) || 1));
    return { step, dismissed: parsed?.dismissed === true };
  } catch {
    return { step: 1, dismissed: false };
  }
}

function writeState(track, next) {
  const cfg = trackConfig(track);
  try {
    localStorage.setItem(cfg.key, JSON.stringify(next));
  } catch {
    // Private-mode / quota failures are non-fatal — the guide just won't persist.
  }
  try {
    window.dispatchEvent(new CustomEvent(DEMO_STEP_EVENT, { detail: { track, ...next } }));
  } catch {}
}

/**
 * Move a track forward to a specific step.
 *
 * Only ever moves FORWARD, so someone who manually stepped back to re-read
 * an instruction isn't yanked ahead by a later trigger. An advance also
 * un-dismisses the card, so a visitor who closed it still sees the next
 * instruction appear when they complete something.
 */
export function advanceDemoStep(track, step) {
  const cfg = trackConfig(track);
  const current = readState(track);
  const clamped = Math.min(cfg.steps.length, Math.max(1, step));
  if (clamped <= current.step) return;
  writeState(track, { step: clamped, dismissed: false });
}

/** Reset a track to step 1 — used by "start over". */
export function resetDemoStep(track) {
  writeState(track, { step: 1, dismissed: false });
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function DemoStepGuide({ venue, BRAND, track = "ordering", bottomOffset = 0 }) {
  const [state, setState] = useState(() => readState(track));

  // Re-read when the track changes, so switching contexts shows that
  // track's own progress rather than the previous one's.
  useEffect(() => {
    setState(readState(track));
  }, [track]);

  // Sync across tabs ('storage') and within this tab (custom event).
  useEffect(() => {
    const cfg = trackConfig(track);
    function onStorage(e) {
      if (e.key && e.key !== cfg.key) return;
      setState(readState(track));
    }
    function onCustom(e) {
      if (e.detail?.track && e.detail.track !== track) return;
      setState(readState(track));
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(DEMO_STEP_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DEMO_STEP_EVENT, onCustom);
    };
  }, [track]);

  const cfg = trackConfig(track);
  const total = cfg.steps.length;

  const goto = useCallback((step) => {
    const clamped = Math.min(total, Math.max(1, step));
    writeState(track, { step: clamped, dismissed: false });
  }, [track, total]);

  const dismiss = useCallback(() => {
    const current = readState(track);
    writeState(track, { step: current.step, dismissed: true });
  }, [track]);

  // Hard gate — demo venue only, never a real one.
  if (venue?.slug !== DEMO_SLUG) return null;
  if (state.dismissed) return null;

  const { step } = state;
  const copy = cfg.steps[step - 1] || cfg.steps[0];
  const accent = BRAND?.accent || "#d4a843";
  const white = BRAND?.white || "#f5f5f5";
  const gray = BRAND?.gray || "#888";

  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 400,
        display: "flex", justifyContent: "center",
        // Clear the iOS home indicator, plus any caller-supplied offset.
        padding: `0 12px calc(env(safe-area-inset-bottom, 0px) + ${12 + bottomOffset}px)`,
        // Taps pass straight through the wrapper — only the card itself is
        // interactive, so nothing underneath is blocked.
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          width: "100%", maxWidth: 440,
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px",
          borderRadius: 14,
          background: "rgba(12,12,12,0.88)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: `1px solid ${copy.emphasized ? accent : "rgba(255,255,255,0.12)"}`,
          boxShadow: copy.emphasized
            ? `0 8px 32px rgba(0,0,0,0.5), 0 0 24px ${accent}44`
            : "0 8px 32px rgba(0,0,0,0.45)",
        }}
      >
        {/* Step text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "'Space Mono', monospace", fontSize: 9,
              letterSpacing: 2, color: accent, marginBottom: 3,
            }}
          >
            STEP {step} OF {total}
          </div>
          <div
            style={{
              fontFamily: copy.emphasized ? "'Oswald', sans-serif" : "'Inter', sans-serif",
              fontSize: copy.emphasized ? 16 : 13,
              fontWeight: copy.emphasized ? 700 : 400,
              letterSpacing: copy.emphasized ? 1 : 0,
              color: copy.emphasized ? accent : white,
              lineHeight: 1.4,
            }}
          >
            {copy.text}
          </div>
        </div>

        {/* Manual back / next fallback */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <GuideButton
            label="←"
            title="Previous step"
            disabled={step <= 1}
            onClick={() => goto(step - 1)}
            color={gray}
          />
          <GuideButton
            label="→"
            title="Next step"
            disabled={step >= total}
            onClick={() => goto(step + 1)}
            color={gray}
          />
          <GuideButton
            label="✕"
            title="Dismiss"
            onClick={dismiss}
            color={gray}
          />
        </div>
      </div>
    </div>
  );
}

function GuideButton({ label, title, onClick, disabled, color }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        width: 30, height: 30, borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "transparent",
        color,
        fontSize: 13, lineHeight: 1,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.3 : 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}
