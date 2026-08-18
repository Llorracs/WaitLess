/**
 * ============================================
 * WAITLESS — Demo Comp Ticket Issuer
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/demo-comp-ticket.js
 *
 * Issues a REAL, free ticket on the 'demo' venue only, with no payment.
 * Used by the TICKETS tab of the /demo walkthrough (src/DemoTicketsView.jsx).
 *
 * Why this exists:
 *   The real buy flow (create-ticket-checkout.js) redirects to Square's
 *   hosted checkout, which is a dead end for someone kicking the tires.
 *   This endpoint produces the same DATA the real flow produces —
 *   a ticket_orders row plus tickets rows with real qr_tokens — so the
 *   door scanner at /demo/checkin genuinely validates them through the
 *   same process_checkin RPC. Nothing about the check-in step is faked.
 *
 * HARD SECURITY BOUNDARY:
 *   This function refuses any request whose venueSlug is not exactly
 *   'demo', with a 403. It resolves the venue by that slug itself and
 *   never accepts a venue id from the caller, so it cannot be pointed at
 *   a paying venue to mint free tickets.
 *
 * RATE LIMITING (see checkRateLimits):
 *   - Max 2 tickets per request
 *   - Per-IP: 3 requests per 10 minutes (best-effort, in-memory)
 *   - Global: 200 comp orders per hour across the demo venue (DB-backed)
 *
 * DEMO HYGIENE (see rollEventWindow + cleanupOldComps):
 *   Both run lazily on each invocation — no scheduled function required.
 *   - rollEventWindow keeps the demo event's doors/start/end window "live"
 *     so check-in actually succeeds instead of returning doors_not_open.
 *   - cleanupOldComps deletes demo comp orders/tickets older than 24h so
 *     the demo venue doesn't accumulate rows forever.
 * ============================================
 */

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================================
// CONSTANTS
// ============================================================================

// The ONLY venue slug this endpoint will ever act on.
const DEMO_SLUG = "demo";

const MAX_TICKETS_PER_REQUEST = 2;

// Per-IP limiter. In-memory, so it resets on cold start and is not shared
// across concurrent Lambda instances — deliberately a speed bump, not a
// guarantee. The DB-backed global cap below is the real ceiling.
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_IN_WINDOW = 3;
const ipHits = new Map();

// Global ceiling across the whole demo venue, counted in Supabase so it
// holds across instances and cold starts.
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_MAX_IN_WINDOW = 200;

// Comp rows older than this get swept on the next invocation.
const COMP_TTL_MS = 24 * 60 * 60 * 1000;

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Waitless Demo <tickets@waitless.events>";

const TERMS_VERSION = "2026.05.12";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ============================================================================
// HELPERS
// ============================================================================

function err(statusCode, message) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: false, error: message }),
  };
}

function ok(payload) {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true, ...payload }),
  };
}

function generateQrToken(venueSlug) {
  const random = crypto.randomBytes(8).toString("hex");
  return `WL-${venueSlug}-${random}`;
}

