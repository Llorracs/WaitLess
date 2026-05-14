/**
 * ============================================
 * WAITLESS — Buy Tickets View (Buyer-Facing)
 * ============================================
 *
 * FILE: src/BuyTicketsView.jsx
 *
 * Route: /{venueSlug}/buy/{eventSlug}
 *
 * Two-stage flow ("Flow B" — committed via Decision 1):
 *
 *   Stage 1 (select)   — Hero + tier picker + qty steppers. Buyer commits to
 *                        what they're buying. "Continue" button reveals stage 2.
 *
 *   Stage 2 (checkout) — Buyer info form (email, name, phone optional) + T&C
 *                        checkbox + price breakdown. "Continue to Payment"
 *                        POSTs to create-ticket-checkout.js, then redirects
 *                        to Square's hosted checkout page.
 *
 * After Square completes payment, Square redirects to:
 *   /{venueSlug}/buy/{eventSlug}/confirmation?order_id={uuid}
 * which is handled by BuyConfirmationView (Piece 7).
 *
 * Props:
 *   - venue:    the current venue object (from App.jsx)
 *   - BRAND:    theming object (from App.jsx) — uses venue colors + patronFont
 *   - eventSlug: the event slug from the URL
 *
 * PATRON FONT (Piece 12 Chunk 3):
 * All patron-facing expressive headers use BRAND.patronFont:
 *   - Event name H1 hero
 *   - SectionHeader ("Select Tickets", "Your Details", "Order Summary")
 *   - Status/error headlines via headlineStyle ("EVENT NOT FOUND", etc.)
 * Tier names, button labels, prices, and form labels stay Oswald/Space Mono —
 * those are utility, not brand expression.
 * ============================================
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./lib/barOrderService";

// ============================================================================
// CONSTANTS
// ============================================================================

// Must match POLICY_VERSION in src/LegalPages.jsx AND the
// ACCEPTED_TERMS_VERSIONS array in netlify/functions/create-ticket-checkout.js
// All three move together when the policy is updated.
const TERMS_VERSION = "2026.05.12";

// Square online processing pass-through rates. Mirrors the server-side
// constants in create-ticket-checkout.js — kept in sync for client-side
// preview math. If these drift, the buyer's displayed total won't match the
// actual Square total; the server is authoritative, so worst case the buyer
// sees a slightly-off preview for a few seconds before redirect.
const SQUARE_RATE = 0.033;   // 3.30%
const SQUARE_FIXED_CENTS = 30; // 30 cents per transaction

// Cap on total tickets per order — matches server-side guard
const MAX_TICKETS_PER_ORDER = 50;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Mirror of computeTotals() in create-ticket-checkout.js.
 * Buyer pays X such that after Square deducts (X * rate + fixed),
 * the venue nets faceCents.
 */
function computeTotals(faceCents) {
  if (faceCents <= 0) return { faceCents: 0, processingCents: 0, totalCents: 0 };
  const buyerTotal = Math.ceil((faceCents + SQUARE_FIXED_CENTS) / (1 - SQUARE_RATE));
  return {
    faceCents,
    processingCents: buyerTotal - faceCents,
    totalCents: buyerTotal,
  };
}

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatEventDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatEventTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatShortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Check if a tier is sellable right now and produce a label explaining why
 * (or why not). Returns:
 *   { sellable: true, remaining: number|null }
 *   { sellable: false, reason: "sold_out"|"not_yet"|"ended"|"inactive", label, remaining? }
 */
