/**
 * ============================================
 * WAITLESS — Buy Confirmation View (Buyer-Facing)
 * ============================================
 *
 * FILE: src/BuyConfirmationView.jsx
 *
 * Route: /{venueSlug}/buy/{eventSlug}/confirmation?order_id={uuid}
 *
 * This is where buyers land AFTER Square's hosted checkout completes payment.
 * Square redirects here with `?order_id=<uuid>` and we render the tickets.
 *
 * IMPORTANT: there's a RACE between Square's redirect and the webhook.
 * The webhook (ticket-webhook.js) is what:
 *   - Inserts rows in `tickets`
 *   - Flips ticket_orders.status from 'pending' → 'paid'
 *   - Sends the confirmation email
 *
 * The redirect can fire SECONDS before the webhook lands. This page polls
 * ticket_orders.status until it sees 'paid', then renders tickets. If the
 * webhook never lands (server error, Square API hiccup), we fall back to a
 * "still processing — check your email" state after a timeout.
 *
 * Props:
 *   - venue:     the current venue object (from App.jsx)
 *   - BRAND:     theming object (from App.jsx) — uses venue colors
 *   - eventSlug: the event slug from the URL
 *
 * State machine:
 *   loading_order        — initial fetch of ticket_orders row
 *   polling              — order found but status='pending', poll for webhook
 *   ready                — status='paid', tickets loaded, render QR codes
 *   timeout              — polling exceeded MAX_POLL_DURATION_MS
 *   refunded             — entire order refunded (visitor came back to URL)
 *   failed               — order in 'failed' state (Square hiccup)
 *   not_found            — order_id is missing or doesn't match an existing row
 *   error                — generic DB error
 *
 * Edge cases handled:
 *   - No ?order_id in URL → not_found
 *   - Order belongs to a different venue → not_found (defense in depth)
 *   - Order status=pending → poll up to 60 seconds before timing out
 *   - Order status=paid + all tickets refunded → show "refunded" state
 *   - Order status=paid + some tickets refunded → show only valid tickets
 *   - Order status=paid + ticket checked in → show "ALREADY SCANNED" instead of QR
 *   - Order status=refunded → "refunded" state
 *   - Order status=failed → "payment failed" state
 *
 * On QR rendering:
 *   The webhook server-generates QR PNGs for the email. This page generates
 *   the SAME QR codes client-side from the same qr_token string, using the
 *   `qrcode` npm package (already in package.json — used by the webhook).
 *   Same data string → same QR → same scan behavior at the door.
 * ============================================
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "./lib/barOrderService";
import QRCode from "qrcode";

// ============================================================================
// CONSTANTS
// ============================================================================

const POLL_INTERVAL_MS = 1500;          // Poll every 1.5 seconds
const MAX_POLL_DURATION_MS = 60_000;    // Give up after 60 seconds total
const MAX_POLL_ATTEMPTS = Math.ceil(MAX_POLL_DURATION_MS / POLL_INTERVAL_MS);

// ============================================================================
// HELPERS
// ============================================================================

function formatCents(cents) {
  if (cents == null) return "$0.00";
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

function getOrderIdFromUrl() {
  return new URLSearchParams(window.location.search).get("order_id");
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function BuyConfirmationView({ venue, BRAND, eventSlug }) {
  const orderId = useMemo(() => getOrderIdFromUrl(), []);

  // ---- STATE MACHINE ----
  const [phase, setPhase] = useState("loading_order"); // see state machine in header doc
  const [order, setOrder] = useState(null);
  const [event, setEvent] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [ticketTypesById, setTicketTypesById] = useState({});
  const [pollAttempts, setPollAttempts] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);

  // Poll interval ref so we can cancel it on unmount or phase transition
  const pollTimeoutRef = useRef(null);

  // ==========================================================================
  // PHASE 1 — Initial load of the order
  // ==========================================================================
  useEffect(() => {
    let cancelled = false;

    async function loadOrder() {
      if (!orderId) {
        setPhase("not_found");
        return;
      }

      try {
        const { data: orderRow, error: orderErr } = await supabase
          .from("ticket_orders")
          .select("*")
          .eq("id", orderId)
          .maybeSingle();

        if (cancelled) return;

        if (orderErr) {
          console.error("Failed to load order:", orderErr);
          setErrorMessage(orderErr.message);
          setPhase("error");
          return;
        }

        if (!orderRow) {
          setPhase("not_found");
          return;
        }

        // Defense in depth: the order must belong to the current venue.
        // Otherwise a buyer could land on the wrong venue's page after
        // an unusual redirect.
        if (orderRow.venue_id !== venue.id) {
          setPhase("not_found");
          return;
        }

        setOrder(orderRow);

        // Branch based on order status
        if (orderRow.status === "paid") {
          // Webhook has already landed — load tickets immediately
          await loadEventAndTickets(orderRow);
        } else if (orderRow.status === "pending") {
          // Webhook hasn't landed yet — start polling
          setPhase("polling");
        } else if (orderRow.status === "refunded") {
          await loadEventAndTickets(orderRow); // Load anyway so we can show event details
          setPhase("refunded");
        } else if (orderRow.status === "failed") {
          setPhase("failed");
        } else {
          // Unknown status — treat as error
          console.error("Unknown order status:", orderRow.status);
          setErrorMessage(`Unknown order status: ${orderRow.status}`);
          setPhase("error");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Order load threw:", err);
        setErrorMessage(err.message || "Unknown error");
        setPhase("error");
      }
    }

    loadOrder();
    return () => { cancelled = true; };
  }, [orderId, venue.id]);

  // ==========================================================================
  // PHASE 2 — Polling loop (only active while phase === "polling")
  // ==========================================================================
  useEffect(() => {
    if (phase !== "polling") return;

    async function pollForPayment() {
      // Re-fetch the order row to see if the webhook has landed
      const { data: orderRow, error: orderErr } = await supabase
        .from("ticket_orders")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();

      if (orderErr) {
        console.error("Poll error:", orderErr);
        // Keep trying — transient errors shouldn't abort the loop
      } else if (orderRow) {
        if (orderRow.status === "paid") {
          setOrder(orderRow);
          await loadEventAndTickets(orderRow);
          return; // STOP polling
        } else if (orderRow.status === "refunded") {
          setOrder(orderRow);
          await loadEventAndTickets(orderRow);
          setPhase("refunded");
          return; // STOP polling
        } else if (orderRow.status === "failed") {
          setOrder(orderRow);
          setPhase("failed");
          return; // STOP polling
        }
        // else: still pending — continue polling
      }

      setPollAttempts((prev) => {
        const next = prev + 1;
        if (next >= MAX_POLL_ATTEMPTS) {
          setPhase("timeout");
          return next;
        }
        // Schedule next poll
        pollTimeoutRef.current = setTimeout(pollForPayment, POLL_INTERVAL_MS);
        return next;
      });
    }

    // Start polling immediately (no initial delay — first attempt is fast)
    pollForPayment();

    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, orderId]);

  // ==========================================================================
  // Load event details + tickets once we know the order is paid
  // ==========================================================================
  async function loadEventAndTickets(orderRow) {
    try {
      // Event row — for display
      const { data: eventRow, error: eventErr } = await supabase
        .from("events")
        .select("*")
        .eq("id", orderRow.event_id)
        .maybeSingle();

      if (eventErr) throw eventErr;
      if (!eventRow) throw new Error("Event not found");

      setEvent(eventRow);

      // Tickets — only the ones the webhook created. May be empty if the
      // webhook is still processing (race condition), in which case we should
      // re-enter polling. But if order.status is 'paid', the webhook is done,
      // so tickets should always be present here.
      const { data: ticketRows, error: ticketErr } = await supabase
        .from("tickets")
        .select("*")
        .eq("order_id", orderRow.id)
        .order("created_at", { ascending: true });

      if (ticketErr) throw ticketErr;

      setTickets(ticketRows || []);

      // Load ticket types so we can show "GA" / "VIP" labels on each ticket
      if (ticketRows && ticketRows.length > 0) {
        const ttIds = [...new Set(ticketRows.map((t) => t.ticket_type_id))];
        const { data: ttRows } = await supabase
          .from("ticket_types")
          .select("id, name, description")
          .in("id", ttIds);

        const byId = {};
        for (const tt of ttRows || []) byId[tt.id] = tt;
        setTicketTypesById(byId);
      }

      // Only flip to 'ready' if we haven't already routed to refunded/failed
      // (those phases are set by the caller; this helper just loads data)
      if (orderRow.status === "paid") {
        setPhase("ready");
      }
    } catch (err) {
      console.error("loadEventAndTickets threw:", err);
      setErrorMessage(err.message || "Could not load tickets");
      setPhase("error");
    }
  }

  // ==========================================================================
  // RENDER — branch by phase
  // ==========================================================================

  if (phase === "loading_order") {
    return (
      <StatusScreen BRAND={BRAND} icon="spinner" title="LOADING…" />
    );
  }

  if (phase === "not_found") {
    return (
      <StatusScreen
        BRAND={BRAND}
        title="ORDER NOT FOUND"
        body={
          <>
            We couldn't find this order. If you just paid, check your email
            for tickets. Otherwise, visit{" "}
            <a href={`/${venue.slug}`} style={{ color: BRAND.accent }}>
              {venue.name}
            </a>.
          </>
        }
      />
    );
  }

  if (phase === "error") {
    return (
      <StatusScreen
        BRAND={BRAND}
        title="SOMETHING WENT WRONG"
        body={
          <>
            We had trouble loading your order. Please check your email for your
            tickets, or contact the venue with order ID:
            <br />
            <span style={{
              fontFamily: "'Space Mono', monospace", fontSize: 12,
              color: BRAND.gray, marginTop: 8, display: "inline-block",
            }}>
              {orderId || "—"}
            </span>
          </>
        }
      />
    );
  }

  if (phase === "polling") {
    return <PollingScreen BRAND={BRAND} attempts={pollAttempts} />;
  }

  if (phase === "timeout") {
    return (
      <StatusScreen
        BRAND={BRAND}
        icon="email"
        title="YOUR PAYMENT WENT THROUGH"
        body={
          <>
            We're still finishing up your tickets. Check your email
            {order?.buyer_email ? <> at <strong>{order.buyer_email}</strong></> : ""} in
            the next few minutes. If you don't see them within 10 minutes,
            contact the venue with this order ID:
            <br />
            <span style={{
              fontFamily: "'Space Mono', monospace", fontSize: 12,
              color: BRAND.gray, marginTop: 8, display: "inline-block",
              wordBreak: "break-all",
            }}>
              {orderId}
            </span>
          </>
        }
      />
    );
  }

  if (phase === "failed") {
    return (
      <StatusScreen
        BRAND={BRAND}
        title="PAYMENT FAILED"
        titleColor="#e74c3c"
        body={
          <>
            We couldn't complete your payment. If you were charged, contact the
            venue with order ID:
            <br />
            <span style={{
              fontFamily: "'Space Mono', monospace", fontSize: 12,
              color: BRAND.gray, marginTop: 8, display: "inline-block",
              wordBreak: "break-all",
            }}>
              {orderId}
            </span>
          </>
        }
      />
    );
  }

  if (phase === "refunded") {
    return (
      <RefundedScreen BRAND={BRAND} order={order} event={event} />
    );
  }

  // ==========================================================================
  // PHASE: "ready" — render tickets
  // ==========================================================================

  // Filter tickets: only show valid + checked_in (refunded tickets are hidden
  // because their QR no longer works at the door, and showing them is confusing)
  const visibleTickets = tickets.filter((t) => t.status !== "refunded");
  const validCount = tickets.filter((t) => t.status === "valid").length;
  const allRefunded = tickets.length > 0 && visibleTickets.length === 0;

  // If every ticket has been individually refunded but the order isn't marked
  // 'refunded' yet, show the refunded screen anyway
  if (allRefunded) {
    return <RefundedScreen BRAND={BRAND} order={order} event={event} />;
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 100px" }}>
      {/* Success banner */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "8px 18px", borderRadius: 20,
          background: `${BRAND.success}15`, border: `1px solid ${BRAND.success}44`,
          marginBottom: 18,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: BRAND.success,
            boxShadow: `0 0 8px ${BRAND.success}88`,
          }} />
          <span style={{
            fontFamily: "'Space Mono', monospace", fontSize: 10,
            color: BRAND.success, letterSpacing: 2,
          }}>
            PAYMENT CONFIRMED
          </span>
        </div>

        <h1 style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 32, fontWeight: 700,
          letterSpacing: 3, margin: "0 0 12px", lineHeight: 1.1,
          background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          YOU'RE IN
        </h1>

        {order?.buyer_email && (
          <p style={{ fontSize: 13, color: BRAND.gray, margin: 0 }}>
            We've also emailed your tickets to{" "}
            <strong style={{ color: BRAND.white, fontWeight: 600 }}>{order.buyer_email}</strong>
          </p>
        )}
      </div>

      {/* Event header card */}
      {event && (
        <div style={{
          padding: "20px 22px", background: BRAND.cardBg,
          borderRadius: 14, border: "1px solid #222", marginBottom: 28,
        }}>
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 11,
            color: BRAND.accent, letterSpacing: 3, marginBottom: 6,
            textTransform: "uppercase",
          }}>
            {venue.name}
          </div>
          <h2 style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700,
            letterSpacing: 1, margin: "0 0 12px", color: BRAND.white,
            lineHeight: 1.2,
          }}>
            {event.name}
          </h2>

          {event.starts_at && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ marginRight: 8 }}>📅</span>
              <span style={{
                fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500,
                color: BRAND.white, letterSpacing: 0.5,
              }}>
                {formatEventDate(event.starts_at)}
              </span>
              <div style={{
                fontFamily: "'Space Mono', monospace", fontSize: 11,
                color: BRAND.gray, marginLeft: 28, marginTop: 2,
              }}>
                {event.doors_at
                  ? `Doors ${formatEventTime(event.doors_at)} · Event ${formatEventTime(event.starts_at)}`
                  : `${formatEventTime(event.starts_at)}${event.ends_at ? ` — ${formatEventTime(event.ends_at)}` : ""}`}
              </div>
            </div>
          )}

          {(event.location_name || event.location_address) && (
            <div>
              <span style={{ marginRight: 8 }}>📍</span>
              <span style={{
                fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500,
                color: BRAND.white, letterSpacing: 0.5,
              }}>
                {event.location_name || event.location_address}
              </span>
              {event.location_name && event.location_address && (
                <div style={{
                  fontFamily: "'Space Mono', monospace", fontSize: 11,
                  color: BRAND.gray, marginLeft: 28, marginTop: 2,
                }}>
                  {event.location_address}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tickets section */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
          letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase",
          marginBottom: 6, paddingBottom: 8,
          borderBottom: `1px solid ${BRAND.accentMuted}`,
        }}>
          Your {visibleTickets.length === 1 ? "Ticket" : "Tickets"}
        </h3>

        <p style={{
          fontSize: 13, color: BRAND.gray, marginBottom: 18,
          textAlign: "center", lineHeight: 1.5,
        }}>
          Show the QR code at the door — staff will scan to check you in.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {visibleTickets.map((ticket, idx) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              ticketType={ticketTypesById[ticket.ticket_type_id]}
              index={idx}
              total={visibleTickets.length}
              BRAND={BRAND}
            />
          ))}
        </div>

        {/* Partial refund note */}
        {tickets.length > visibleTickets.length && (
          <p style={{
            fontSize: 11, color: BRAND.dimText, marginTop: 14,
            fontFamily: "'Space Mono', monospace", letterSpacing: 1,
            textAlign: "center",
          }}>
            {tickets.length - visibleTickets.length} REFUNDED — NOT SHOWN
          </p>
        )}
      </div>

      {/* Order summary */}
      {order && (
        <div style={{
          padding: "18px 20px", background: BRAND.cardBg,
          borderRadius: 12, border: "1px solid #222",
        }}>
          <h3 style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600,
            letterSpacing: 3, color: BRAND.gray, textTransform: "uppercase",
            margin: "0 0 12px",
          }}>
            Order Summary
          </h3>
          <SummaryLine label="Subtotal" value={formatCents(order.subtotal_cents)} BRAND={BRAND} />
          {order.fee_cents > 0 && (
            <SummaryLine label="Processing" value={formatCents(order.fee_cents)} BRAND={BRAND} />
          )}
          <div style={{ height: 1, background: "#333", margin: "8px 0" }} />
          <SummaryLine
            label="Total"
            value={formatCents(order.total_cents)}
            bold
            BRAND={BRAND}
          />
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 10,
            color: BRAND.dimText, letterSpacing: 1, marginTop: 14,
            wordBreak: "break-all",
          }}>
            ORDER {order.id}
          </div>
        </div>
      )}

      <p style={{
        textAlign: "center", fontSize: 11, color: BRAND.dimText, marginTop: 24,
        fontFamily: "'Space Mono', monospace", letterSpacing: 1,
      }}>
        QUESTIONS? CONTACT THE VENUE.
      </p>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * Renders one ticket card. The QR code is generated client-side from the
 * same qr_token string that the webhook used server-side for email — they're
 * deterministically identical, so scanning either works.
 */
