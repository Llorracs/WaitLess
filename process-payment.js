/**
 * ============================================
 * WAITLESS — Square Payment Processing
 * Netlify Serverless Function (Multi-Tenant)
 * ============================================
 * 
 * Path: netlify/functions/process-payment.js
 * 
 * Now looks up Square credentials per venue from Supabase
 * instead of using hardcoded environment variables.
 * 
 * SETUP:
 * 1. npm install square @supabase/supabase-js
 * 2. Set environment variables in Netlify dashboard:
 *    - SUPABASE_URL
 *    - SUPABASE_SERVICE_ROLE_KEY  (service role — NOT the anon key)
 * 
 * FLOW:
 * 1. Frontend sends venueId + token + order details
 * 2. This function looks up the venue's Square credentials from Supabase
 * 3. Creates a Square client with that venue's credentials
 * 4. Processes the payment and returns confirmation
 * ============================================
 */

const { Client, Environment } = require('square');
const { createClient } = require('@supabase/supabase-js');

// Service role client — server-side only, can read Square credentials
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { venueId, sourceId, amountCents, items, idempotencyKey } = JSON.parse(event.body);

    // Validate required fields
    if (!venueId || !sourceId || !amountCents) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: venueId, sourceId, amountCents' }),
      };
    }

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid amount' }),
      };
    }

    // ========================================
    // Look up venue's Square credentials
    // ========================================
    const { data: venue, error: venueError } = await supabase
      .from('venues')
      .select('name, square_access_token, square_location_id, square_environment, service_fee_percent, currency')
      .eq('id', venueId)
      .eq('is_active', true)
      .single();

    if (venueError || !venue) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Venue not found or inactive' }),
      };
    }

    if (!venue.square_access_token || !venue.square_location_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Venue has not configured Square payments' }),
      };
    }

    // Create a Square client with this venue's credentials
    const squareClient = new Client({
      accessToken: venue.square_access_token,
      environment: venue.square_environment === 'production'
        ? Environment.Production
        : Environment.Sandbox,
    });

    // Build line items for Square order
    const lineItems = (items || []).map((item) => ({
      name: item.name,
      quantity: String(item.qty),
      basePriceMoney: {
        amount: BigInt(item.price * 100),
        currency: venue.currency || 'USD',
      },
    }));

    // Create the order in Square with venue-specific service fee
    const orderResponse = await squareClient.ordersApi.createOrder({
      order: {
        locationId: venue.square_location_id,
        lineItems,
        serviceCharges: [
          {
            name: 'Service Fee',
            percentage: String(venue.service_fee_percent || 5),
            calculationPhase: 'SUBTOTAL_PHASE',
          },
        ],
      },
      idempotencyKey: `order-${idempotencyKey || crypto.randomUUID()}`,
    });

    const orderId = orderResponse.result.order.id;

    // Process the payment
    const paymentResponse = await squareClient.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
      amountMoney: {
        amount: BigInt(amountCents),
        currency: venue.currency || 'USD',
      },
      orderId,
      locationId: venue.square_location_id,
      autocomplete: true,
      note: `${venue.name} — ${(items || []).map(i => `${i.name} x${i.qty}`).join(', ')}`,
    });

    const payment = paymentResponse.result.payment;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentId: payment.id,
        orderId,
        status: payment.status,
        receiptUrl: payment.receiptUrl,
      }),
    };

  } catch (error) {
    console.error('Square payment error:', error);

    // Handle Square API errors
    if (error.result) {
      const squareErrors = error.result.errors || [];
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Payment declined',
          details: squareErrors.map((e) => ({
            code: e.code,
            detail: e.detail,
            field: e.field,
          })),
        }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Payment processing failed. Please try again.',
      }),
    };
  }
};