function evaluateTier(tt, now = new Date()) {
  if (!tt.active) {
    return { sellable: false, reason: "inactive", label: "UNAVAILABLE" };
  }

  if (tt.sale_starts_at && new Date(tt.sale_starts_at) > now) {
    return {
      sellable: false,
      reason: "not_yet",
      label: `ON SALE ${formatShortDate(tt.sale_starts_at).toUpperCase()}`,
    };
  }

  if (tt.sale_ends_at && new Date(tt.sale_ends_at) < now) {
    return { sellable: false, reason: "ended", label: "SALES ENDED" };
  }

  if (tt.quantity_total != null) {
    const remaining = tt.quantity_total - (tt.quantity_sold || 0);
    if (remaining <= 0) {
      return { sellable: false, reason: "sold_out", label: "SOLD OUT", remaining: 0 };
    }
    return { sellable: true, remaining };
  }

  // Unlimited tier
  return { sellable: true, remaining: null };
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function BuyTicketsView({ venue, BRAND, eventSlug }) {
  // ---- DATA STATE ----
  const [event, setEvent] = useState(null);
  const [ticketTypes, setTicketTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // ---- FLOW STATE ----
  // "select" = stage 1 (tier picker), "checkout" = stage 2 (buyer info)
  const [stage, setStage] = useState("select");

  // ---- CART STATE ----
  // Map of ticketTypeId → qty. Cleared only by an explicit user action.
  // Persists across stage flips so going back doesn't wipe selections.
  const [cart, setCart] = useState({});

  // ---- BUYER FORM STATE ----
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // ---- SUBMIT STATE ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({}); // { name, email, terms, ... }

  // Ref to the buyer form so we can scroll to it on stage transition
  const buyerFormRef = useRef(null);

  // Preview flag — lets a venue admin view a draft event privately.
  // Mirrors the locked decision (see endpoint comments).
  const previewMode = useMemo(() => {
    return new URLSearchParams(window.location.search).get("preview") === "1";
  }, []);

  // ==========================================================================
  // LOAD EVENT + TICKET TYPES
  // ==========================================================================
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);

      try {
        // Single round-trip: event matched by slug + venue
        const { data: ev, error: evErr } = await supabase
          .from("events")
          .select("*")
          .eq("venue_id", venue.id)
          .eq("slug", eventSlug)
          .maybeSingle();

        if (evErr) throw evErr;
        if (!ev) {
          if (!cancelled) {
            setLoadError("not_found");
            setLoading(false);
          }
          return;
        }

        // Ticket types — only active=true ever shown to buyers
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
      } catch (err) {
        console.error("Failed to load event:", err);
        if (!cancelled) {
          setLoadError("error");
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [venue.id, eventSlug]);

  // ==========================================================================
  // CART HELPERS
  // ==========================================================================
  const cartTotalQty = Object.values(cart).reduce((s, q) => s + q, 0);

  const cartFaceCents = useMemo(() => {
    return Object.entries(cart).reduce((sum, [ttId, qty]) => {
      const tt = ticketTypes.find((t) => t.id === ttId);
      if (!tt) return sum;
      return sum + tt.price_cents * qty;
    }, 0);
  }, [cart, ticketTypes]);

  const totals = useMemo(() => computeTotals(cartFaceCents), [cartFaceCents]);

  function updateQty(ttId, delta) {
    setCart((prev) => {
      const current = prev[ttId] || 0;
      const tt = ticketTypes.find((t) => t.id === ttId);
      const evalResult = tt ? evaluateTier(tt) : { sellable: false };
      let next = Math.max(0, current + delta);

      // Cap at per-tier remaining (if finite)
      if (evalResult.remaining != null) {
        next = Math.min(next, evalResult.remaining);
      }
      // Cap at order-wide limit
      const otherQty = cartTotalQty - current;
      next = Math.min(next, MAX_TICKETS_PER_ORDER - otherQty);

      if (next === 0) {
        const { [ttId]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [ttId]: next };
    });
  }

  // ==========================================================================
  // STAGE TRANSITIONS
  // ==========================================================================
  function goToCheckout() {
    if (cartTotalQty === 0) return; // Button should be disabled, but defensive
    setStage("checkout");
    setSubmitError(null);
    // Scroll to the buyer form after it mounts
    setTimeout(() => {
      buyerFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function backToSelect() {
    setStage("select");
    setSubmitError(null);
    setFieldErrors({});
    // Don't clear buyer fields — let them keep what they typed
  }

  // ==========================================================================
  // VALIDATION + SUBMIT
  // ==========================================================================
  function validateBuyerForm() {
    const errors = {};
    if (!buyerName.trim()) errors.name = "Name is required";
    if (!buyerEmail.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
      errors.email = "Please enter a valid email";
    }
    if (!termsAccepted) {
      errors.terms = "You must accept the Terms of Service and Refund Policy";
    }
    return errors;
  }

  async function handleSubmit() {
    const errors = validateBuyerForm();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      // Scroll to the first error
      buyerFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Build selections payload — matches the shape required by
      // create-ticket-checkout.js: { ticketTypeId, qty }
      const selections = Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([ticketTypeId, qty]) => ({ ticketTypeId, qty }));

      const response = await fetch("/.netlify/functions/create-ticket-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueSlug: venue.slug,
          eventSlug: event.slug,
          selections,
          buyer: {
            name: buyerName.trim(),
            email: buyerEmail.trim(),
            phone: buyerPhone.trim() || null,
          },
          // T&C — strict boolean true required by server (defends against
          // tampering with truthy non-boolean values)
          termsAccepted: true,
          termsVersion: TERMS_VERSION,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        // Server-side validation rejected us. Common cases:
        //   - 409 with remaining count → tier sold out between page load and submit
        //   - 400 with various reasons → tier no longer active, sale ended, etc.
        //   - 400 terms version mismatch → stale page, advise reload
        setSubmitError(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      // Success — redirect to Square hosted checkout. Square will redirect
      // back to /{venue}/buy/{event}/confirmation?order_id=... after payment.
      window.location.href = data.checkoutUrl;
      // Don't clear submitting — we're navigating away
    } catch (err) {
      console.error("Checkout submission failed:", err);
      setSubmitError(
        err.message?.includes("fetch")
          ? "Network error. Check your connection and try again."
          : "Could not start checkout. Please try again."
      );
      setSubmitting(false);
    }
  }

  // ==========================================================================
  // RENDER — LOADING
  // ==========================================================================
  if (loading) {
    return (
      <CenteredMessage BRAND={BRAND}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          border: "3px solid #222", borderTopColor: BRAND.accent,
          animation: "spin 1s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={dimMonoStyle(BRAND)}>LOADING EVENT…</p>
      </CenteredMessage>
    );
  }

  // ==========================================================================
  // RENDER — LOAD ERROR / NOT FOUND
  // ==========================================================================
  if (loadError === "not_found") {
    return (
      <CenteredMessage BRAND={BRAND}>
        <h1 style={headlineStyle(BRAND)}>EVENT NOT FOUND</h1>
        <p style={{ color: BRAND.gray, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
          We couldn't find this event. Check the link or visit{" "}
          <a href={`/${venue.slug}`} style={{ color: BRAND.accent }}>
            {venue.name}
          </a>.
        </p>
      </CenteredMessage>
    );
  }

  if (loadError === "error") {
    return (
      <CenteredMessage BRAND={BRAND}>
        <h1 style={headlineStyle(BRAND)}>SOMETHING WENT WRONG</h1>
        <p style={{ color: BRAND.gray, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
          We couldn't load this event. Please try refreshing the page.
        </p>
      </CenteredMessage>
    );
  }

  // ==========================================================================
  // RENDER — EVENT STATUS CHECKS
  // ==========================================================================
  // Draft events are private unless ?preview=1 is in the URL
  if (event.status === "draft" && !previewMode) {
    return (
      <CenteredMessage BRAND={BRAND}>
        <h1 style={headlineStyle(BRAND)}>NOT ON SALE YET</h1>
        <p style={{ color: BRAND.gray, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
          This event isn't on sale yet. Check back soon.
        </p>
      </CenteredMessage>
    );
  }

  if (event.status === "canceled") {
    return (
      <CenteredMessage BRAND={BRAND}>
        <h1 style={{ ...headlineStyle(BRAND), color: "#e74c3c", background: "none", WebkitBackgroundClip: "unset", WebkitTextFillColor: "#e74c3c" }}>EVENT CANCELED</h1>
        <p style={{ color: BRAND.gray, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
          {event.name} has been canceled. If you purchased a ticket, the venue
          will be in touch about refunds.
        </p>
      </CenteredMessage>
    );
  }

  // Event has ended
  if (event.ends_at && new Date(event.ends_at) < new Date()) {
    return (
      <CenteredMessage BRAND={BRAND}>
        <h1 style={headlineStyle(BRAND)}>EVENT HAS ENDED</h1>
        <p style={{ color: BRAND.gray, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
          {event.name} ended on {formatEventDate(event.ends_at)}.
        </p>
      </CenteredMessage>
    );
  }

  // ==========================================================================
  // RENDER — MAIN BUY PAGE
  // ==========================================================================
  const allTierStates = ticketTypes.map((tt) => ({ tt, eval: evaluateTier(tt) }));
  const anyTierSellable = allTierStates.some((x) => x.eval.sellable);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 0 100px", minHeight: "100vh" }}>
      {/* Draft preview banner */}
      {event.status === "draft" && previewMode && (
        <div style={{
          background: "#d4a84322", borderBottom: `1px solid ${BRAND.accent}66`,
          padding: "10px 20px", textAlign: "center",
          fontFamily: "'Space Mono', monospace", fontSize: 11,
          color: BRAND.accent, letterSpacing: 2,
        }}>
          👁 PREVIEW MODE — THIS EVENT IS NOT YET PUBLIC
        </div>
      )}

      {/* HERO */}
      <div style={{ padding: "32px 20px 20px" }}>
        {event.hero_image_url && (
          <img
            src={event.hero_image_url}
            alt=""
            style={{
              width: "100%",
              maxHeight: 280,
              objectFit: "cover",
              borderRadius: 16,
              marginBottom: 20,
              border: `1px solid ${BRAND.cardBg}`,
            }}
          />
        )}

        <div style={{
          fontFamily: "'Space Mono', monospace", fontSize: 11,
          color: BRAND.accent, letterSpacing: 3, marginBottom: 8,
          textTransform: "uppercase",
        }}>
          {venue.name}
        </div>

        {/* Event name — uses BRAND.patronFont (Piece 12-3) */}
        <h1 style={{
          fontFamily: BRAND.patronFont, fontSize: 32, fontWeight: 700,
          letterSpacing: 2, margin: "0 0 16px", lineHeight: 1.1,
          background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          {event.name.toUpperCase()}
        </h1>

        {event.description && (
          <p style={{
            fontSize: 15, color: BRAND.gray, lineHeight: 1.6,
            margin: "0 0 24px", whiteSpace: "pre-wrap",
          }}>
            {event.description}
          </p>
        )}

        {/* When/Where chips */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {event.starts_at && (
            <DetailRow
              icon="📅"
              primary={formatEventDate(event.starts_at)}
              secondary={
                event.doors_at
                  ? `Doors ${formatEventTime(event.doors_at)} · Event ${formatEventTime(event.starts_at)}`
                  : `${formatEventTime(event.starts_at)}${event.ends_at ? ` — ${formatEventTime(event.ends_at)}` : ""}`
              }
              BRAND={BRAND}
            />
          )}
          {(event.location_name || event.location_address) && (
            <DetailRow
              icon="📍"
              primary={event.location_name || event.location_address}
              secondary={event.location_name && event.location_address ? event.location_address : null}
              BRAND={BRAND}
            />
          )}
        </div>
      </div>

      {/* ============================== STAGE 1: SELECT ============================== */}
      <div style={{ padding: "0 20px" }}>
        <SectionHeader BRAND={BRAND}>Select Tickets</SectionHeader>

        {ticketTypes.length === 0 ? (
          <EmptyState BRAND={BRAND}>
            No ticket types have been set up for this event yet.
          </EmptyState>
        ) : !anyTierSellable ? (
          <EmptyState BRAND={BRAND} accent>
            🎫 SOLD OUT
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {allTierStates.map(({ tt, eval: evalResult }) => (
              <TierCard
                key={tt.id}
                tt={tt}
                evalResult={evalResult}
                qty={cart[tt.id] || 0}
                onDecrement={() => updateQty(tt.id, -1)}
                onIncrement={() => updateQty(tt.id, +1)}
                cartTotalQty={cartTotalQty}
                disabled={stage !== "select"}
                BRAND={BRAND}
              />
            ))}
          </div>
        )}

        {/* Stage 1 → Stage 2 continue button (only shown in select stage) */}
        {stage === "select" && anyTierSellable && (
          <button
            onClick={goToCheckout}
            disabled={cartTotalQty === 0}
            style={{
              marginTop: 24, width: "100%", padding: "18px",
              background: cartTotalQty === 0
                ? "#222"
                : `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
              border: "none", borderRadius: 14,
              color: cartTotalQty === 0 ? BRAND.dimText : BRAND.white,
              fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
              letterSpacing: 3, cursor: cartTotalQty === 0 ? "not-allowed" : "pointer",
              boxShadow: cartTotalQty > 0 ? `0 4px 30px ${BRAND.primaryGlow}` : "none",
              transition: "all 0.2s",
            }}
          >
            {cartTotalQty === 0
              ? "SELECT TICKETS TO CONTINUE"
              : `CONTINUE — ${cartTotalQty} TICKET${cartTotalQty === 1 ? "" : "S"} · ${formatCents(totals.totalCents)}`}
          </button>
        )}
      </div>

      {/* ============================== STAGE 2: CHECKOUT ============================== */}
      {stage === "checkout" && (
        <div ref={buyerFormRef} style={{ padding: "32px 20px 0" }}>
          {/* Edit Tickets back button */}
          <button
            onClick={backToSelect}
            disabled={submitting}
            style={{
              background: "transparent",
              border: `1px solid ${BRAND.dimText}`,
              borderRadius: 20, padding: "8px 16px",
              color: BRAND.gray, fontFamily: "'Oswald', sans-serif",
              fontSize: 12, fontWeight: 500, letterSpacing: 2,
              cursor: submitting ? "not-allowed" : "pointer",
              marginBottom: 24, opacity: submitting ? 0.5 : 1,
            }}
          >
            ← EDIT TICKETS
          </button>

          <SectionHeader BRAND={BRAND}>Your Details</SectionHeader>

          {/* Buyer info form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <FormField
              label="Full Name *"
              error={fieldErrors.name}
              BRAND={BRAND}
            >
              <input
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                disabled={submitting}
                placeholder="Jane Doe"
                autoComplete="name"
                style={inputStyle(BRAND, !!fieldErrors.name)}
              />
            </FormField>

            <FormField
              label="Email *"
              error={fieldErrors.email}
              help="Your tickets and receipt will be sent here"
              BRAND={BRAND}
            >
              <input
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                disabled={submitting}
                placeholder="jane@example.com"
                autoComplete="email"
                inputMode="email"
                style={inputStyle(BRAND, !!fieldErrors.email)}
              />
            </FormField>

            <FormField
              label="Phone (optional)"
              help="For event updates from the venue"
              BRAND={BRAND}
            >
              <input
                type="tel"
                value={buyerPhone}
                onChange={(e) => setBuyerPhone(e.target.value)}
                disabled={submitting}
                placeholder="(555) 555-5555"
                autoComplete="tel"
                inputMode="tel"
                style={inputStyle(BRAND, false)}
              />
            </FormField>
          </div>

          {/* Order summary */}
          <div style={{ marginTop: 32 }}>
            <SectionHeader BRAND={BRAND}>Order Summary</SectionHeader>
            <div style={{
              padding: "16px 18px", background: BRAND.cardBg,
              borderRadius: 12, border: "1px solid #222",
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              {Object.entries(cart).map(([ttId, qty]) => {
                const tt = ticketTypes.find((t) => t.id === ttId);
                if (!tt) return null;
                return (
                  <div key={ttId} style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 14, color: BRAND.white,
                  }}>
                    <span style={{ fontFamily: "'Oswald', sans-serif", letterSpacing: 0.5 }}>
                      {tt.name} × {qty}
                    </span>
                    <span style={{ fontFamily: "'Space Mono', monospace", color: BRAND.gray }}>
                      {formatCents(tt.price_cents * qty)}
                    </span>
                  </div>
                );
              })}

              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />

              <SummaryLine
                label="Subtotal"
                value={formatCents(totals.faceCents)}
                BRAND={BRAND}
              />
              <SummaryLine
                label="Processing"
                value={formatCents(totals.processingCents)}
                hint="Square processing pass-through"
                BRAND={BRAND}
              />
              <div style={{ height: 1, background: "#333", margin: "4px 0" }} />
              <SummaryLine
                label="Total"
                value={formatCents(totals.totalCents)}
                bold
                BRAND={BRAND}
              />
            </div>
          </div>

          {/* T&C checkbox */}
          <div style={{ marginTop: 24 }}>
            <label
              htmlFor="waitless-terms-checkbox"
              style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                padding: "14px 16px",
                background: fieldErrors.terms ? "#e74c3c11" : BRAND.cardBg,
                border: `1px solid ${fieldErrors.terms ? "#e74c3c44" : "#222"}`,
                borderRadius: 12, cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              <input
                id="waitless-terms-checkbox"
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => {
                  setTermsAccepted(e.target.checked);
                  if (e.target.checked && fieldErrors.terms) {
                    setFieldErrors((prev) => {
                      const { terms: _drop, ...rest } = prev;
                      return rest;
                    });
                  }
                }}
                disabled={submitting}
                style={{
                  width: 20, height: 20, marginTop: 2,
                  accentColor: BRAND.accent, cursor: submitting ? "not-allowed" : "pointer",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, fontSize: 13, color: BRAND.white, lineHeight: 1.5 }}>
                I have read and agree to the{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: BRAND.accent, textDecoration: "underline" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  href="/refund-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: BRAND.accent, textDecoration: "underline" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Refund Policy
                </a>
                .
              </div>
            </label>
            {fieldErrors.terms && (
              <div style={{
                fontSize: 11, color: "#e74c3c", marginTop: 6,
                fontFamily: "'Space Mono', monospace", paddingLeft: 4,
              }}>
                {fieldErrors.terms}
              </div>
            )}
          </div>

          {/* Submit error banner */}
          {submitError && (
            <div style={{
              marginTop: 16, padding: "14px 16px",
              background: "#e74c3c15", border: "1px solid #e74c3c44",
              borderRadius: 10, color: "#e74c3c", fontSize: 13, lineHeight: 1.5,
            }}>
              {submitError}
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              marginTop: 20, width: "100%", padding: "18px",
              background: submitting
                ? "#444"
                : `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
              border: "none", borderRadius: 14, color: BRAND.white,
              fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
              letterSpacing: 3, cursor: submitting ? "wait" : "pointer",
              boxShadow: !submitting ? `0 4px 30px ${BRAND.primaryGlow}` : "none",
              transition: "all 0.2s",
            }}
          >
            {submitting
              ? "STARTING CHECKOUT…"
              : `CONTINUE TO PAYMENT — ${formatCents(totals.totalCents)}`}
          </button>

          <p style={{
            textAlign: "center", fontSize: 10, color: BRAND.dimText,
            marginTop: 14, fontFamily: "'Space Mono', monospace", letterSpacing: 1,
          }}>
            SECURE PAYMENT VIA SQUARE
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function CenteredMessage({ children, BRAND }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", padding: 24, gap: 16,
      background: BRAND.black, color: BRAND.white,
    }}>
      {children}
    </div>
  );
}

// SectionHeader — uses BRAND.patronFont (Piece 12-3)
// Renders "Select Tickets", "Your Details", "Order Summary"
function SectionHeader({ children, BRAND }) {
  return (
    <h2 style={{
      fontFamily: BRAND.patronFont, fontSize: 13, fontWeight: 600,
      letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase",
      marginBottom: 12, paddingBottom: 8,
      borderBottom: `1px solid ${BRAND.accentMuted}`,
    }}>
      {children}
    </h2>
  );
}

function DetailRow({ icon, primary, secondary, BRAND }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px", background: BRAND.cardBg,
      borderRadius: 10, border: "1px solid #222",
    }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500,
          color: BRAND.white, letterSpacing: 0.5,
        }}>
          {primary}
        </div>
        {secondary && (
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 11,
            color: BRAND.gray, marginTop: 2, letterSpacing: 0.5,
          }}>
            {secondary}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ children, BRAND, accent }) {
  return (
    <div style={{
      padding: "40px 20px", textAlign: "center",
      background: BRAND.cardBg, border: "1px dashed #333",
      borderRadius: 14,
      color: accent ? BRAND.accent : BRAND.gray,
      fontFamily: accent ? "'Oswald', sans-serif" : "'Inter', sans-serif",
      fontSize: accent ? 20 : 14,
      fontWeight: accent ? 700 : 400,
      letterSpacing: accent ? 4 : 0,
    }}>
      {children}
    </div>
  );
}

// TierCard — tier name (tt.name) stays Oswald (Piece 12-3 decision)
// Repeated/scannable label, not expressive header
function TierCard({ tt, evalResult, qty, onDecrement, onIncrement, cartTotalQty, disabled, BRAND }) {
  const sellable = evalResult.sellable;
  const totalReached = cartTotalQty >= MAX_TICKETS_PER_ORDER;
  const remainingReached = evalResult.remaining != null && qty >= evalResult.remaining;
  const canIncrement = sellable && !disabled && !totalReached && !remainingReached;
  const canDecrement = sellable && !disabled && qty > 0;

  return (
    <div style={{
      padding: "16px 18px",
      background: sellable ? BRAND.cardBg : "#0f0f0f",
      borderRadius: 14,
      border: `1px solid ${qty > 0 ? BRAND.primary + "66" : "#222"}`,
      opacity: sellable ? 1 : 0.5,
      transition: "border-color 0.2s",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      gap: 16, flexWrap: "wrap",
    }}>
      <div style={{ flex: 1, minWidth: 180 }}>
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

        {/* Status / remaining */}
        {!sellable && (
          <div style={{
            display: "inline-block", marginTop: 8, padding: "3px 10px",
            background: "#e74c3c22", border: "1px solid #e74c3c44",
            borderRadius: 4, fontFamily: "'Space Mono', monospace",
            fontSize: 9, color: "#e74c3c", letterSpacing: 2,
          }}>
            {evalResult.label}
          </div>
        )}
        {sellable && evalResult.remaining != null && evalResult.remaining <= 10 && (
          <div style={{
            display: "inline-block", marginTop: 8, padding: "3px 10px",
            background: `${BRAND.accent}22`, border: `1px solid ${BRAND.accentMuted}`,
            borderRadius: 4, fontFamily: "'Space Mono', monospace",
            fontSize: 9, color: BRAND.accent, letterSpacing: 2,
          }}>
            ONLY {evalResult.remaining} LEFT
          </div>
        )}
      </div>

      {/* Quantity stepper */}
      {sellable && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onDecrement}
            disabled={!canDecrement}
            style={{
              width: 36, height: 36, borderRadius: "50%",
              border: `1px solid ${qty > 0 ? BRAND.primary : BRAND.dimText}`,
              background: "transparent",
              color: qty > 0 ? BRAND.primary : BRAND.dimText,
              fontSize: 22, lineHeight: 1, cursor: canDecrement ? "pointer" : "not-allowed",
              opacity: canDecrement ? 1 : 0.4,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            −
          </button>
          <span style={{
            fontFamily: "'Space Mono', monospace", fontSize: 18,
            width: 24, textAlign: "center",
            color: qty > 0 ? BRAND.primary : BRAND.gray, fontWeight: 700,
          }}>
            {qty}
          </span>
          <button
            onClick={onIncrement}
            disabled={!canIncrement}
            style={{
              width: 36, height: 36, borderRadius: "50%",
              border: `1px solid ${canIncrement ? BRAND.primary : BRAND.dimText}`,
              background: canIncrement && qty > 0 ? BRAND.primary : "transparent",
              color: canIncrement && qty > 0 ? BRAND.white : BRAND.primary,
              fontSize: 20, lineHeight: 1, cursor: canIncrement ? "pointer" : "not-allowed",
              opacity: canIncrement ? 1 : 0.4,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children, error, help, BRAND }) {
  return (
    <div>
      <label style={{
        display: "block", fontFamily: "'Oswald', sans-serif",
        fontSize: 11, fontWeight: 600, color: BRAND.gray,
        letterSpacing: 2, textTransform: "uppercase", marginBottom: 6,
      }}>
        {label}
      </label>
      {children}
      {help && !error && (
        <div style={{ fontSize: 11, color: BRAND.dimText, marginTop: 4 }}>
          {help}
        </div>
      )}
      {error && (
        <div style={{
          fontSize: 11, color: "#e74c3c", marginTop: 4,
          fontFamily: "'Space Mono', monospace",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

function SummaryLine({ label, value, hint, bold, BRAND }) {
  return (
    <div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: bold ? 17 : 13,
        fontFamily: bold ? "'Oswald', sans-serif" : "'Inter', sans-serif",
        fontWeight: bold ? 700 : 400,
        color: bold ? BRAND.white : BRAND.gray,
        letterSpacing: bold ? 1 : 0,
      }}>
        <span>{label}</span>
        <span style={{
          fontFamily: "'Space Mono', monospace",
          color: bold ? BRAND.accent : BRAND.gray,
        }}>
          {value}
        </span>
      </div>
      {hint && (
        <div style={{
          fontSize: 10, color: BRAND.dimText, marginTop: 1,
          fontFamily: "'Space Mono', monospace", letterSpacing: 0.5,
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STYLE HELPERS
// ============================================================================

function inputStyle(BRAND, hasError) {
  return {
    width: "100%", padding: "12px 14px",
    background: "#0a0a0a",
    border: `1px solid ${hasError ? "#e74c3c" : "#333"}`,
    borderRadius: 8, color: BRAND.white,
    fontFamily: "'Inter', sans-serif", fontSize: 14,
    outline: "none", boxSizing: "border-box",
  };
}

// headlineStyle — used by all status/error headlines on this page
// (EVENT NOT FOUND, SOMETHING WENT WRONG, NOT ON SALE YET, EVENT HAS ENDED)
// Uses BRAND.patronFont (Piece 12-3) so failure states match venue brand
function headlineStyle(BRAND) {
  return {
    fontFamily: BRAND.patronFont, fontSize: 24, fontWeight: 700,
    letterSpacing: 4, margin: 0, textAlign: "center",
    background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  };
}

function dimMonoStyle(BRAND) {
  return {
    fontFamily: "'Space Mono', monospace", fontSize: 11,
    color: BRAND.dimText, letterSpacing: 2, margin: 0,
  };
}
