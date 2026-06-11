/**
 * ============================================
 * WAITLESS — Ticket Resend Admin Tool
 * netlify/functions/resend-tickets.js
 * ============================================
 *
 * ONE-TIME USE — safe to delete after the event.
 *
 * USAGE:
 *
 *   Dry run (no emails sent):
 *   https://waitless.events/.netlify/functions/resend-tickets?venue=trfq&secret=waitless-resend-2026&event_id=UUID&dry=true
 *
 *   Full resend for an event:
 *   https://waitless.events/.netlify/functions/resend-tickets?venue=trfq&secret=waitless-resend-2026&event_id=UUID
 *
 *   Target specific orders only (comma-separated, no spaces):
 *   https://waitless.events/.netlify/functions/resend-tickets?venue=trfq&secret=waitless-resend-2026&event_id=UUID&order_ids=id1,id2,id3
 */

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Waitless Tickets <tickets@waitless.events>";
const ADMIN_SECRET = "waitless-resend-2026";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// HELPERS
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

function buildQrUrl(token) {
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(token)}&size=300x300&color=0a0a0a&bgcolor=ffffff`;
}

function buildResendEmail({ venue, event, order, tickets }) {
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
    const typeName = ticket._ticketType?.name || "General Admission";
    const qrUrl = buildQrUrl(ticket.qr_token);
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; background: #ffffff; border: 1px solid #e5e5e5; border-radius: 12px;">
        <tr>
          <td style="padding: 24px; text-align: center;">
            <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 3px; color: ${venuePrimary}; text-transform: uppercase; margin-bottom: 4px;">
              ${escapeHtml(typeName)}
            </div>
            <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 14px; color: #666; margin-bottom: 16px;">
              Ticket ${i + 1} of ${tickets.length}
            </div>
            <img src="${qrUrl}" alt="Ticket QR Code" width="240" height="240" style="display: block; margin: 0 auto; border: none;" />
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
                We're resending your ${tickets.length === 1 ? "ticket" : `${tickets.length} tickets`} — the QR code in your original email may not have displayed correctly on your device. Show this QR code at the door to check in.
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
            <td style="background: #0a0a0a; padding: 24px 28px; text-align: center;">
              <div style="font-family: 'Oswald', Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 4px; color: ${venueAccent}; text-transform: uppercase; margin-bottom: 6px;">
                Waitless
              </div>
              <div style="font-family: 'Space Mono', 'Courier New', monospace; font-size: 10px; color: #666; letter-spacing: 1px;">
                Weightless service, zero wait
              </div>
              <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 11px; color: #555; margin-top: 16px; line-height: 1.5;">
                Need help? Reply to this email.<br />
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

  return html;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const params = event.queryStringParameters || {};

  if (params.secret !== ADMIN_SECRET) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  const venueSlug = params.venue || "trfq";
  const dryRun = params.dry === "true";
  const orderIdFilter = params.order_ids
    ? params.order_ids.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // Load venue
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, slug, name, brand_colors")
    .eq("slug", venueSlug)
    .single();

  if (venueErr || !venue) {
    return { statusCode: 404, body: JSON.stringify({ error: `Venue '${venueSlug}' not found` }) };
  }

  // Find target events
  let targetEvents = [];

  if (params.event_id) {
    const { data: specificEvent } = await supabase
      .from("events")
      .select("id, name, slug, starts_at, ends_at, location_name, location_address")
      .eq("id", params.event_id)
      .single();
    if (specificEvent) targetEvents = [specificEvent];
    else return { statusCode: 404, body: JSON.stringify({ error: "Event not found" }) };
  } else {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const { data: todayEvents } = await supabase
      .from("events")
      .select("id, name, slug, starts_at, ends_at, location_name, location_address")
      .eq("venue_id", venue.id)
      .gte("starts_at", todayStart.toISOString())
      .lte("starts_at", todayEnd.toISOString());

    if (!todayEvents || todayEvents.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "No events found for today. Pass &event_id=UUID to target a specific event.",
        }),
      };
    }
    targetEvents = todayEvents;
  }

  const results = [];

  for (const evt of targetEvents) {
    let query = supabase
      .from("ticket_orders")
      .select("*")
      .eq("event_id", evt.id)
      .eq("venue_id", venue.id)
      .eq("status", "paid");

    // If specific order IDs provided, filter to only those
    if (orderIdFilter && orderIdFilter.length > 0) {
      query = query.in("id", orderIdFilter);
    }

    const { data: orders, error: ordersErr } = await query;

    if (ordersErr || !orders || orders.length === 0) {
      results.push({ event: evt.name, ordersFound: 0, skipped: "No matching paid orders" });
      continue;
    }

    for (const order of orders) {
      const result = {
        orderId: order.id,
        email: order.buyer_email,
        name: order.buyer_name,
        event: evt.name,
        sent: false,
        dryRun,
      };

      const { data: tickets, error: ticketsErr } = await supabase
        .from("tickets")
        .select("*")
        .eq("order_id", order.id)
        .eq("status", "valid");

      if (ticketsErr || !tickets || tickets.length === 0) {
        result.error = "No valid tickets found for order";
        results.push(result);
        continue;
      }

      const ttIds = [...new Set(tickets.map((t) => t.ticket_type_id))];
      const { data: ticketTypes } = await supabase
        .from("ticket_types")
        .select("id, name, price_cents")
        .in("id", ttIds);

      const ttById = new Map((ticketTypes || []).map((t) => [t.id, t]));
      const ticketsWithType = tickets.map((t) => ({
        ...t,
        _ticketType: ttById.get(t.ticket_type_id),
      }));

      result.ticketCount = tickets.length;
      result.qrTokens = tickets.map((t) => t.qr_token);

      if (!dryRun) {
        const html = buildResendEmail({ venue, event: evt, order, tickets: ticketsWithType });

        try {
          const resp = await fetch(RESEND_API_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: process.env.EMAIL_FROM_DEFAULT || DEFAULT_FROM,
              to: [order.buyer_email],
              subject: `Your tickets to ${evt.name}`,
              html,
            }),
          });

          result.sent = resp.ok;
          if (!resp.ok) result.error = await resp.text();
        } catch (err) {
          result.error = err.message;
        }

        // 250ms delay between sends — stays well under Resend's 5/second limit
        await sleep(250);
      } else {
        result.sent = "dry run — not sent";
      }

      results.push(result);
    }
  }

  const sentCount = results.filter((r) => r.sent === true).length;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      {
        venue: venue.slug,
        events: targetEvents.map((e) => e.name),
        dryRun,
        ordersProcessed: results.length,
        emailsSent: dryRun ? "dry run" : sentCount,
        results,
      },
      null,
      2
    ),
  };
};
