/**
 * ============================================
 * WAITLESS — Square Payment Webhook
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/ticket-webhook.js
 *
 * This is the function Square calls when a hosted Checkout payment completes.
 * It is the ONLY code path allowed to flip a ticket_order from 'pending' to
 * 'paid' — RLS blocks every other role. Service-role Supabase client bypasses
 * RLS so the webhook can do its job.
 *
 * Flow when Square POSTs to /.netlify/functions/ticket-webhook:
 *   1. Verify Square's signature header (HMAC SHA-256) — reject any spoofed
 *      requests before doing any DB work
 *   2. Parse the payment.updated event payload
 *   3. Look up our pending order by reference_id (a UUID we set during
 *      create-ticket-checkout)
 *   4. Idempotency check: if order is already 'paid', return 200 immediately.
 *      Square retries webhooks aggressively (up to 72 hours) and we don't
 *      want to double-issue tickets.
 *   5. Re-validate inventory — quantity_sold may have changed since checkout
 *      was created (race condition with another buyer who finished first)
 *   6. In a single Supabase transaction-ish sequence:
 *        a. Increment quantity_sold on each ticket_type
 *        b. Insert tickets rows with unique qr_tokens
 *        c. Mark the order paid
 *   7. Generate QR images server-side via the `qrcode` package and embed them
 *      as base64 in the email HTML (no external image dependency)
 *   8. Send the styled confirmation email via Resend
 *   9. Return 200 to Square
 *
 * SETUP:
 *   1. npm install qrcode
 *   2. New Netlify env var: SQUARE_WEBHOOK_SIGNATURE_KEY
 *      (Get it from Square Dashboard → Webhook subscriptions → your webhook → Signature Key)
 *      ⚠ Each venue's Square account has its own signature key. For now we
 *      assume a single platform-level webhook signing key. When we onboard
 *      multiple venues with their own Square accounts, this becomes per-venue.
 *   3. Existing env vars used: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      RESEND_API_KEY, EMAIL_FROM_DEFAULT, URL
 *
 * SQUARE DASHBOARD CONFIG:
 *   - Webhook URL: https://waitless.events/.netlify/functions/ticket-webhook
 *   - Events to subscribe to: payment.updated
 *   - Copy the Signature Key into SQUARE_WEBHOOK_SIGNATURE_KEY env var
 * ============================================
 */

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const QRCode = require("qrcode");

// Service-role client — bypasses RLS, which is required to mark orders paid
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================================
// CONSTANTS
// ============================================================================

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Waitless Tickets <tickets@waitless.events>";

// ============================================================================
// SIGNATURE VERIFICATION
// ============================================================================

/**
 * Verify Square's webhook signature. Square computes HMAC-SHA-256 over
 * (notification_url + raw_body) using the venue's signature key. We compute
 * the same and compare in constant time to prevent timing attacks.
 *
 * Reference: https://developer.squareup.com/docs/webhooks/step3validate
 */
function verifySquareSignature(rawBody, signatureHeader, signatureKey, notificationUrl) {
  if (!signatureHeader || !signatureKey) return false;

  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expectedSignature = hmac.digest("base64");

  // Constant-time comparison — protects against timing-attack signature guessing
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

/**
 * Generate a QR token in the form WL-{venue_slug}-{16 hex chars}.
 * 16 hex chars = 64 bits of entropy = collisions effectively impossible.
 * Format is human-readable for door staff troubleshooting.
 */
function generateQrToken(venueSlug) {
  const random = crypto.randomBytes(8).toString("hex");
  return `WL-${venueSlug}-${random}`;
}

/**
 * Render a QR code to a base64 data URL string. Embeds directly in <img src>
 * with no external dependency — the email is fully self-contained.
 *
 * 300x300 PNG, error correction level M (standard for tickets — balances
 * size against scanability if part of the QR is obscured).
 */
async function renderQrDataUrl(token) {
  return QRCode.toDataURL(token, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#0a0a0a",
      light: "#ffffff",
    },
  });
}

// ============================================================================
// EMAIL TEMPLATE
// ============================================================================

/**
 * Build the ticket confirmation email HTML.
 *
 * Email-client rendering is its own dark art — Gmail strips <style> blocks,
 * Outlook ignores rounded corners, dark mode flips background colors
 * unpredictably. The safe pattern is inline styles only, table-based layout
 * for old Outlook, no @media queries, and explicit colors on every element.
 */
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

  const ticketBlocks = tickets
    .map((ticket, i) => {
      const ticketType = ticket._ticketType; // attached server-side, not in DB
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
    })
    .join("");

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

          <!-- Hero -->
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

          <!-- Event details -->
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

          <!-- When / Where -->
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

          <!-- Tickets -->
          <tr>
            <td style="padding: 0 28px 28px;">
              <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 3px; color: #666; text-transform: uppercase; margin-bottom: 16px;">
                Your ${tickets.length === 1 ? "Ticket" : "Tickets"}
              </div>
              ${ticketBlocks}
            </td>
          </tr>

          <!-- Order summary -->
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

          <!-- Footer -->
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
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text };
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

