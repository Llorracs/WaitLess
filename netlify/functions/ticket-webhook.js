/**
 * ============================================
 * WAITLESS — Square Payment Webhook (Multi-Venue)
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/ticket-webhook.js
 *
 * MULTI-VENUE VERSION. Each venue connects their own Square account, and
 * each has their own webhook signature key. This function:
 *
 *   1. Parses the incoming payload to find the merchant_id Square sent it from
 *   2. Looks up the venue with that merchant_id in our database
 *   3. Uses THAT venue's signature key to verify the request
 *   4. Proceeds with the rest of the flow (the actual ticket creation)
 *
 * If we can't find a venue matching the merchant_id, we reject — that
 * payment isn't from a Waitless venue, or the venue hasn't finished onboarding.
 *
 * SETUP (per venue, during onboarding):
 *   1. Venue connects Square via OAuth (already built — square-oauth-callback.js)
 *   2. Venue creates a webhook subscription in their Square Developer Dashboard:
 *      - URL: https://waitless.events/.netlify/functions/ticket-webhook
 *      - Event: payment.updated
 *   3. Square shows them a signature key; they paste it into Waitless admin
 *   4. We save it to venues.square_webhook_signature_key
 *
 * For the first launch (TRFQ-only), the manual step is: get Ashley's signature
 * key after she configures her Square webhook, and UPDATE venues directly
 * via the SQL editor. Admin UI to capture this can come later.
 * ============================================
 */

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const QRCode = require("qrcode");

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

