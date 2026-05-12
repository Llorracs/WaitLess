/**
 * ============================================
 * WAITLESS — Refund Processing (v3 — uses captured per-ticket price)
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/process-refund.js
 *
 * CHANGE FROM v2 (mandatory reason):
 *   For per-ticket refunds, use tickets.price_paid_cents (captured at
 *   purchase time) instead of the current ticket_types.price_cents.
 *
 *   This means: if the venue raised the price from $25 to $30 after a buyer
 *   purchased at $25, refunding that buyer's ticket returns $25, not $30.
 *
 * RULES (unchanged):
 *   1. Caller must be venue owner OR staff with role 'admin' or 'organizer'
 *   2. Order must be in 'paid' status
 *   3. Full refunds blocked if ANY ticket is checked_in
 *   4. Per-ticket refunds: only 'valid' tickets are refundable
 *   5. Square keeps processing fee on refunds (venue eats it)
 *   6. Reason is MANDATORY (validated via STANDARD_REASONS or "other:<text>")
 * ============================================
 */

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Waitless Tickets <tickets@waitless.events>";

const STANDARD_REASONS = new Set([
  "customer_cancellation",
  "buyer_no_show",
  "event_cancelled",
  "duplicate_purchase",
  "order_error",
]);

const REASON_LABELS = {
  customer_cancellation: "Customer requested cancellation",
  buyer_no_show: "Buyer unable to attend",
  event_cancelled: "Event cancelled",
  duplicate_purchase: "Duplicate purchase",
  order_error: "Order error",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function err(statusCode, message, extra = {}) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: false, error: message, ...extra }),
  };
}

function ok(payload) {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true, ...payload }),
  };
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validateReason(rawReason) {
  if (typeof rawReason !== "string") {
    return { ok: false, error: "Refund reason is required" };
  }

  const trimmed = rawReason.trim();
  if (trimmed.length < 3) {
    return { ok: false, error: "Refund reason must be at least 3 characters" };
  }

  if (STANDARD_REASONS.has(trimmed)) {
    return {
      ok: true,
      normalizedReason: trimmed,
      displayLabel: REASON_LABELS[trimmed],
    };
  }

  if (trimmed.startsWith("other:")) {
    const detail = trimmed.slice(6).trim();
    if (detail.length < 3) {
      return { ok: false, error: "Please specify a reason ('Other' requires detail)" };
    }
    return {
      ok: true,
      normalizedReason: `other:${detail}`,
      displayLabel: `Other — ${detail}`,
    };
  }

  return {
    ok: true,
    normalizedReason: trimmed,
    displayLabel: trimmed,
  };
}