// ============================================================================
// MAIN HANDLER
// ============================================================================

exports.handler = async (event) => {
  // Square sends POST only — anything else is suspicious
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const rawBody = event.body || "";
  const signatureHeader = event.headers["x-square-hmacsha256-signature"]
    || event.headers["X-Square-HmacSha256-Signature"];

  // The notification URL Square used — must match exactly for signature verification.
  // Square uses whatever URL you configured in the webhook subscription.
  const notificationUrl = `${process.env.URL || "https://waitless.events"}/.netlify/functions/ticket-webhook`;

  // -------------------------------------------------------------------------
  // 1. Verify signature
  // -------------------------------------------------------------------------
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    console.error("SQUARE_WEBHOOK_SIGNATURE_KEY env var not set — refusing to process webhook");
    return { statusCode: 500, body: "Webhook not configured" };
  }

  if (!verifySquareSignature(rawBody, signatureHeader, signatureKey, notificationUrl)) {
    console.warn("Invalid Square webhook signature — possible spoofing attempt");
    return { statusCode: 401, body: "Invalid signature" };
  }

  // -------------------------------------------------------------------------
  // 2. Parse the event
  // -------------------------------------------------------------------------
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // We only act on payment.updated where the payment is COMPLETED
  if (payload.type !== "payment.updated") {
    return { statusCode: 200, body: "Ignored — not a payment event" };
  }

  const payment = payload.data?.object?.payment;
  if (!payment) {
    return { statusCode: 200, body: "Ignored — no payment object" };
  }

  // Square's payment lifecycle: APPROVED → COMPLETED. We act on COMPLETED.
  if (payment.status !== "COMPLETED") {
    return { statusCode: 200, body: `Ignored — payment status is ${payment.status}` };
  }

  // The reference_id we set during create-ticket-checkout. This is our
  // ticket_orders.id — the link between Square's world and ours.
  const orderId = payment.referenceId || payment.reference_id || payment.order?.referenceId;
  if (!orderId) {
    console.error("payment.updated missing reference_id — cannot link to ticket order", payment.id);
    return { statusCode: 200, body: "Ignored — no reference_id" };
  }

  // -------------------------------------------------------------------------
  // 3. Look up our pending order
  // -------------------------------------------------------------------------
  const { data: order, error: orderErr } = await supabase
    .from("ticket_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    console.error("No ticket_order found for reference_id", orderId, orderErr);
    // Return 200 so Square doesn't keep retrying — there's nothing we can do
    return { statusCode: 200, body: "No matching order — possibly not a Waitless payment" };
  }

  // -------------------------------------------------------------------------
  // 4. Idempotency: if already paid, no-op
  // -------------------------------------------------------------------------
  if (order.status === "paid") {
    console.log(`Order ${orderId} already paid — webhook duplicate, ignoring`);
    return { statusCode: 200, body: "Already processed" };
  }

  if (order.status === "refunded" || order.status === "failed") {
    console.log(`Order ${orderId} status is ${order.status} — refusing to issue tickets`);
    return { statusCode: 200, body: "Order in terminal state" };
  }

  // -------------------------------------------------------------------------
  // 5. Load venue + event + ticket type selections (encoded in Square line items)
  // -------------------------------------------------------------------------
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, slug, name, brand_colors")
    .eq("id", order.venue_id)
    .single();

  if (venueErr || !venue) {
    console.error("Venue not found for order", orderId, venueErr);
    return { statusCode: 200, body: "Venue missing" };
  }

  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, name, slug, starts_at, ends_at, location_name, location_address")
    .eq("id", order.event_id)
    .single();

  if (eventErr || !eventRow) {
    console.error("Event not found for order", orderId, eventErr);
    return { statusCode: 200, body: "Event missing" };
  }

  // We stashed ticket_type_id in each Square line item's `note` field as
  // `tt:<uuid>`. Fetch the Square order to read line items back out.
  // Square's webhook payload doesn't include line items directly, but we
  // stored square_order_id on our row during checkout creation.
  let selections = [];
  if (order.square_order_id) {
    selections = await loadSelectionsFromSquareOrder(order, venue);
  }

  // Fallback: if we couldn't reconstruct from Square (rare), refuse to
  // generate tickets — we'd be guessing what was bought. Better to alert.
  if (selections.length === 0) {
    console.error("Could not reconstruct ticket selections for order", orderId);
    await supabase
      .from("ticket_orders")
      .update({ status: "failed" })
      .eq("id", orderId);
    return { statusCode: 200, body: "Could not determine tickets purchased — flagged for manual review" };
  }

  // -------------------------------------------------------------------------
  // 6. Re-validate inventory + atomically increment quantity_sold
  // -------------------------------------------------------------------------
  // Load current ticket types
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

  // Inventory check (last-chance — race condition with another buyer)
  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    if (!tt) continue;
    if (tt.quantity_total != null) {
      const remaining = tt.quantity_total - (tt.quantity_sold || 0);
      if (sel.qty > remaining) {
        // Oversold — Square already charged the buyer. This is a real edge
        // case we need to handle gracefully: refund via Square dashboard
        // (manual for now), mark order as failed for follow-up.
        console.error(`OVERSOLD on order ${orderId}: ${tt.name} requested ${sel.qty} but only ${remaining} remain`);
        await supabase
          .from("ticket_orders")
          .update({ status: "failed" })
          .eq("id", orderId);
        return { statusCode: 200, body: "Oversold — order flagged" };
      }
    }
  }

  // Atomic increments — RPC would be cleaner; for now use the .update with
  // computed value approach. Race-safe enough at our scale; can harden later.
  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    if (!tt) continue;
    await supabase
      .from("ticket_types")
      .update({ quantity_sold: (tt.quantity_sold || 0) + sel.qty })
      .eq("id", sel.ticketTypeId);
  }

  // -------------------------------------------------------------------------
  // 7. Generate tickets
  // -------------------------------------------------------------------------
  const ticketsToInsert = [];
  for (const sel of selections) {
    for (let i = 0; i < sel.qty; i++) {
      ticketsToInsert.push({
        venue_id: venue.id,
        event_id: eventRow.id,
        order_id: order.id,
        ticket_type_id: sel.ticketTypeId,
        attendee_name: order.buyer_name, // single-buyer model for v1
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
  // 8. Flip the order to paid
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
  // 9. Generate QR images
  // -------------------------------------------------------------------------
  // Attach the ticket_type to each ticket for use in the email template
  const ticketsWithType = insertedTickets.map((t) => ({
    ...t,
    _ticketType: ttById.get(t.ticket_type_id),
  }));

  const qrDataUrls = await Promise.all(
    ticketsWithType.map((t) => renderQrDataUrl(t.qr_token))
  );

  // -------------------------------------------------------------------------
  // 10. Build + send the email
  // -------------------------------------------------------------------------
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
      const err = await emailResp.text();
      console.error(`Resend rejected ticket email for order ${orderId}:`, err);
      // Tickets are created; just the email failed. Don't fail the webhook —
      // buyer can still access tickets via confirmation page. Log for follow-up.
    } else {
      console.log(`Ticket email sent for order ${orderId}`);
    }
  } catch (emailErr) {
    console.error(`Email send threw for order ${orderId}:`, emailErr);
    // Same as above — tickets exist in DB, log for follow-up
  }

  // -------------------------------------------------------------------------
  // 11. Done — return 200 to Square
  // -------------------------------------------------------------------------
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, orderId, ticketsIssued: insertedTickets.length }),
  };
};

