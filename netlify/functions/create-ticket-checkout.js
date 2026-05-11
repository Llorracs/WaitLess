/**
 * ============================================
 * WAITLESS — Create Ticket Checkout (Square hosted)
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/create-ticket-checkout.js
 *
 * Called by the /{venue_slug}/buy/{event_slug} page when a buyer clicks
 * "Get Tickets." This function:
 *
 *   1. Looks up the venue's Square credentials in Supabase
 *   2. Validates the event is published and the chosen ticket types are sellable
 *   3. Computes the buyer-paid total (face value + Square processing pass-through)
 *   4. Inserts a 'pending' row into ticket_orders
 *   5. Creates a Square-hosted checkout (CreatePaymentLink) tied to that order via reference_id
 *   6. Returns the checkout URL to the frontend, which does window.location = url
 *
 * The actual conversion of pending → paid (and creation of individual tickets)
 * happens in ticket-webhook.js, triggered by Square's payment.updated event.
 *
 * SETUP:
 *   1. Already installed: `square` ^37.1.0 and `@supabase/supabase-js`
 *   2. Already set in Netlify: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   3. New env vars to add in Netlify:
 *      - URL              (auto-populated by Netlify; e.g. https://waitlss.netlify.app)
 *
 * REQUEST BODY:
 *   {
 *     venueSlug:  "trfq",
 *     eventSlug:  "blooms-and-booze",
 *     selections: [{ ticketTypeId: "uuid", qty: 2 }, ...],
 *     buyer:      { name: "Jane Doe", email: "j@x.com", phone: "+15555551234" }
 *   }
 *
 * SUCCESS RESPONSE (200):
 *   {
 *     success: true,
 *     orderId: "uuid",
 *     checkoutUrl: "https://square.link/...",
 *     totals: { faceCents: 5000, processingCents: 225, totalCents: 5225 }
 *   }
 * ============================================
 */

const { Client, Environment } = require("square");
const { createClient } = require("@supabase/supabase-js");

// Service-role Supabase client — server-side only. Bypasses RLS, which is
// required for the webhook flow (only this role can flip pending→paid later).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================================
// CONSTANTS
// ============================================================================

// Pattern A — buyer pays Square's online processing pass-through.
// Rates as of Square's January 2026 pricing update for the Free plan:
//   Online card via Checkout API: 3.3% + $0.30
// If a venue is on Plus/Premium ($49/$149 per month) the rate drops to
// 2.9% + $0.30. We expose this as a constant so we can switch per-venue later.
const SQUARE_ONLINE_RATE_BPS = 330;   // 3.30% expressed in basis points
const SQUARE_ONLINE_FIXED_C = 30;     // 30 cents per transaction

// ============================================================================
// HELPERS
// ============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
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

/**
 * Compute the buyer-paid total under Pattern A (pass-through).
 *
 * Square's fee is per-transaction (a single payment), not per-item, so the
 * fixed $0.30 is charged ONCE on the total payment, NOT per ticket. This is
 * an important distinction — the earlier conversation had it as 30c per
 * ticket, which over-charges buyers on multi-ticket purchases.
 *
 * Returns integer cents in all fields.
 */