function TicketCard({ ticket, ticketType, index, total, BRAND }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrError, setQrError] = useState(false);
  const isCheckedIn = ticket.status === "checked_in";

  useEffect(() => {
    let cancelled = false;

    QRCode.toDataURL(ticket.qr_token, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((err) => {
        console.error("QR render failed:", err);
        if (!cancelled) setQrError(true);
      });

    return () => { cancelled = true; };
  }, [ticket.qr_token]);

  return (
    <div style={{
      background: "#ffffff", borderRadius: 16, overflow: "hidden",
      boxShadow: `0 4px 24px ${BRAND.primaryGlow}`,
      position: "relative",
      opacity: isCheckedIn ? 0.65 : 1,
    }}>
      {/* Tier name + count header */}
      <div style={{
        padding: "16px 20px 12px",
        background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
        textAlign: "center",
      }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600,
          letterSpacing: 4, color: "rgba(255,255,255,0.85)",
          textTransform: "uppercase", marginBottom: 2,
        }}>
          {ticketType?.name || "Ticket"}
        </div>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500,
          color: "rgba(255,255,255,0.7)", letterSpacing: 1,
        }}>
          Ticket {index + 1} of {total}
        </div>
      </div>

      {/* QR code area */}
      <div style={{ padding: "20px", textAlign: "center", background: "#ffffff" }}>
        {isCheckedIn ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", minHeight: 240, gap: 12,
          }}>
            <div style={{
              fontFamily: "'Oswald', sans-serif", fontSize: 24, fontWeight: 700,
              letterSpacing: 4, color: "#888",
            }}>
              ✓ CHECKED IN
            </div>
            {ticket.checked_in_at && (
              <div style={{
                fontFamily: "'Space Mono', monospace", fontSize: 11,
                color: "#999", letterSpacing: 1,
              }}>
                {new Date(ticket.checked_in_at).toLocaleString("en-US", {
                  month: "short", day: "numeric",
                  hour: "numeric", minute: "2-digit",
                })}
              </div>
            )}
          </div>
        ) : qrError ? (
          <div style={{
            padding: "60px 20px",
            color: "#999", fontFamily: "'Space Mono', monospace", fontSize: 12,
          }}>
            Could not generate QR code. Use the token below to check in:
            <div style={{
              marginTop: 12, padding: "8px 12px",
              background: "#f5f5f5", borderRadius: 6,
              fontSize: 11, wordBreak: "break-all", color: "#333",
            }}>
              {ticket.qr_token}
            </div>
          </div>
        ) : qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`QR code for ticket ${index + 1}`}
            width={240}
            height={240}
            style={{ display: "block", margin: "0 auto" }}
          />
        ) : (
          <div style={{
            width: 240, height: 240, margin: "0 auto",
            background: "#f5f5f5", borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#bbb", fontFamily: "'Space Mono', monospace", fontSize: 11,
            letterSpacing: 2,
          }}>
            LOADING…
          </div>
        )}

        {/* Token text — backup if QR fails to scan */}
        {!isCheckedIn && !qrError && (
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 10,
            color: "#999", letterSpacing: 1, marginTop: 14,
            wordBreak: "break-all",
          }}>
            {ticket.qr_token}
          </div>
        )}
      </div>

      {/* Attendee row */}
      {ticket.attendee_name && (
        <div style={{
          padding: "10px 20px 16px",
          background: "#ffffff",
          borderTop: "1px solid #f0f0f0",
          textAlign: "center",
        }}>
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 10,
            letterSpacing: 2, color: "#888", textTransform: "uppercase",
            marginBottom: 2,
          }}>
            Attendee
          </div>
          <div style={{ fontSize: 14, color: "#0a0a0a" }}>
            {ticket.attendee_name}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Generic centered status screen — used for not_found, error, failed, timeout.
 */