// ============================================================================
// HELPER: reconstruct ticket selections from Square order line items
//
// During create-ticket-checkout we stashed ticket_type_id in each line item's
// `note` field as `tt:<uuid>`. Here we fetch the Square order back and parse
// those notes to figure out which ticket types were bought and how many.
//
// This requires calling Square's Retrieve Order API. We need the venue's
// access token for that.
// ============================================================================

async function loadSelectionsFromSquareOrder(order, venue) {
  // Look up the venue's Square credentials
  const { data: venueWithCreds } = await supabase
    .from("venues")
    .select("square_access_token, square_environment")
    .eq("id", venue.id)
    .single();

  if (!venueWithCreds?.square_access_token) {
    console.error("No Square access token for venue", venue.id);
    return [];
  }

  const baseUrl = venueWithCreds.square_environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

  try {
    const resp = await fetch(`${baseUrl}/v2/orders/${order.square_order_id}`, {
      headers: {
        Authorization: `Bearer ${venueWithCreds.square_access_token}`,
        "Square-Version": "2026-01-22",
      },
    });

    if (!resp.ok) {
      console.error("Square retrieve order failed", await resp.text());
      return [];
    }

    const data = await resp.json();
    const lineItems = data.order?.line_items || [];

    // Parse `tt:<uuid>` out of each note. Skip the "Processing fee" line.
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