function computeTotals(faceCents) {
  // Pass-through math: buyer pays X such that after Square deducts
  // (X * rate + fixed), the venue nets faceCents.
  //
  //   X - (X * rate + fixed) = faceCents
  //   X * (1 - rate) = faceCents + fixed
  //   X = (faceCents + fixed) / (1 - rate)
  //
  // We round up to the nearest cent so the venue never comes up short.
  const rate = SQUARE_ONLINE_RATE_BPS / 10000;
  const buyerTotal = Math.ceil((faceCents + SQUARE_ONLINE_FIXED_C) / (1 - rate));
  const processingCents = buyerTotal - faceCents;
  return {
    faceCents,
    processingCents,
    totalCents: buyerTotal,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return err(405, "Method not allowed");
  }

  // -------------------------------------------------------------------------
  // 1. Parse and validate the request
  // -------------------------------------------------------------------------
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return err(400, "Invalid JSON body");
  }

  const { venueSlug, eventSlug, selections, buyer } = body;

  if (!venueSlug || !eventSlug) {
    return err(400, "Missing venueSlug or eventSlug");
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    return err(400, "Must select at least one ticket");
  }
  if (!buyer?.name || !buyer?.email) {
    return err(400, "Buyer name and email are required");
  }
  // Basic email sanity check — Square will validate properly at checkout time
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) {
    return err(400, "Invalid buyer email");
  }
  // Cap total tickets per order — sanity guard against abuse
  const totalQty = selections.reduce((s, x) => s + (Number(x.qty) || 0), 0);
  if (totalQty <= 0) return err(400, "Total quantity must be positive");
  if (totalQty > 50) return err(400, "Maximum 50 tickets per order");

  // -------------------------------------------------------------------------
  // 2. Look up venue and validate Square config
  // -------------------------------------------------------------------------
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, name, slug, square_access_token, square_location_id, square_environment, currency")
    .eq("slug", venueSlug)
    .eq("is_active", true)
    .single();

  if (venueErr || !venue) return err(404, "Venue not found or inactive");
  if (!venue.square_access_token || !venue.square_location_id) {
    return err(400, "Venue has not finished Square setup");
  }

  // -------------------------------------------------------------------------
  // 3. Look up event and ticket types in one go
  // -------------------------------------------------------------------------
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, name, slug, status, starts_at, ends_at, venue_id")
    .eq("venue_id", venue.id)
    .eq("slug", eventSlug)
    .single();

  if (eventErr || !eventRow) return err(404, "Event not found");
  if (eventRow.status !== "published") {
    return err(400, "Event is not currently on sale");
  }

  const ticketTypeIds = [...new Set(selections.map((s) => s.ticketTypeId))];
  const { data: ticketTypes, error: ttErr } = await supabase
    .from("ticket_types")
    .select("id, event_id, name, price_cents, quantity_total, quantity_sold, sale_starts_at, sale_ends_at, active")
    .in("id", ticketTypeIds);

  if (ttErr) return err(500, "Failed to load ticket types");

  // Build a lookup keyed by ticket type id
  const ttById = new Map(ticketTypes.map((t) => [t.id, t]));

  // -------------------------------------------------------------------------
  // 4. Validate every selected ticket type
  // -------------------------------------------------------------------------
  const now = new Date();
  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    if (!tt) return err(404, `Ticket type ${sel.ticketTypeId} not found`);
    if (tt.event_id !== eventRow.id) return err(400, "Ticket type does not belong to this event");
    if (!tt.active) return err(400, `"${tt.name}" is no longer available`);

    if (tt.sale_starts_at && new Date(tt.sale_starts_at) > now) {
      return err(400, `"${tt.name}" is not yet on sale`);
    }
    if (tt.sale_ends_at && new Date(tt.sale_ends_at) < now) {
      return err(400, `"${tt.name}" sales have ended`);
    }

    const qty = Number(sel.qty) || 0;
    if (qty <= 0) return err(400, "Each selection must have a positive quantity");

    // Check remaining inventory (null quantity_total = unlimited)
    if (tt.quantity_total != null) {
      const remaining = tt.quantity_total - (tt.quantity_sold || 0);
      if (qty > remaining) {
        return err(409, `Only ${remaining} of "${tt.name}" remaining`, { remaining });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Compute totals
  // -------------------------------------------------------------------------
  const faceCents = selections.reduce((sum, sel) => {
    const tt = ttById.get(sel.ticketTypeId);
    return sum + tt.price_cents * (Number(sel.qty) || 0);
  }, 0);

  if (faceCents <= 0) return err(400, "Order total must be positive");

  const totals = computeTotals(faceCents);

  // -------------------------------------------------------------------------
  // 6. Insert pending ticket_orders row
  //
  // We do this BEFORE creating the Square checkout so we have a stable UUID
  // to use as Square's reference_id. The webhook later matches by reference_id
  // to find this row and flip it to 'paid'.
  // -------------------------------------------------------------------------
  const { data: order, error: orderErr } = await supabase
    .from("ticket_orders")
    .insert({
      venue_id: venue.id,
      event_id: eventRow.id,
      buyer_name: buyer.name.trim(),
      buyer_email: buyer.email.trim().toLowerCase(),
      buyer_phone: buyer.phone?.trim() || null,
      subtotal_cents: totals.faceCents,
      fee_cents: totals.processingCents,
      total_cents: totals.totalCents,
      status: "pending",
    })
    .select()
    .single();

  if (orderErr || !order) {
    console.error("Failed to insert ticket_orders:", orderErr);
    return err(500, "Could not create order");
  }

  // -------------------------------------------------------------------------
  // 7. Build Square line items
  //
  // Each ticket type becomes one line item at face value. The processing
  // pass-through becomes a separate "Processing fee" line item so the buyer
  // sees exactly where the money goes. This matches Eventbrite's UX and
  // makes it clear Waitless isn't adding a markup.
  // -------------------------------------------------------------------------
  const currency = venue.currency || "USD";
  const lineItems = [];

  for (const sel of selections) {
    const tt = ttById.get(sel.ticketTypeId);
    lineItems.push({
      name: `${eventRow.name} — ${tt.name}`,
      quantity: String(sel.qty),
      basePriceMoney: {
        amount: BigInt(tt.price_cents),
        currency,
      },
      // Stash the ticket_type_id in the note so the webhook can reconstruct
      // which tickets to create. Square doesn't have a proper metadata field
      // on line items in v37, so we use the note field as a workaround.
      note: `tt:${tt.id}`,
    });
  }

  // Single processing line item (NOT per ticket — Square charges per
  // transaction, not per item)
  if (totals.processingCents > 0) {
    lineItems.push({
      name: "Processing fee",
      quantity: "1",
      basePriceMoney: {
        amount: BigInt(totals.processingCents),
        currency,
      },
      note: "processing-passthrough",
    });
  }

  // -------------------------------------------------------------------------
  // 8. Create the Square hosted checkout link
  // -------------------------------------------------------------------------
  const squareClient = new Client({
    accessToken: venue.square_access_token,
    environment:
      venue.square_environment === "production"
        ? Environment.Production
        : Environment.Sandbox,
  });

  // Build the redirect URL. Netlify sets URL to the deploy URL automatically.
  const siteUrl = process.env.URL || "https://waitlss.netlify.app";
  const redirectUrl = `${siteUrl}/${venue.slug}/buy/${eventRow.slug}/confirmation?order_id=${order.id}`;

  try {
    const paymentLinkResp = await squareClient.checkoutApi.createPaymentLink({
      idempotencyKey: `ticket-order-${order.id}`,
      order: {
        locationId: venue.square_location_id,
        // reference_id is how the webhook will find this row — it's surfaced
        // on the payment object after checkout completes.
        referenceId: order.id,
        lineItems,
      },
      checkoutOptions: {
        redirectUrl,
        askForShippingAddress: false,
        merchantSupportEmail: undefined, // Square pulls from the seller account
        acceptedPaymentMethods: {
          applePay: true,
          googlePay: true,
          cashAppPay: true,
          afterpayClearpay: false,
        },
      },
      prePopulatedData: {
        buyerEmail: order.buyer_email,
        buyerPhoneNumber: order.buyer_phone || undefined,
      },
    });

    const paymentLink = paymentLinkResp.result?.paymentLink;
    if (!paymentLink?.url) {
      throw new Error("Square returned no payment link");
    }

    // Save the Square ids back onto our order so the webhook can match
    // against either reference_id OR square_order_id (defense in depth)
    await supabase
      .from("ticket_orders")
      .update({
        square_checkout_id: paymentLink.id,
        square_order_id: paymentLink.orderId || null,
      })
      .eq("id", order.id);

    return ok({
      orderId: order.id,
      checkoutUrl: paymentLink.url,
      totals: {
        faceCents: totals.faceCents,
        processingCents: totals.processingCents,
        totalCents: totals.totalCents,
      },
    });
  } catch (squareError) {
    console.error("Square createPaymentLink error:", squareError);

    // If Square fails, mark the pending order as failed so we don't have
    // orphaned pending rows piling up.
    await supabase
      .from("ticket_orders")
      .update({ status: "failed" })
      .eq("id", order.id);

    // Surface Square's specific error reasons if we have them
    if (squareError.result?.errors) {
      return err(400, "Square checkout creation failed", {
        details: squareError.result.errors.map((e) => ({
          code: e.code,
          detail: e.detail,
          field: e.field,
        })),
      });
    }
    return err(500, "Could not create Square checkout link");
  }
};
