/**
 * ============================================
 * WAITLESS — Backfill Merchant ID
 * Netlify Serverless Function (ONE-TIME DIAGNOSTIC)
 * ============================================
 *
 * Path: netlify/functions/backfill-merchant-id.js
 *
 * Uses a venue's stored Square access token to ask Square "who am I?" and
 * returns the merchant_id. Output includes the SQL to run to save it.
 *
 * Usage (in browser):
 *   https://waitless.events/.netlify/functions/backfill-merchant-id?slug=trfq
 *
 * DELETE THIS FILE after backfilling. Same security concern as test-email.js —
 * leaving open diagnostic endpoints in production is a small risk.
 *
 * For future venues, square-oauth-callback.js has been patched to save
 * merchant_id automatically during OAuth, so this won't be needed again.
 * ============================================
 */

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  const slug = event.queryStringParameters?.slug;
  if (!slug) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing ?slug parameter" }),
    };
  }

  // Look up the venue
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, slug, name, square_access_token, square_environment, square_merchant_id")
    .eq("slug", slug)
    .single();

  if (venueErr || !venue) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: `Venue '${slug}' not found` }),
    };
  }

  if (!venue.square_access_token) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: `Venue '${slug}' has no Square access token. Must connect Square first.`,
      }),
    };
  }

  if (venue.square_merchant_id) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: "merchant_id already set",
        venue: { slug: venue.slug, merchant_id: venue.square_merchant_id },
      }),
    };
  }

  // Ask Square for this account's merchant info
  const baseUrl = venue.square_environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

  try {
    const resp = await fetch(`${baseUrl}/v2/merchants`, {
      headers: {
        Authorization: `Bearer ${venue.square_access_token}`,
        "Square-Version": "2026-01-22",
      },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: resp.status,
        headers,
        body: JSON.stringify({
          error: "Square API call failed",
          status: resp.status,
          squareResponse: errText,
        }),
      };
    }

    const data = await resp.json();
    const merchant = data.merchant?.[0];

    if (!merchant?.id) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "No merchant returned from Square",
          rawResponse: data,
        }),
      };
    }

    // Save it
    const { error: updateErr } = await supabase
      .from("venues")
      .update({ square_merchant_id: merchant.id })
      .eq("id", venue.id);

    if (updateErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Failed to save merchant_id to database",
          merchantIdRetrieved: merchant.id,
          dbError: updateErr,
          manualSql: `UPDATE venues SET square_merchant_id = '${merchant.id}' WHERE slug = '${slug}';`,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `merchant_id saved for venue '${slug}'`,
        venue: {
          slug: venue.slug,
          name: venue.name,
          merchant_id: merchant.id,
          business_name: merchant.business_name,
          country: merchant.country,
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Function crashed",
        message: err.message,
      }),
    };
  }
};