async function renderQrDataUrl(token) {
  return QRCode.toDataURL(token, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
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

function buildTicketEmail({ venue, event, order, tickets, qrDataUrls }) {
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
            <img src="${qrDataUrls[i]}" alt="Ticket QR Code" width="240" height="240" style="display: block; margin: 0 auto; border: none;" />
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

  // -------------------------------------------------------------------------
  // 1. Parse payload (BEFORE signature verification) to find the merchant_id
  //
  // We parse the JSON first so we can look up the right signature key. This
  // is safe — we don't trust ANY data until signature verification passes.
  // We just use the merchant_id to find which key to verify against.
  // -------------------------------------------------------------------------
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const merchantId = payload.merchant_id || payload.merchantId;
  if (!merchantId) {
    console.warn("Webhook missing merchant_id");
    return { statusCode: 400, body: "Missing merchant_id" };
  }

  // -------------------------------------------------------------------------
  // 2. Look up the venue by merchant_id
  // -------------------------------------------------------------------------
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, slug, name, brand_colors, square_webhook_signature_key, square_access_token, square_environment, square_merchant_id")
    .eq("square_merchant_id", merchantId)
    .eq("is_active", true)
    .single();

  if (venueErr || !venue) {
    console.warn(`Webhook from unknown merchant_id: ${merchantId}`);
    // Return 200 so Square doesn't retry — this merchant isn't a Waitless venue
    return { statusCode: 200, body: "Unknown merchant" };
  }

  if (!venue.square_webhook_signature_key) {
    console.error(`Venue ${venue.slug} has no webhook signature key configured`);
    return { statusCode: 500, body: "Webhook key not configured for this venue" };
  }

  // -------------------------------------------------------------------------
  // 3. Verify signature with THIS venue's key
  // -------------------------------------------------------------------------
  if (!verifySquareSignature(rawBody, signatureHeader, venue.square_webhook_signature_key, notificationUrl)) {
    console.warn(`Invalid signature on webhook for venue ${venue.slug} — possible spoofing`);
    return { statusCode: 401, body: "Invalid signature" };
  }

  // -------------------------------------------------------------------------
  // 4. From here on, identical to single-venue version — the merchant is verified
  // -------------------------------------------------------------------------

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

  const orderId = payment.referenceId || payment.reference_id || payment.order?.referenceId;
  if (!orderId) {
    console.error("payment.updated missing reference_id — cannot link to ticket order", payment.id);
    return { statusCode: 200, body: "Ignored — no reference_id" };
  }

  // -------------------------------------------------------------------------
  // 5. Look up our pending order
  // -------------------------------------------------------------------------
  const { data: order, error: orderErr } = await supabase
    .from("ticket_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    console.error("No ticket_order found for reference_id", orderId, orderErr);
    return { statusCode: 200, body: "No matching order" };
  }

  // Defense-in-depth: confirm the order belongs to this venue
  if (order.venue_id !== venue.id) {
    console.error(`Order ${orderId} belongs to venue ${order.venue_id} but webhook came from ${venue.id}`);
    return { statusCode: 401, body: "Order/venue mismatch" };
  }

  // -------------------------------------------------------------------------
  // 6. Idempotency
  // -------------------------------------------------------------------------
  if (order.status === "paid") {
    return { statusCode: 200, body: "Already processed" };
  }
  if (order.status === "refunded" || order.status === "failed") {
    return { statusCode: 200, body: "Order in terminal state" };
  }

  // -------------------------------------------------------------------------
  // 7. Load event
  // -------------------------------------------------------------------------
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, name, slug, starts_at, ends_at, location_name, location_address")
    .eq("id", order.event_id)
    .single();

  if (eventErr || !eventRow) {
    console.error("Event not found for order", orderId, eventErr);
    return { statusCode: 200, body: "Event missing" };
  }

  // -------------------------------------------------------------------------
  // 8. Reconstruct ticket selections from Square order line items
  // -------------------------------------------------------------------------
  let selections = [];
  if (order.square_order_id) {
    selections = await loadSelectionsFromSquareOrder(order, venue);
  }

  if (selections.length === 0) {
    console.error("Could not reconstruct ticket selections for order", orderId);
    await supabase
      .from("ticket_orders")
      .update({ status: "failed" })
      .eq("id", orderId);
    return { statusCode: 200, body: "Could not determine tickets purchased" };
  }

  // -------------------------------------------------------------------------
  // 9. Re-validate inventory + increment quantity_sold
  // -------------------------------------------------------------------------
  const ttIds = [...new Set(selections.map((s) => s.ticketTypeId))];
  const { data: ticketTypes, error: ttErr } = await supabase
    .from("ticket_types")
    .select("*")
    .in("id", ttIds);

  if (ttErr || !ticketTypes) {
    console.error("Failed to load ticket types for order", orderId, ttErr);
    return { statusCode: 200, body: "Ticket type lookup failed" };
  }

  const ttById = new Map(ticketTypes.map((t) => [t.id, t]));

  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    if (!tt) continue;
    if (tt.quantity_total != null) {
      const remaining = tt.quantity_total - (tt.quantity_sold || 0);
      if (sel.qty > remaining) {
        console.error(`OVERSOLD on order ${orderId}: ${tt.name} needs ${sel.qty} but only ${remaining} remain`);
        await supabase
          .from("ticket_orders")
          .update({ status: "failed" })
          .eq("id", orderId);
        return { statusCode: 200, body: "Oversold — order flagged for refund" };
      }
    }
  }

  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    if (!tt) continue;
    await supabase
      .from("ticket_types")
      .update({ quantity_sold: (tt.quantity_sold || 0) + sel.qty })
      .eq("id", sel.ticketTypeId);
  }

  // -------------------------------------------------------------------------
  // 10. Generate tickets
  // -------------------------------------------------------------------------
  const ticketsToInsert = [];
  for (const sel of selections) {
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
      });
    }
  }

  const { data: insertedTickets, error: ticketErr } = await supabase
    .from("tickets")
    .insert(ticketsToInsert)
    .select();

  if (ticketErr || !insertedTickets) {
    console.error("Failed to insert tickets for order", orderId, ticketErr);
    return { statusCode: 500, body: "Ticket creation failed" };
  }

  // -------------------------------------------------------------------------
  // 11. Flip order to paid
  // -------------------------------------------------------------------------
  await supabase
    .from("ticket_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      square_payment_id: payment.id,
    })
    .eq("id", order.id);

  // -------------------------------------------------------------------------
  // 12. Generate QR images + send email
  // -------------------------------------------------------------------------
  const ticketsWithType = insertedTickets.map((t) => ({
    ...t,
    _ticketType: ttById.get(t.ticket_type_id),
  }));

  const qrDataUrls = await Promise.all(
    ticketsWithType.map((t) => renderQrDataUrl(t.qr_token))
  );

  const { html, text } = buildTicketEmail({
    venue,
    event: eventRow,
    order: { ...order, status: "paid" },
    tickets: ticketsWithType,
    qrDataUrls,
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
      const errText = await emailResp.text();
      console.error(`Resend rejected ticket email for order ${orderId}:`, errText);
    } else {
      console.log(`Ticket email sent for order ${orderId}`);
    }
  } catch (emailErr) {
    console.error(`Email send threw for order ${orderId}:`, emailErr);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, orderId, ticketsIssued: insertedTickets.length }),
  };
};

// ============================================================================
// HELPER: reconstruct ticket selections from Square order line items
// ============================================================================

async function loadSelectionsFromSquareOrder(order, venue) {
  if (!venue.square_access_token) {
    console.error("No Square access token for venue", venue.id);
    return [];
  }

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

    if (!resp.ok) {
      console.error("Square retrieve order failed", await resp.text());
      return [];
    }

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
