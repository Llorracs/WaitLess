/**
 * ============================================
 * WAITLESS — Push Notification Dispatcher
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/send-push.js
 *
 * Sends a VAPID-signed web push notification to every device subscribed
 * to a given order. Called by send-notification.js when an order flips to
 * "ready" status (i.e., the bartender taps DRINK READY).
 *
 * REQUEST:
 *   POST /.netlify/functions/send-push
 *   Body: { order_id: "uuid", title: "string", body: "string", url: "string" }
 *
 * RESPONSE:
 *   200: { sent: N, failed: M, skipped: K }
 *   400: { error: "..." }
 *   500: { error: "..." }
 *
 * ENV VARS REQUIRED:
 *   VAPID_PUBLIC_KEY    — base64url, ~88 chars, also sent to clients
 *   VAPID_PRIVATE_KEY   — base64url, ~43 chars, server-only
 *   VAPID_SUBJECT       — mailto:... contact for push services
 *   SUPABASE_URL        — already configured
 *   SUPABASE_SERVICE_ROLE_KEY — already configured (bypasses RLS to read subs)
 *
 * SUBSCRIPTION LIFECYCLE:
 *   - We try each subscription stored for the order
 *   - On HTTP 410 (gone) or 404 (not found), the subscription has been
 *     revoked by the user or expired. We delete the row.
 *   - On HTTP 200/201, we update last_sent_at for debugging
 *   - On other errors, we update send_failed_at and leave the row alone
 *
 * IDEMPOTENCY:
 *   - Push services dedupe identical payloads to the same subscription
 *     within a short window. Safe to call this function multiple times
 *     for the same order_id (e.g., if bartender re-taps READY).
 *   - We do NOT track "already-sent" state here. The caller decides when
 *     to dispatch.
 * ============================================
 */

const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configure web-push with our VAPID keys ONCE at module load.
// This is a one-time setup that runs when the function cold-starts.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:atimelssconcept@gmail.com";
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("VAPID keys not configured");
    return { statusCode: 500, body: JSON.stringify({ error: "Push not configured" }) };
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { order_id, title, body: messageBody, url } = body;
  if (!order_id) {
    return { statusCode: 400, body: JSON.stringify({ error: "order_id required" }) };
  }
  if (!title || !messageBody) {
    return { statusCode: 400, body: JSON.stringify({ error: "title and body required" }) };
  }

  // Fetch all subscriptions for this order
  const { data: subscriptions, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("order_id", order_id);

  if (subErr) {
    console.error("Failed to fetch subscriptions:", subErr);
    return { statusCode: 500, body: JSON.stringify({ error: "DB error" }) };
  }

  if (!subscriptions || subscriptions.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ sent: 0, failed: 0, skipped: 0, message: "No subscriptions" }),
    };
  }

  // Construct payload — service worker will parse this in `push` event
  const payload = JSON.stringify({
    title,
    body: messageBody,
    url: url || "/",
    timestamp: Date.now(),
  });

  // Send to each subscription in parallel, track results per subscription
  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh_key,
          auth: sub.auth_key,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, payload, {
          TTL: 60 * 5, // 5-minute TTL — if undelivered in 5 min, drop it
          urgency: "high",
        });

        // Success — record it for debugging
        sent++;
        await supabase
          .from("push_subscriptions")
          .update({ last_sent_at: new Date().toISOString() })
          .eq("id", sub.id);
      } catch (err) {
        // 404/410 = subscription is dead, remove it from DB (cleanup)
        if (err.statusCode === 404 || err.statusCode === 410) {
          removed++;
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id);
          console.log(`Removed expired subscription ${sub.id} (HTTP ${err.statusCode})`);
        } else {
          // Other errors (e.g., 4xx auth issues, 5xx push-service down)
          failed++;
          await supabase
            .from("push_subscriptions")
            .update({ send_failed_at: new Date().toISOString() })
            .eq("id", sub.id);
          console.error(`Push failed for subscription ${sub.id}:`, err.statusCode, err.body || err.message);
        }
      }
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      sent,
      failed,
      removed,
      total: subscriptions.length,
    }),
  };
};