async function authorizeStaff(authToken, venueId) {
  if (!authToken) return { ok: false, reason: "Missing auth token" };

  const callerClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${authToken}` } } }
  );

  const { data: user, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user?.user) return { ok: false, reason: "Invalid auth token" };

  const userId = user.user.id;
  const userEmail = user.user.email;

  const { data: venue } = await supabase
    .from("venues")
    .select("owner_id")
    .eq("id", venueId)
    .single();

  if (venue?.owner_id === userId) {
    return { ok: true, userId, role: "owner" };
  }

  const { data: staffRow } = await supabase
    .from("staff")
    .select("role, is_active")
    .eq("venue_id", venueId)
    .eq("email", userEmail)
    .eq("is_active", true)
    .maybeSingle();

  if (!staffRow) return { ok: false, reason: "Not a staff member at this venue" };
  if (!["admin", "organizer"].includes(staffRow.role)) {
    return { ok: false, reason: `Role '${staffRow.role}' cannot issue refunds` };
  }

  return { ok: true, userId, role: staffRow.role };
}

async function squareRefundPayment(venue, paymentId, amountCents, currency, reasonText) {
  const baseUrl = venue.square_environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

  const idempotencyKey = `refund-${paymentId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const resp = await fetch(`${baseUrl}/v2/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${venue.square_access_token}`,
      "Square-Version": "2026-01-22",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      payment_id: paymentId,
      amount_money: { amount: amountCents, currency: currency || "USD" },
      reason: reasonText.slice(0, 192),
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    const error = new Error("Square refund failed");
    error.squareErrors = data.errors;
    throw error;
  }
  return data.refund;
}

async function sendRefundEmail({ venue, eventRow, order, refundedTickets, refundAmountCents, mode }) {
  const venuePrimary = venue.brand_colors?.primary || "#e91e8c";
  const venueAccent = venue.brand_colors?.accent || "#d4a843";

  const eventDate = eventRow ? new Date(eventRow.starts_at).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }) : "";

  const refundedList = refundedTickets.length
    ? `<ul style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 12px; color: #666; padding-left: 20px;">
        ${refundedTickets.map(t => `<li>${escapeHtml(t.qr_token)}</li>`).join("")}
      </ul>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, ${venuePrimary}, ${venueAccent}); padding: 36px 28px; text-align: center;">
              <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 4px; color: rgba(255,255,255,0.85); text-transform: uppercase; margin-bottom: 12px;">
                Refund Confirmation
              </div>
              <h1 style="margin: 0; font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 28px; font-weight: 700; letter-spacing: 1px; color: #ffffff;">
                ${escapeHtml(venue.name)}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px;">
              <p style="font-size: 16px; color: #0a0a0a; line-height: 1.6; margin: 0 0 12px;">
                Hi ${escapeHtml(order.buyer_name.split(" ")[0])},
              </p>
              <p style="font-size: 15px; color: #444; line-height: 1.6; margin: 0 0 20px;">
                ${mode === "full"
                  ? `Your full order for <strong>${escapeHtml(eventRow?.name || "this event")}</strong> has been refunded.`
                  : `${refundedTickets.length} ticket${refundedTickets.length === 1 ? "" : "s"} from your order for <strong>${escapeHtml(eventRow?.name || "this event")}</strong> ${refundedTickets.length === 1 ? "has" : "have"} been refunded.`}
              </p>
              ${eventDate ? `
              <div style="background: #fafafa; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px;">
                <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 600; letter-spacing: 2px; color: ${venuePrimary}; text-transform: uppercase; margin-bottom: 4px;">Event</div>
                <div style="font-size: 15px; color: #0a0a0a;">${escapeHtml(eventRow.name)}</div>
                <div style="font-size: 13px; color: #888; margin-top: 2px;">${escapeHtml(eventDate)}</div>
              </div>
              ` : ""}
              ${refundedList ? `
              <div style="margin-bottom: 20px;">
                <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 2px; color: #666; text-transform: uppercase; margin-bottom: 8px;">Refunded Tickets</div>
                ${refundedList}
              </div>
              ` : ""}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid #e5e5e5; padding-top: 16px; margin-top: 8px;">
                <tr>
                  <td style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #0a0a0a;">Refunded</td>
                  <td style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 700; color: ${venueAccent}; text-align: right;">$${(refundAmountCents / 100).toFixed(2)}</td>
                </tr>
              </table>
              <p style="font-size: 13px; color: #666; line-height: 1.6; margin: 20px 0 0;">
                The refund will appear on your original payment method within 5-10 business days. Processing fees are non-refundable per our refund policy. If you have questions, reply to this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background: #0a0a0a; padding: 20px 28px; text-align: center;">
              <div style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 10px; color: #555; letter-spacing: 1px;">
                Order ID: ${escapeHtml(order.id)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${venue.name} — Refund Confirmation`,
    "",
    mode === "full"
      ? `Your full order for ${eventRow?.name || "this event"} has been refunded.`
      : `${refundedTickets.length} ticket(s) from your order for ${eventRow?.name || "this event"} have been refunded.`,
    "",
    `Refunded: $${(refundAmountCents / 100).toFixed(2)}`,
    "",
    "The refund will appear on your original payment method within 5-10 business days. Processing fees are non-refundable.",
    `Order ID: ${order.id}`,
  ].join("\n");

  try {
    await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM_DEFAULT || DEFAULT_FROM,
        to: [order.buyer_email],
        subject: `Refund confirmed — ${eventRow?.name || venue.name}`,
        html,
        text,
      }),
    });
  } catch (emailErr) {
    console.error("Refund email send failed:", emailErr);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return err(405, "Method not allowed");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return err(400, "Invalid JSON body");
  }

  const { orderId, mode, ticketIds, reason } = body;

  if (!orderId) return err(400, "Missing orderId");
  if (!["full", "tickets"].includes(mode)) {
    return err(400, "mode must be 'full' or 'tickets'");
  }
  if (mode === "tickets" && (!Array.isArray(ticketIds) || ticketIds.length === 0)) {
    return err(400, "ticketIds is required for mode='tickets'");
  }

  const reasonResult = validateReason(reason);
  if (!reasonResult.ok) {
    return err(400, reasonResult.error);
  }

  const { data: order, error: orderErr } = await supabase
    .from("ticket_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) return err(404, "Order not found");
  if (order.status !== "paid") {
    return err(400, `Cannot refund order in '${order.status}' status`);
  }
  if (!order.square_payment_id) {
    return err(400, "Order has no Square payment to refund");
  }

  const authHeader = event.headers["authorization"] || event.headers["Authorization"] || "";
  const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const authResult = await authorizeStaff(authToken, order.venue_id);
  if (!authResult.ok) {
    return err(403, `Forbidden: ${authResult.reason}`);
  }

  const { data: allTickets, error: ticketsErr } = await supabase
    .from("tickets")
    .select("*")
    .eq("order_id", order.id);

  if (ticketsErr || !allTickets) return err(500, "Failed to load tickets");

  let ticketsToRefund;
  let refundAmountCents;

  if (mode === "full") {
    const checkedIn = allTickets.filter((t) => t.status === "checked_in");
    if (checkedIn.length > 0) {
      const firstCheckin = checkedIn[0];
      return err(409, "Cannot refund — at least one ticket has been checked in", {
        details: `Ticket ${firstCheckin.qr_token} was checked in at ${firstCheckin.checked_in_at}`,
        checkedInCount: checkedIn.length,
      });
    }

    const alreadyRefunded = allTickets.filter((t) => t.status === "refunded");
    if (alreadyRefunded.length === allTickets.length) {
      return err(409, "All tickets in this order are already refunded");
    }

    ticketsToRefund = allTickets.filter((t) => t.status === "valid");
    refundAmountCents = order.total_cents - (order.refund_amount_cents || 0);

  } else {
    const requestedSet = new Set(ticketIds);
    ticketsToRefund = allTickets.filter((t) => requestedSet.has(t.id));

    if (ticketsToRefund.length === 0) {
      return err(404, "No matching tickets found in this order");
    }

    const blocked = ticketsToRefund.filter((t) => t.status !== "valid");
    if (blocked.length > 0) {
      const first = blocked[0];
      const stateDesc = first.status === "checked_in"
        ? `was checked in at ${first.checked_in_at}`
        : `is in '${first.status}' status and cannot be refunded`;
      return err(409, `Cannot refund ticket ${first.qr_token} — it ${stateDesc}`, {
        blockedCount: blocked.length,
      });
    }

    // ========================================================================
    // CHANGE FROM v2: use captured price_paid_cents per ticket, NOT current
    // ticket_types.price_cents. This means the refund returns what the buyer
    // actually paid, even if the venue has changed the price since.
    //
    // Fallback: if price_paid_cents is NULL (legacy tickets from before the
    // migration), fall back to current ticket_types.price_cents. Backfill SQL
    // should already have set this for all existing tickets, so the fallback
    // is defensive.
    // ========================================================================
    const ticketsMissingPrice = ticketsToRefund.filter((t) => t.price_paid_cents == null);
    let priceByTicketTypeFallback = new Map();

    if (ticketsMissingPrice.length > 0) {
      const ttIds = [...new Set(ticketsMissingPrice.map((t) => t.ticket_type_id))];
      const { data: ticketTypes } = await supabase
        .from("ticket_types")
        .select("id, price_cents")
        .in("id", ttIds);
      priceByTicketTypeFallback = new Map((ticketTypes || []).map((tt) => [tt.id, tt.price_cents]));
    }

    refundAmountCents = ticketsToRefund.reduce((sum, t) => {
      const price = t.price_paid_cents ?? priceByTicketTypeFallback.get(t.ticket_type_id) ?? 0;
      return sum + price;
    }, 0);

    if (refundAmountCents <= 0) {
      return err(400, "Computed refund amount is zero");
    }
  }

  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, name, brand_colors, currency, square_access_token, square_environment")
    .eq("id", order.venue_id)
    .single();

  if (venueErr || !venue) return err(500, "Venue not found");
  if (!venue.square_access_token) return err(500, "Venue has no Square credentials");

  let refund;
  try {
    refund = await squareRefundPayment(
      venue,
      order.square_payment_id,
      refundAmountCents,
      venue.currency || "USD",
      reasonResult.displayLabel
    );
  } catch (squareErr) {
    console.error("Square refund failed:", squareErr.squareErrors || squareErr);
    return err(502, "Square rejected the refund", {
      squareErrors: squareErr.squareErrors,
    });
  }

  const refundedAt = new Date().toISOString();

  await supabase
    .from("tickets")
    .update({
      status: "refunded",
      refunded_at: refundedAt,
      refunded_by: authResult.userId,
    })
    .in("id", ticketsToRefund.map((t) => t.id));

  const refundCountByType = ticketsToRefund.reduce((acc, t) => {
    acc[t.ticket_type_id] = (acc[t.ticket_type_id] || 0) + 1;
    return acc;
  }, {});

  for (const [ticketTypeId, count] of Object.entries(refundCountByType)) {
    const { data: tt } = await supabase
      .from("ticket_types")
      .select("quantity_sold")
      .eq("id", ticketTypeId)
      .single();
    if (tt) {
      await supabase
        .from("ticket_types")
        .update({ quantity_sold: Math.max(0, (tt.quantity_sold || 0) - count) })
        .eq("id", ticketTypeId);
    }
  }

  const remainingValid = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id)
    .eq("status", "valid");

  const stillHasValidTickets = (remainingValid.count || 0) > 0;
  const newOrderStatus = stillHasValidTickets ? "paid" : "refunded";
  const cumulativeRefund = (order.refund_amount_cents || 0) + refundAmountCents;

  await supabase
    .from("ticket_orders")
    .update({
      status: newOrderStatus,
      refunded_at: newOrderStatus === "refunded" ? refundedAt : order.refunded_at,
      refunded_by: newOrderStatus === "refunded" ? authResult.userId : order.refunded_by,
      refund_reason: reasonResult.normalizedReason,
      refund_amount_cents: cumulativeRefund,
      square_refund_id: refund.id,
    })
    .eq("id", order.id);

  const { data: eventRow } = await supabase
    .from("events")
    .select("name, starts_at")
    .eq("id", order.event_id)
    .single();

  await sendRefundEmail({
    venue,
    eventRow,
    order,
    refundedTickets: ticketsToRefund,
    refundAmountCents,
    mode,
  });

  return ok({
    orderId: order.id,
    mode,
    refundedTicketCount: ticketsToRefund.length,
    refundAmountCents,
    squareRefundId: refund.id,
    newOrderStatus,
    reason: reasonResult.displayLabel,
  });
};
