/**
 * ============================================
 * WAITLESS — Square OAuth Callback
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/square-oauth-callback.js
 *
 * UPDATED: now saves merchant_id to the venues table during OAuth, so the
 * ticket webhook can route incoming payment events by merchant.
 *
 * FLOW:
 * 1. Vendor clicks "Connect Square" in admin dashboard
 * 2. Gets redirected to Square's OAuth authorization page
 * 3. Vendor logs in and clicks "Allow"
 * 4. Square redirects back here with an authorization code
 * 5. We exchange the code for an access token + merchant_id
 * 6. Save token + merchant_id + location to the venue row
 * 7. Redirect vendor back to their admin dashboard
 * ============================================
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { code, state, error: oauthError, error_description } = params;

  // State contains the venue ID (passed when we initiated the OAuth flow)
  const venueId = state;

  // Handle errors from Square
  if (oauthError) {
    console.error('Square OAuth error:', oauthError, error_description);
    return redirect(venueId, `error=${encodeURIComponent(error_description || oauthError)}`);
  }

  if (!code || !venueId) {
    return redirect(venueId, 'error=missing_code_or_venue');
  }

  // Build the exact same redirect_uri that AdminView used when initiating the
  // OAuth flow. Square requires this to match byte-for-byte during the
  // token exchange.
  const baseUrl = process.env.URL || 'https://waitlss.netlify.app';
  const redirectUri = `${baseUrl}/.netlify/functions/square-oauth-callback`;

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://connect.squareup.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18',
      },
      body: JSON.stringify({
        client_id: process.env.SQUARE_APP_ID,
        client_secret: process.env.SQUARE_APP_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('Token exchange failed:', tokenData);
      return redirect(venueId, 'error=token_exchange_failed');
    }

    const {
      access_token,
      refresh_token,
      expires_at,
      merchant_id, // <-- NEW: we save this now
    } = tokenData;

    // Get the merchant's locations to find their primary location ID
    const locationsResponse = await fetch('https://connect.squareup.com/v2/locations', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Square-Version': '2024-01-18',
      },
    });

    const locationsData = await locationsResponse.json();
    const locations = locationsData.locations || [];

    // Use the first active location (or the main one)
    const primaryLocation = locations.find(l => l.status === 'ACTIVE') || locations[0];
    const locationId = primaryLocation?.id;square_app_id: process.env.SQUARE_APP_ID

    if (!locationId) {
      console.error('No active locations found for merchant');
      return redirect(venueId, 'error=no_active_locations');
    }

    // Save credentials to the venue row
    // NEW: square_merchant_id is now persisted so the ticket webhook can route by it
    const { error: updateError } = await supabase
      .from('venues')
      .update({
        square_app_id: process.env.SQUARE_APP_ID,
        square_access_token: access_token,
        square_refresh_token: refresh_token,
        square_token_expires_at: expires_at,
        square_location_id: locationId,
        square_environment: 'production',
        square_merchant_id: merchant_id,
      })
      .eq('id', venueId);

    if (updateError) {
      console.error('Failed to save credentials:', updateError);
      return redirect(venueId, 'error=save_failed');
    }

    // Success — redirect back to admin with success message
    return redirect(venueId, 'square=connected');

  } catch (err) {
    console.error('OAuth callback error:', err);
    return redirect(venueId, 'error=unexpected_error');
  }
};

function redirect(venueId, queryParam) {
  const baseUrl = process.env.URL || 'https://waitlss.netlify.app';

  if (venueId) {
    return {
      statusCode: 302,
      headers: {
        Location: `${baseUrl}/oauth-complete?venue_id=${venueId}&${queryParam}`,
      },
      body: '',
    };
  }

  return {
    statusCode: 302,
    headers: {
      Location: `${baseUrl}/?${queryParam}`,
    },
    body: '',
  };
}