function StatusScreen({ BRAND, icon, title, titleColor, body }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", padding: 24, gap: 18,
      textAlign: "center", color: BRAND.white,
    }}>
      {icon === "spinner" && (
        <>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            border: "3px solid #222", borderTopColor: BRAND.accent,
            animation: "spin 1s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}
      {icon === "email" && (
        <div style={{ fontSize: 48 }}>📧</div>
      )}

      <h1 style={{
        fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700,
        letterSpacing: 4, margin: 0,
        color: titleColor || undefined,
        background: titleColor ? undefined : `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
        WebkitBackgroundClip: titleColor ? undefined : "text",
        WebkitTextFillColor: titleColor ? undefined : "transparent",
      }}>
        {title}
      </h1>

      {body && (
        <p style={{
          color: BRAND.gray, maxWidth: 420, lineHeight: 1.6,
          margin: 0, fontSize: 14,
        }}>
          {body}
        </p>
      )}
    </div>
  );
}

/**
 * Polling screen — shown while we wait for the webhook to flip the order to 'paid'.
 * Encouraging tone, not alarming. Includes a subtle indicator of poll progress.
 */
function PollingScreen({ BRAND, attempts }) {
  const percentage = Math.min(100, (attempts / MAX_POLL_ATTEMPTS) * 100);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", padding: 24, gap: 20,
      textAlign: "center", color: BRAND.white,
    }}>
      <div style={{
        width: 60, height: 60, borderRadius: "50%",
        border: "3px solid #222", borderTopColor: BRAND.accent,
        animation: "spin 1s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <h1 style={{
        fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700,
        letterSpacing: 3, margin: 0,
        background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
      }}>
        FINALIZING YOUR TICKETS
      </h1>

      <p style={{
        color: BRAND.gray, maxWidth: 380, lineHeight: 1.6,
        margin: 0, fontSize: 14,
      }}>
        Your payment was successful. We're just generating your QR codes —
        this usually takes a few seconds.
      </p>

      {/* Subtle progress bar */}
      <div style={{
        width: 200, height: 3, background: "#222",
        borderRadius: 2, overflow: "hidden", marginTop: 4,
      }}>
        <div style={{
          width: `${percentage}%`, height: "100%",
          background: `linear-gradient(90deg, ${BRAND.primary}, ${BRAND.accent})`,
          transition: "width 0.4s ease",
        }} />
      </div>

      <p style={{
        fontFamily: "'Space Mono', monospace", fontSize: 10,
        color: BRAND.dimText, letterSpacing: 2, margin: 0,
      }}>
        DO NOT CLOSE THIS PAGE
      </p>
    </div>
  );
}

/**
 * Refunded screen — shown when the visitor returns to the URL after their
 * order was refunded.
 */
function RefundedScreen({ BRAND, order, event }) {
  return (
    <div style={{
      maxWidth: 480, margin: "0 auto", padding: "60px 20px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>💸</div>

      <h1 style={{
        fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700,
        letterSpacing: 4, margin: "0 0 16px", color: BRAND.white,
      }}>
        ORDER REFUNDED
      </h1>

      <p style={{
        color: BRAND.gray, lineHeight: 1.6, fontSize: 14, margin: "0 0 24px",
      }}>
        {event ? (
          <>
            Your order for <strong style={{ color: BRAND.white }}>{event.name}</strong>{" "}
            has been refunded
            {order?.refund_amount_cents
              ? <> in the amount of <strong style={{ color: BRAND.accent }}>{formatCents(order.refund_amount_cents)}</strong></>
              : null}
            . The refund should appear on your card within 5-10 business days.
          </>
        ) : (
          <>
            Your order has been refunded. The refund should appear on your
            card within 5-10 business days.
          </>
        )}
      </p>

      {order && (
        <div style={{
          padding: "14px 18px", background: BRAND.cardBg,
          borderRadius: 10, border: "1px solid #222",
          fontFamily: "'Space Mono', monospace", fontSize: 10,
          color: BRAND.dimText, letterSpacing: 1,
          wordBreak: "break-all",
        }}>
          ORDER {order.id}
        </div>
      )}

      <p style={{
        fontSize: 12, color: BRAND.dimText, marginTop: 24, lineHeight: 1.5,
      }}>
        Questions about your refund? Contact the venue directly.
      </p>
    </div>
  );
}

function SummaryLine({ label, value, bold, BRAND }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: bold ? 17 : 13,
      fontFamily: bold ? "'Oswald', sans-serif" : "'Inter', sans-serif",
      fontWeight: bold ? 700 : 400,
      color: bold ? BRAND.white : BRAND.gray,
      letterSpacing: bold ? 1 : 0,
      padding: "3px 0",
    }}>
      <span>{label}</span>
      <span style={{
        fontFamily: "'Space Mono', monospace",
        color: bold ? BRAND.accent : BRAND.gray,
      }}>
        {value}
      </span>
    </div>
  );
}
