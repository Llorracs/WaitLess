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
 *   3. Validates and records buyer's T&C acceptance (REQUIRED)
 *   4. Computes the buyer-paid total (face value + Square processing pass-through)
 *   5. Inserts a 'pending' row into ticket_orders with terms_accepted_at + terms_version
 *   6. Creates a Square-hosted checkout (CreatePaymentLink) tied to that order via reference_id
 *   7. Returns the checkout URL to the frontend, which does window.location = url
 *
 * The actual conversion of pending → paid (and creation of individual tickets)
 * happens in ticket-webhook.js, triggered by Square's payment.updated event.
 *
 * MAY 14 2026 PHONE NORMALIZATION FIX:
 *   Square's CreatePaymentLink requires phone in strict E.164 format
 *   (e.g. "+15555551234"). Buyers entering bare 10-digit US numbers like
 *   "2028150435" caused INVALID_PHONE_NUMBER 400 errors that broke checkout
 *   for every TRFQ customer. Added normalizePhoneE164() — accepts common
 *   US formats (10 digits, with/without country code, with formatting
 *   characters) and returns E.164. Returns null if input is unparseable;
 *   we then skip prePopulatedData.buyerPhoneNumber and let Square's hosted
 *   page collect it instead of blocking the checkout.
 *
 * REQUEST BODY:
 *   {
 *     venueSlug:        "trfq",
 *     eventSlug:        "trfq-in-the-city",
 *     selections:       [{ ticketTypeId: "uuid", qty: 2 }, ...],
 *     buyer:            { name: "Jane Doe", email: "j@x.com", phone: "+15555551234" },
 *     termsAccepted:    true,           // REQUIRED — must be exact boolean true
 *     termsVersion:     "2026.05.12"    // REQUIRED — matches POLICY_VERSION in LegalPages
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

// Accepted T&C versions. Must be kept in sync with POLICY_VERSION in
// src/LegalPages.jsx. When the policy is updated, BOTH must change in lockstep.
const ACCEPTED_TERMS_VERSIONS = ["2026.05.12"];

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
 * Normalize a phone number to E.164 format for Square.
 *
 * E.164 is the international standard: leading "+", country code, then
 * subscriber digits, no spaces or formatting. Square requires this.
 *
 * INPUTS we handle (real-world buyer entries):
 *   "2028150435"       → "+12028150435"  (10 digits, assume US/+1)
 *   "(202) 815-0435"   → "+12028150435"  (formatted, strip non-digits)
 *   "202-815-0435"     → "+12028150435"  (dashed)
 *   "1-202-815-0435"   → "+12028150435"  (11 digits starting with 1)
 *   "12028150435"      → "+12028150435"  (same, no dashes)
 *   "+12028150435"     → "+12028150435"  (already E.164, pass-through)
 *   "+447911123456"    → "+447911123456" (international, pass-through)
 *
 * INPUTS we reject (return null):
 *   "" or null         → null  (nothing to normalize)
 *   "555"              → null  (too short)
 *   "abc"              → null  (no digits)
 *   "+0"               → null  (impossible country code)
 *
 * Returning null is the signal to caller: "I couldn't parse this, don't
 * send it to Square — let the buyer enter it on Square's hosted page."
 * This is better than rejecting the checkout entirely.
 */
function normalizePhoneE164(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already E.164? Pass through with minimal validation: + followed by
  // 8-15 digits per the E.164 spec.
  if (trimmed.startsWith("+")) {
    const digitsOnly = trimmed.slice(1).replace(/\D/g, "");
    if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
      return `+${digitsOnly}`;
    }
    return null;
  }

  // Strip all non-digits and decide based on length
  const digits = trimmed.replace(/\D/g, "");

  // 10 digits = bare US/Canada number → prepend +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  // 11 digits starting with 1 = US/Canada with country code → prepend +
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  // Anything else is ambiguous — let Square ask for it
  return null;
}

/**
 * Compute the buyer-paid total under Pattern A (pass-through).
 *
 * Returns integer cents in all fields.
 */
function computeTotals(faceCents) {
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

  const { venueSlug, eventSlug, selections, buyer, termsAccepted, termsVersion } = body;

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

  // Normalize the buyer's phone. If unparseable, store the raw string in the
  // DB (for our records / refund lookups) but skip prePopulatedData on the
  // Square side — Square's hosted page will collect it cleanly.
  const phoneE164 = normalizePhoneE164(buyer.phone);

  // -------------------------------------------------------------------------
  // 1b. Validate T&C acceptance — strict server-side enforcement
  // -------------------------------------------------------------------------
  if (termsAccepted !== true) {
    return err(400, "You must accept the Terms of Service and Refund Policy to continue");
  }
  if (typeof termsVersion !== "string" || !termsVersion) {
    return err(400, "Missing terms version");
  }
  if (!ACCEPTED_TERMS_VERSIONS.includes(termsVersion)) {
    return err(400, "Terms version is outdated. Please refresh the page and try again.");
  }

  const termsAcceptedAt = new Date().toISOString();

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
  // For buyer_phone we save the E.164-normalized version when we have one;
  // otherwise the raw buyer input (so refund / contact still works even if
  // Square didn't get a pre-populated value).
  // -------------------------------------------------------------------------
  const phoneForDb = phoneE164 || buyer.phone?.trim() || null;

  const { data: order, error: orderErr } = await supabase
    .from("ticket_orders")
    .insert({
      venue_id: venue.id,
      event_id: eventRow.id,
      buyer_name: buyer.name.trim(),
      buyer_email: buyer.email.trim().toLowerCase(),
      buyer_phone: phoneForDb,
      subtotal_cents: totals.faceCents,
      fee_cents: totals.processingCents,
      total_cents: totals.totalCents,
      status: "pending",
      terms_accepted_at: termsAcceptedAt,
      terms_version: termsVersion,
    })
    .select()
    .single();

  if (orderErr || !order) {
    console.error("Failed to insert ticket_orders:", orderErr);
    return err(500, "Could not create order");
  }

  // -------------------------------------------------------------------------
  // 7. Build Square line items
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
      note: `tt:${tt.id}`,
    });
  }

  // Single processing line item (per-transaction, not per-ticket)
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

  const siteUrl = process.env.URL || "https://waitlss.netlify.app";
  const redirectUrl = `${siteUrl}/${venue.slug}/buy/${eventRow.slug}/confirmation?order_id=${order.id}`;

  // Build prePopulatedData WITHOUT phone if we couldn't normalize it.
  // Square's hosted page will then collect the phone itself, in its own
  // validator-friendly UI. This is much better than 400 INVALID_PHONE_NUMBER.
  const prePopulatedData = {
    buyerEmail: order.buyer_email,
  };
  if (phoneE164) {
    prePopulatedData.buyerPhoneNumber = phoneE164;
  }

  try {
    const paymentLinkResp = await squareClient.checkoutApi.createPaymentLink({
      idempotencyKey: `ticket-order-${order.id}`,
      order: {
        locationId: venue.square_location_id,
        referenceId: order.id,
        lineItems,
      },
      checkoutOptions: {
        redirectUrl,
        askForShippingAddress: false,
        merchantSupportEmail: undefined,
        acceptedPaymentMethods: {
          applePay: true,
          googlePay: true,
          cashAppPay: true,
          afterpayClearpay: false,
        },
      },
      prePopulatedData,
    });

    const paymentLink = paymentLinkResp.result?.paymentLink;
    if (!paymentLink?.url) {
      throw new Error("Square returned no payment link");
    }

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

    await supabase
      .from("ticket_orders")
      .update({ status: "failed" })
      .eq("id", order.id);

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