function buildQrUrl(token) {
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(token)}&size=300x300&color=0a0a0a&bgcolor=ffffff`;
}

function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
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

function clientIp(event) {
  return (
    event.headers["x-nf-client-connection-ip"] ||
    (event.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown"
  );
}

/**
 * Per-IP speed bump. Prunes expired entries as it goes so the Map can't
 * grow without bound on a long-lived instance.
 */
function checkIpLimit(ip) {
  const now = Date.now();
  for (const [key, hits] of ipHits) {
    const fresh = hits.filter((t) => now - t < IP_WINDOW_MS);
    if (fresh.length === 0) ipHits.delete(key);
    else ipHits.set(key, fresh);
  }

  const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX_IN_WINDOW) return false;

  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

/**
 * DB-backed global ceiling for the demo venue.
 */
async function checkGlobalLimit(venueId) {
  const since = new Date(Date.now() - GLOBAL_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from("ticket_orders")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .gte("created_at", since);

  // Fail open on a counting error rather than breaking the demo — the
  // per-IP limiter and per-request cap still apply.
  if (error) {
    console.error("Global rate limit check failed:", error);
    return true;
  }
  return (count || 0) < GLOBAL_MAX_IN_WINDOW;
}

/**
 * Keep the demo event inside a window where check-in actually works.
 *
 * process_checkin rejects with doors_not_open if doors_at is in the future
 * and event_ended if ends_at has passed. A statically-seeded event therefore
 * either can't be checked into (seeded far ahead) or rots (seeded for today).
 * So we roll it to a live window whenever it drifts out of one:
 *
 *   doors_at  = now - 1h    (doors already open → check-in allowed)
 *   starts_at = now + 2h    (still reads as upcoming to a visitor)
 *   ends_at   = now + 10h   (well clear of a demo session)
 *
 * Also keeps starts_at inside the ±2 day window CheckInView uses to list
 * events, so the scanner auto-selects it.
 */
async function rollEventWindow(ev) {
  const now = Date.now();
  const doorsOk = ev.doors_at && new Date(ev.doors_at).getTime() <= now;
  const notEnded = ev.ends_at && new Date(ev.ends_at).getTime() > now;

  if (doorsOk && notEnded) return ev;

  const rolled = {
    doors_at: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
    starts_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(now + 10 * 60 * 60 * 1000).toISOString(),
  };

  const { data, error } = await supabase
    .from("events")
    .update(rolled)
    .eq("id", ev.id)
    .select()
    .single();

  if (error) {
    console.error("Failed to roll demo event window:", error);
    return ev;
  }
  return data;
}

/**
 * Sweep comp orders (and their tickets) older than COMP_TTL_MS.
 * Scoped hard to the demo venue id resolved from slug 'demo'.
 * Tickets are deleted first because they reference order_id.
 */
async function cleanupOldComps(venueId) {
  const cutoff = new Date(Date.now() - COMP_TTL_MS).toISOString();

  const { data: staleOrders, error: findErr } = await supabase
    .from("ticket_orders")
    .select("id")
    .eq("venue_id", venueId)
    .lt("created_at", cutoff)
    .limit(500);

  if (findErr || !staleOrders || staleOrders.length === 0) return;

  const ids = staleOrders.map((o) => o.id);

  const { error: tErr } = await supabase
    .from("tickets")
    .delete()
    .eq("venue_id", venueId)
    .in("order_id", ids);
  if (tErr) {
    console.error("Demo cleanup: ticket delete failed:", tErr);
    return; // leave orders in place rather than orphaning tickets
  }

  const { error: oErr } = await supabase
    .from("ticket_orders")
    .delete()
    .eq("venue_id", venueId)
    .in("id", ids);
  if (oErr) console.error("Demo cleanup: order delete failed:", oErr);
}

// ============================================================================
// EMAIL
// ============================================================================

function buildCompEmail({ venue, event, tickets }) {
  const accent = venue.brand_colors?.accent || "#d4a843";
  const primary = venue.brand_colors?.primary || "#1E4D8C";

  const when = event.starts_at
    ? new Date(event.starts_at).toLocaleString("en-US", {
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      })
    : "";

  const blocks = tickets.map((t, i) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">
      <tr><td style="padding:24px;text-align:center;">
        <div style="font-family:'Oswald',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:3px;color:${primary};text-transform:uppercase;margin-bottom:12px;">
          Demo Ticket ${i + 1} of ${tickets.length}
        </div>
        <img src="${buildQrUrl(t.qr_token)}" alt="Ticket QR Code" width="240" height="240" style="display:block;margin:0 auto;border:none;" />
        <div style="font-family:'Space Mono','Courier New',monospace;font-size:11px;color:#999;letter-spacing:1px;margin-top:12px;word-break:break-all;">
          ${escapeHtml(t.qr_token)}
        </div>
      </td></tr>
    </table>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,${primary},${accent});padding:32px 28px;text-align:center;">
          <div style="font-family:'Oswald',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:4px;color:rgba(255,255,255,0.85);text-transform:uppercase;margin-bottom:10px;">
            Waitless Demo
          </div>
          <h1 style="margin:0;font-family:'Oswald',Helvetica,Arial,sans-serif;font-size:28px;font-weight:700;color:#fff;line-height:1.2;">
            ${escapeHtml(event.name)}
          </h1>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;color:#444;line-height:1.6;">
            Here's your free demo ticket${tickets.length > 1 ? "s" : ""}. This is a real ticket in a real database —
            scan it at the demo door scanner and it will genuinely check in.
            ${when ? `<br /><br /><strong>When:</strong> ${escapeHtml(when)}` : ""}
          </div>
        </td></tr>
        <tr><td style="padding:24px 28px;">${blocks}</td></tr>
        <tr><td style="background:#0a0a0a;padding:22px 28px;text-align:center;">
          <div style="font-family:'Oswald',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:4px;color:${accent};text-transform:uppercase;">Waitless</div>
          <div style="font-family:'Space Mono','Courier New',monospace;font-size:10px;color:#666;letter-spacing:1px;margin-top:6px;">Demo ticket — no charge</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Waitless Demo — ${event.name}`,
    when ? `When: ${when}` : null,
    "",
    ...tickets.map((t, i) => `Ticket ${i + 1}: ${t.qr_token}`),
    "",
    "Scan at the demo door scanner to check in. No charge.",
  ].filter(Boolean).join("\n");

  return { html, text };
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
    return err(400, "Invalid JSON");
  }

  const { venueSlug, selections, email, name } = body;

  // -------------------------------------------------------------------------
  // 1. HARD GATE — demo venue only, no exceptions.
  // -------------------------------------------------------------------------
  if (venueSlug !== DEMO_SLUG) {
    console.warn(`demo-comp-ticket refused for slug: ${String(venueSlug)}`);
    return err(403, "This endpoint only issues tickets for the demo venue.");
  }

  // -------------------------------------------------------------------------
  // 2. Validate selections
  // -------------------------------------------------------------------------
  if (!Array.isArray(selections) || selections.length === 0) {
    return err(400, "Select at least one ticket.");
  }

  const cleanSelections = [];
  let totalQty = 0;
  for (const sel of selections) {
    const qty = parseInt(sel?.qty, 10);
    if (!sel?.ticketTypeId || typeof sel.ticketTypeId !== "string") {
      return err(400, "Invalid selection.");
    }
    if (!Number.isInteger(qty) || qty <= 0) continue;
    totalQty += qty;
    cleanSelections.push({ ticketTypeId: sel.ticketTypeId, qty });
  }

  if (cleanSelections.length === 0 || totalQty === 0) {
    return err(400, "Select at least one ticket.");
  }
  if (totalQty > MAX_TICKETS_PER_REQUEST) {
    return err(400, `Demo tickets are limited to ${MAX_TICKETS_PER_REQUEST} per request.`);
  }

  // -------------------------------------------------------------------------
  // 3. Rate limits
  // -------------------------------------------------------------------------
  if (!checkIpLimit(clientIp(event))) {
    return err(429, "Too many demo tickets from this device. Try again in a few minutes.");
  }

  // -------------------------------------------------------------------------
  // 4. Resolve the demo venue BY SLUG (never from caller input)
  // -------------------------------------------------------------------------
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, slug, name, brand_colors")
    .eq("slug", DEMO_SLUG)
    .eq("is_active", true)
    .single();

  if (venueErr || !venue) {
    console.error("Demo venue not found:", venueErr);
    return err(500, "Demo venue is not configured.");
  }

  // Defense in depth: if the row we got back somehow isn't the demo venue,
  // stop rather than issuing free tickets against a real one.
  if (venue.slug !== DEMO_SLUG) {
    return err(403, "This endpoint only issues tickets for the demo venue.");
  }

  if (!(await checkGlobalLimit(venue.id))) {
    return err(429, "The demo is busy right now. Please try again shortly.");
  }

  // -------------------------------------------------------------------------
  // 5. Hygiene — sweep stale comps, then find + roll the demo event
  // -------------------------------------------------------------------------
  await cleanupOldComps(venue.id);

  const { data: events, error: evErr } = await supabase
    .from("events")
    .select("*")
    .eq("venue_id", venue.id)
    .eq("status", "published")
    .order("starts_at", { ascending: true })
    .limit(1);

  if (evErr || !events || events.length === 0) {
    return err(500, "No published demo event found. Seed one first.");
  }

  const eventRow = await rollEventWindow(events[0]);

  // -------------------------------------------------------------------------
  // 6. Validate the chosen ticket types belong to THIS event
  // -------------------------------------------------------------------------
  const ttIds = [...new Set(cleanSelections.map((s) => s.ticketTypeId))];
  const { data: ticketTypes, error: ttErr } = await supabase
    .from("ticket_types")
    .select("*")
    .eq("event_id", eventRow.id)
    .eq("active", true)
    .in("id", ttIds);

  if (ttErr) {
    console.error("Ticket type lookup failed:", ttErr);
    return err(500, "Could not load ticket types.");
  }
  if (!ticketTypes || ticketTypes.length !== ttIds.length) {
    return err(400, "One or more ticket types are not available for this event.");
  }

  const ttById = new Map(ticketTypes.map((t) => [t.id, t]));

  // -------------------------------------------------------------------------
  // 7. Create the comp order — real row, zero money
  // -------------------------------------------------------------------------
  const buyerName = (typeof name === "string" && name.trim()) ? name.trim().slice(0, 80) : "Demo Guest";
  const buyerEmail = isValidEmail(email) ? email.trim().toLowerCase() : "demo@waitless.app";
  const nowIso = new Date().toISOString();

  const { data: order, error: orderErr } = await supabase
    .from("ticket_orders")
    .insert({
      venue_id: venue.id,
      event_id: eventRow.id,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      buyer_phone: null,
      subtotal_cents: 0,
      fee_cents: 0,
      total_cents: 0,
      status: "paid",
      paid_at: nowIso,
      terms_accepted_at: nowIso,
      terms_version: TERMS_VERSION,
    })
    .select()
    .single();

  if (orderErr || !order) {
    console.error("Failed to insert comp ticket_orders row:", orderErr);
    return err(500, "Could not create demo order.");
  }

  // -------------------------------------------------------------------------
  // 8. Create the tickets — real qr_tokens, status 'valid'
  //
  // Note: quantity_sold is deliberately NOT incremented. Comp tickets don't
  // consume demo inventory, so the seeded scarcity numbers stay put and the
  // demo can't sell itself out.
  // -------------------------------------------------------------------------
  const ticketsToInsert = [];
  for (const sel of cleanSelections) {
    const tt = ttById.get(sel.ticketTypeId);
    for (let i = 0; i < sel.qty; i++) {
      ticketsToInsert.push({
        venue_id: venue.id,
        event_id: eventRow.id,
        order_id: order.id,
        ticket_type_id: sel.ticketTypeId,
        attendee_name: buyerName,
        attendee_email: buyerEmail,
        qr_token: generateQrToken(venue.slug),
        status: "valid",
        price_paid_cents: 0,
      });
    }
  }

  const { data: insertedTickets, error: ticketErr } = await supabase
    .from("tickets")
    .insert(ticketsToInsert)
    .select();

  if (ticketErr || !insertedTickets) {
    console.error("Failed to insert comp tickets:", ticketErr);
    // Roll back the order so we don't strand a paid order with no tickets.
    await supabase.from("ticket_orders").delete().eq("id", order.id);
    return err(500, "Could not issue demo tickets.");
  }

  // -------------------------------------------------------------------------
  // 9. Optional email — never blocks the response
  // -------------------------------------------------------------------------
  let emailed = false;
  if (isValidEmail(email) && process.env.RESEND_API_KEY) {
    try {
      const { html, text } = buildCompEmail({ venue, event: eventRow, tickets: insertedTickets });
      const resp = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM_DEFAULT || DEFAULT_FROM,
          to: [email.trim().toLowerCase()],
          subject: `Your demo ticket — ${eventRow.name}`,
          html,
          text,
        }),
      });
      emailed = resp.ok;
      if (!resp.ok) console.error("Resend rejected demo email:", await resp.text());
    } catch (e) {
      console.error("Demo email send threw:", e);
    }
  }

  return ok({
    orderId: order.id,
    emailed,
    event: {
      id: eventRow.id,
      name: eventRow.name,
      slug: eventRow.slug,
      starts_at: eventRow.starts_at,
      doors_at: eventRow.doors_at,
      location_name: eventRow.location_name,
    },
    tickets: insertedTickets.map((t) => ({
      id: t.id,
      qrToken: t.qr_token,
      qrUrl: buildQrUrl(t.qr_token),
      ticketTypeName: ttById.get(t.ticket_type_id)?.name || "Ticket",
    })),
  });
};
