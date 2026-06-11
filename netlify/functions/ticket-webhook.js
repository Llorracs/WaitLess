/**
 * ============================================
 * WAITLESS — Square Payment Webhook (v5 — per-venue signature keys)
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/ticket-webhook.js
 *
 * CHANGE FROM v5 (QR RENDERING FIX):
 *   v5 generated QR codes as base64 data URIs using the `qrcode` npm package.
 *   Gmail and Outlook block data: URIs in email images, so QR codes were
 *   invisible to most ticket buyers.
 *
 *   This patch replaces data URI generation with qrserver.com hosted URLs:
 *     https://api.qrserver.com/v1/create-qr-code/?data=WL-trfq-...&size=300x300
 *
 *   The URL is a real HTTPS image — every email client renders it correctly.
 *   No API key required. No other logic changed.
 *
 * UNCHANGED FROM v5:
 *   - Per-venue signature key lookup
 *   - 3-step order lookup chain (reference_id → square_order_id → API fallback)
 *   - price_paid_cents capture per ticket
 *   - Idempotency (Already processed / terminal state guards)
 *   - Oversold detection with status='failed' flag
 *   - quantity_sold increment per ticket type
 *   - Email composition via Resend
 *   - QR token generation
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

// ============================================================================
// SIGNATURE VERIFICATION
// ============================================================================

function verifySquareSignature(rawBody, signatureHeader, signatureKey, notificationUrl) {
  if (!signatureHeader || !signatureKey) return false;

  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expectedSignature = hmac.digest("base64");

  try {
    const a = Buffer.from(expectedSignature, "utf8");
    const b = Buffer.from(signatureHeader, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ============================================================================
// QR + TOKEN HELPERS
// ============================================================================

function generateQrToken(venueSlug) {
  const random = crypto.randomBytes(8).toString("hex");
  return `WL-${venueSlug}-${random}`;
}

/**
 * Returns a hosted QR code URL instead of a base64 data URI.
 * Gmail and Outlook block data: URIs — this URL renders in every client.
 */
function buildQrUrl(token) {
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(token)}&size=300x300&color=0a0a0a&bgcolor=ffffff`;
}

// ============================================================================
// EMAIL TEMPLATE
// ============================================================================

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTicketEmail({ venue, event, order, tickets, qrUrls }) {
  const venuePrimary = venue.brand_colors?.primary || "#e91e8c";
  const venueAccent = venue.brand_colors?.accent || "#d4a843";

  const eventDate = new Date(event.starts_at).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const ticketBlocks = tickets.map((ticket, i) => {
    const ticketType = ticket._ticketType;
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; background: #ffffff; border: 1px solid #e5e5e5; border-radius: 12px;">
        <tr>
          <td style="padding: 24px; text-align: center;">
            <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 3px; color: ${venuePrimary}; text-transform: uppercase; margin-bottom: 4px;">
              ${escapeHtml(ticketType.name)}
            </div>
            <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 14px; color: #666; margin-bottom: 16px;">
              Ticket ${i + 1} of ${tickets.length}
            </div>
            <img src="${qrUrls[i]}" alt="Ticket QR Code" width="240" height="240" style="display: block; margin: 0 auto; border: none;" />
            <div style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 11px; color: #999; letter-spacing: 1px; margin-top: 12px; word-break: break-all;">
              ${escapeHtml(ticket.qr_token)}
            </div>
          </td>
        </tr>
      </table>
    `;
  }).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your tickets to ${escapeHtml(event.name)}</title>
