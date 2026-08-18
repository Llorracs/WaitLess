/**
 * ============================================
 * WAITLESS — Demo Step Guide (guided walkthrough overlay)
 * ============================================
 *
 * FILE: src/DemoStepGuide.jsx
 *
 * A small persistent card pinned to the bottom of the screen telling the
 * visitor what to do next in the /demo ticketing walkthrough.
 *
 * WHY STATE LIVES IN localStorage, NOT REACT:
 *   The walkthrough spans two separate pages — the TICKETS tab of /demo
 *   (DemoTicketsView) and /demo/checkin (CheckInView), which the user opens
 *   in a SECOND TAB so they can scan the QR off the first screen. React state
 *   can't cross that boundary. So the current step is persisted under
 *   DEMO_STEP_KEY and synced two ways:
 *     - across tabs via the native 'storage' event
 *     - within a tab via a custom 'waitless-demo-step' event, because
 *       'storage' deliberately does not fire in the tab that wrote the value
 *
 * DESIGN CONSTRAINTS (per spec):
 *   - Never a full-screen modal, never a dark scrim
 *   - The wrapper is pointerEvents:none so taps pass through everywhere
 *     except the card itself, which re-enables pointer events for its buttons
 *   - Sits above the iOS safe area, and accepts bottomOffset so the check-in
 *     screen can lift it clear of the camera caption pill
 *   - Renders ONLY on the venue whose slug is exactly 'demo'
 *
 * STEP MAP:
 *   1. Pick a ticket                 (DemoTicketsView)
 *   2. Scan the QR at the door       (advances automatically once issued)
 *   3. Scan the SAME ticket again    (advances on first successful check-in)
 * ============================================
 */

import { useState, useEffect, useCallback } from "react";

// ============================================================================
// SHARED STEP STATE
// ============================================================================

export const DEMO_STEP_KEY = "waitless_demo_step";
const DEMO_STEP_EVENT = "waitless-demo-step";
const TOTAL_STEPS = 3;

// The venue slug this guide is allowed to appear on. Anything else renders
// nothing — a real venue must never see demo chrome.
const DEMO_SLUG = "demo";

function readState() {
  try {
    const raw = localStorage.getItem(DEMO_STEP_KEY);
    if (!raw) return { step: 1, dismissed: false };
    const parsed = JSON.parse(raw);
    const step = Math.min(TOTAL_STEPS, Math.max(1, parseInt(parsed?.step, 10) || 1));
    return { step, dismissed: parsed?.dismissed === true };
  } catch {
    return { step: 1, dismissed: false };
  }
}

function writeState(next) {
  try {
    localStorage.setItem(DEMO_STEP_KEY, JSON.stringify(next));
  } catch {
    // Private-mode / quota failures are non-fatal — the guide just won't persist.
  }
  try {
    window.dispatchEvent(new CustomEvent(DEMO_STEP_EVENT, { detail: next }));
  } catch {}
}

/**
 * Move the walkthrough to a specific step.
 *
 * Only ever moves FORWARD on auto-advance, so a visitor who manually stepped
 * back isn't yanked forward again by a stale trigger. Re-opening the guide is
 * handled separately (setDemoStep un-dismisses so the advance is visible).
 */
export function advanceDemoStep(step) {
  const current = readState();
  if (step <= current.step) return;
  writeState({ step, dismissed: false });
}

/** Explicit set — used by "start over" to reset the walkthrough to step 1. */
export function resetDemoStep() {
  writeState({ step: 1, dismissed: false });
}

// ============================================================================
// COPY
// ============================================================================

const STEP_COPY = {
  1: {
    text: "Pick a ticket, then tap Get a Free Demo Ticket.",
    emphasized: false,
  },
  2: {
    text: "Open the door scanner and scan your QR code.",
    emphasized: false,
  },
  3: {
    // Spec: this exact string, visually emphasized.
    text: "Now scan the same ticket again.",
    emphasized: true,
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function DemoStepGuide({ venue, BRAND, bottomOffset = 0 }) {
  const [state, setState] = useState(() => readState());

  // Sync across tabs ('storage') and within this tab (custom event).
  useEffect(() => {
    function onStorage(e) {
      if (e.key && e.key !== DEMO_STEP_KEY) return;
      setState(readState());
    }
    function onCustom() {
      setState(readState());
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(DEMO_STEP_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DEMO_STEP_EVENT, onCustom);
    };
  }, []);

  const goto = useCallback((step) => {
    const clamped = Math.min(TOTAL_STEPS, Math.max(1, step));
    writeState({ step: clamped, dismissed: false });
  }, []);

  const dismiss = useCallback(() => {
    const current = readState();
    writeState({ step: current.step, dismissed: true });
  }, []);

  // Hard gate — demo venue only, never a real one.
  if (venue?.slug !== DEMO_SLUG) return null;
  if (state.dismissed) return null;

  const { step } = state;
  const copy = STEP_COPY[step] || STEP_COPY[1];
  const accent = BRAND?.accent || "#d4a843";
  const white = BRAND?.white || "#f5f5f5";
  const gray = BRAND?.gray || "#888";

  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 400,
        display: "flex", justifyContent: "center",
        // Clear the iOS home indicator, plus any caller-supplied offset
        // (the check-in screen uses this to sit above its camera caption).
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
            STEP {step} OF {TOTAL_STEPS}
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
            disabled={step >= TOTAL_STEPS}
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