</head>
<body style="margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, ${venuePrimary}, ${venueAccent}); padding: 36px 28px; text-align: center;">
              <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 4px; color: rgba(255,255,255,0.85); text-transform: uppercase; margin-bottom: 12px;">
                ${escapeHtml(venue.name)} presents
              </div>
              <h1 style="margin: 0; font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 32px; font-weight: 700; letter-spacing: 1px; color: #ffffff; line-height: 1.2;">
                ${escapeHtml(event.name)}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 28px 8px;">
              <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 16px; color: #0a0a0a; line-height: 1.6;">
                Hi ${escapeHtml(order.buyer_name.split(" ")[0])},
              </div>
              <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; color: #444; line-height: 1.6; margin-top: 12px;">
                Your ${tickets.length === 1 ? "ticket is" : `${tickets.length} tickets are`} attached below. Show the QR code at the door — staff will scan to check you in.
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #fafafa; border-radius: 12px; padding: 0;">
                <tr>
                  <td style="padding: 18px 20px;">
                    <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 600; letter-spacing: 2px; color: ${venuePrimary}; text-transform: uppercase; margin-bottom: 4px;">When</div>
                    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; color: #0a0a0a; line-height: 1.5;">
                      ${escapeHtml(eventDate)}
                    </div>
                  </td>
                </tr>
                ${event.location_name ? `
                <tr>
                  <td style="padding: 0 20px 18px;">
                    <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 600; letter-spacing: 2px; color: ${venuePrimary}; text-transform: uppercase; margin-bottom: 4px; margin-top: 12px;">Where</div>
                    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; color: #0a0a0a; line-height: 1.5;">
                      ${escapeHtml(event.location_name)}
                    </div>
                    ${event.location_address ? `
                    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 13px; color: #888; line-height: 1.5; margin-top: 2px;">
                      ${escapeHtml(event.location_address)}
                    </div>
                    ` : ""}
                  </td>
                </tr>
                ` : ""}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 28px 28px;">
              <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 3px; color: #666; text-transform: uppercase; margin-bottom: 16px;">
                Your ${tickets.length === 1 ? "Ticket" : "Tickets"}
              </div>
              ${ticketBlocks}
            </td>
          </tr>
          <tr>
            <td style="padding: 0 28px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid #e5e5e5; padding-top: 20px;">
                <tr>
                  <td style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 12px; color: #888; padding: 4px 0;">Subtotal</td>
                  <td style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 12px; color: #888; padding: 4px 0; text-align: right;">$${(order.subtotal_cents / 100).toFixed(2)}</td>
                </tr>
                ${order.fee_cents > 0 ? `
                <tr>
                  <td style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 12px; color: #888; padding: 4px 0;">Processing fee</td>
                  <td style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 12px; color: #888; padding: 4px 0; text-align: right;">$${(order.fee_cents / 100).toFixed(2)}</td>
                </tr>
                ` : ""}
                <tr>
                  <td style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #0a0a0a; padding: 12px 0 4px; border-top: 1px solid #e5e5e5;">Total</td>
                  <td style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: ${venueAccent}; padding: 12px 0 4px; text-align: right; border-top: 1px solid #e5e5e5;">$${(order.total_cents / 100).toFixed(2)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background: #0a0a0a; padding: 24px 28px; text-align: center;">
              <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 4px; color: ${venueAccent}; text-transform: uppercase; margin-bottom: 6px;">
                Waitless
              </div>
              <div style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 10px; color: #666; letter-spacing: 1px;">
                Weightless service, zero wait
              </div>
              <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 11px; color: #555; margin-top: 16px; line-height: 1.5;">
                Need help? Reply to this email and we'll get back to you.<br />
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
    `${venue.name} presents ${event.name}`,
    "",
    `When: ${eventDate}`,
    event.location_name ? `Where: ${event.location_name}` : null,
    event.location_address ? `       ${event.location_address}` : null,
    "",
    `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}:`,
    ...tickets.map((t, i) => `  Ticket ${i + 1}: ${t.qr_token}`),
    "",
    `Total: $${(order.total_cents / 100).toFixed(2)}`,
    `Order ID: ${order.id}`,
    "",
    "Show the QR code at the door. Powered by Waitless.",
  ].filter(Boolean).join("\n");

  return { html, text };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const rawBody = event.body || "";
  const signatureHeader = event.headers["x-square-hmacsha256-signature"]
    || event.headers["X-Square-HmacSha256-Signature"];

  const notificationUrl = `${process.env.URL || "https://waitless.events"}/.netlify/functions/ticket-webhook`;

  // Step 1: parse JSON body — without trusting it yet
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // Step 2: extract merchant_id from (still untrusted) body
  const merchantId = payload.merchant_id || payload.merchantId;
  if (!merchantId) {
    console.warn("Webhook with no merchant_id");
    return { statusCode: 200, body: "No merchant_id" };
  }

  // Step 3: read-only DB lookup — find venue by merchant_id
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, slug, name, brand_colors, square_access_token, square_environment, square_merchant_id, square_webhook_signature_key")
    .eq("square_merchant_id", merchantId)
    .eq("is_active", true)
    .single();

  if (venueErr || !venue) {
    console.warn(`Webhook from unknown merchant_id: ${merchantId}`);
    return { statusCode: 200, body: "Unknown merchant" };
  }

  // Step 4: verify signature using THIS venue's stored signature key
  const signatureKey = venue.square_webhook_signature_key;
  if (!signatureKey) {
    console.error(`Venue ${venue.slug} has no square_webhook_signature_key configured`);
    return { statusCode: 500, body: "Webhook not configured for this venue" };
  }

  if (!verifySquareSignature(rawBody, signatureHeader, signatureKey, notificationUrl)) {
    console.warn(`Invalid Square webhook signature for venue ${venue.slug} (merchant ${merchantId})`);
    return { statusCode: 401, body: "Invalid signature" };
  }

  if (payload.type !== "payment.updated") {
    return { statusCode: 200, body: "Ignored — not a payment event" };
  }

  const payment = payload.data?.object?.payment;
  if (!payment) {
    return { statusCode: 200, body: "Ignored — no payment object" };
  }

  if (payment.status !== "COMPLETED") {
    return { statusCode: 200, body: `Ignored — payment status is ${payment.status}` };
  }

  let order = null;
  let orderId = payment.reference_id || payment.referenceId || payment.order?.referenceId;
  const squareOrderId = payment.order_id || payment.orderId;

  // Step 1: try direct reference_id (Web Payments SDK case)
  if (orderId) {
    const { data: orderByRef } = await supabase
      .from("ticket_orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    if (orderByRef) order = orderByRef;
  }

  // Step 2: fallback to lookup by square_order_id (hosted checkout case)
  if (!order && squareOrderId) {
    const { data: orderByOrderId } = await supabase
      .from("ticket_orders")
      .select("*")
      .eq("square_order_id", squareOrderId)
      .maybeSingle();
    if (orderByOrderId) {
      order = orderByOrderId;
      orderId = order.id;
    }
  }

  // Step 3: last resort — fetch the Square Order via API and read referenceId
  if (!order && squareOrderId && venue.square_access_token) {
    try {
      const baseUrl = venue.square_environment === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";
      const resp = await fetch(`${baseUrl}/v2/orders/${squareOrderId}`, {
        headers: {
          Authorization: `Bearer ${venue.square_access_token}`,
          "Square-Version": "2026-01-22",
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        const refId = data.order?.reference_id || data.order?.referenceId;
        if (refId) {
          const { data: orderByApiRef } = await supabase
            .from("ticket_orders")
            .select("*")
            .eq("id", refId)
            .maybeSingle();
          if (orderByApiRef) {
            order = orderByApiRef;
            orderId = order.id;
            await supabase
              .from("ticket_orders")
              .update({ square_order_id: squareOrderId })
              .eq("id", refId);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch Square order for reference lookup:", err);
    }
  }

  if (!order) {
    console.warn(`No matching ticket_orders row for payment ${payment.id}, ` +
      `reference_id=${orderId || "null"}, square_order_id=${squareOrderId || "null"}`);
    return { statusCode: 200, body: "No matching order" };
  }

  if (order.venue_id !== venue.id) {
    console.error(`Order/venue mismatch ${order.id}`);
    return { statusCode: 401, body: "Order/venue mismatch" };
  }

  if (order.status === "paid") {
    return { statusCode: 200, body: "Already processed" };
  }
  if (order.status === "refunded" || order.status === "failed") {
    return { statusCode: 200, body: "Order in terminal state" };
  }

  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, name, slug, starts_at, ends_at, location_name, location_address")
    .eq("id", order.event_id)
    .single();

  if (eventErr || !eventRow) {
    return { statusCode: 200, body: "Event missing" };
  }

  let selections = [];
  const effectiveSquareOrderId = squareOrderId || order.square_order_id;
  if (effectiveSquareOrderId) {
    selections = await loadSelectionsFromSquareOrder(
      { ...order, square_order_id: effectiveSquareOrderId },
      venue
    );
  }

  if (selections.length === 0) {
    console.error(`Selections lost for order ${order.id}, square_order_id=${effectiveSquareOrderId}`);
    await supabase.from("ticket_orders").update({ status: "failed" }).eq("id", order.id);
    return { statusCode: 200, body: "Selections lost" };
  }

  const ttIds = [...new Set(selections.map((s) => s.ticketTypeId))];
  const { data: ticketTypes } = await supabase
    .from("ticket_types")
    .select("*")
    .in("id", ttIds);

  const ttById = new Map((ticketTypes || []).map((t) => [t.id, t]));

  // Inventory check
  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    if (!tt) continue;
    if (tt.quantity_total != null) {
      const remaining = tt.quantity_total - (tt.quantity_sold || 0);
      if (sel.qty > remaining) {
        console.error(`OVERSOLD ${order.id}: ${tt.name} needs ${sel.qty} but ${remaining} remain`);
        await supabase.from("ticket_orders").update({ status: "failed" }).eq("id", order.id);
        return { statusCode: 200, body: "Oversold — flagged for refund" };
      }
    }
  }

  // Increment quantity_sold per type
  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    if (!tt) continue;
    await supabase
      .from("ticket_types")
      .update({ quantity_sold: (tt.quantity_sold || 0) + sel.qty })
      .eq("id", sel.ticketTypeId);
  }

  // Build tickets to insert
  const ticketsToInsert = [];
  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    const priceAtPurchase = tt?.price_cents ?? 0;

    for (let i = 0; i < sel.qty; i++) {
      ticketsToInsert.push({
        venue_id: venue.id,
        event_id: eventRow.id,
        order_id: order.id,
        ticket_type_id: sel.ticketTypeId,
        attendee_name: order.buyer_name,
        attendee_email: order.buyer_email,
        qr_token: generateQrToken(venue.slug),
        status: "valid",
        price_paid_cents: priceAtPurchase,
      });
    }
  }

  const { data: insertedTickets, error: ticketErr } = await supabase
    .from("tickets")
    .insert(ticketsToInsert)
    .select();

  if (ticketErr || !insertedTickets) {
    console.error("Failed to insert tickets", order.id, ticketErr);
    return { statusCode: 500, body: "Ticket creation failed" };
  }

  await supabase
    .from("ticket_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      square_payment_id: payment.id,
    })
    .eq("id", order.id);

  const ticketsWithType = insertedTickets.map((t) => ({
    ...t,
    _ticketType: ttById.get(t.ticket_type_id),
  }));

  // Build hosted QR URLs — no base64, works in Gmail and Outlook
  const qrUrls = ticketsWithType.map((t) => buildQrUrl(t.qr_token));

  const { html, text } = buildTicketEmail({
    venue,
    event: eventRow,
    order: { ...order, status: "paid" },
    tickets: ticketsWithType,
    qrUrls,
  });

  try {
    const emailResp = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM_DEFAULT || DEFAULT_FROM,
        to: [order.buyer_email],
        subject: `Your tickets to ${eventRow.name}`,
        html,
        text,
      }),
    });

    if (!emailResp.ok) {
      console.error(`Resend rejected email for order ${order.id}:`, await emailResp.text());
    }
  } catch (emailErr) {
    console.error(`Email send threw for order ${order.id}:`, emailErr);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, orderId: order.id, ticketsIssued: insertedTickets.length }),
  };
};

async function loadSelectionsFromSquareOrder(order, venue) {
  if (!venue.square_access_token) return [];

  const baseUrl = venue.square_environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

  try {
    const resp = await fetch(`${baseUrl}/v2/orders/${order.square_order_id}`, {
      headers: {
        Authorization: `Bearer ${venue.square_access_token}`,
        "Square-Version": "2026-01-22",
      },
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    const lineItems = data.order?.line_items || [];

    const selections = [];
    for (const li of lineItems) {
      const note = li.note || "";
      if (!note.startsWith("tt:")) continue;
      const ticketTypeId = note.slice(3);
      const qty = parseInt(li.quantity, 10) || 0;
      if (qty > 0) selections.push({ ticketTypeId, qty });
    }
    return selections;
  } catch (err) {
    console.error("Failed to retrieve Square order", err);
    return [];
  }
}
