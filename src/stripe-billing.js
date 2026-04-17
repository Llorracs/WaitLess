/**
 * ============================================
 * WAITLESS — Stripe Billing
 * Netlify Serverless Function
 * ============================================
 * 
 * Path: netlify/functions/stripe-billing.js
 * 
 * Handles:
 * - Creating Stripe checkout sessions for new subscriptions
 * - Creating Stripe customer portal sessions (manage/cancel)
 * - Webhook handling for subscription lifecycle events
 * ============================================
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,   // $199/month
  annual: process.env.STRIPE_PRICE_ANNUAL,      // $1,799/year
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Route based on path
  const path = event.path.replace('/.netlify/functions/stripe-billing', '');

  try {
    // ---- CREATE CHECKOUT SESSION ----
    if (path === '/create-checkout' && event.httpMethod === 'POST') {
      const { venueId, plan, successUrl, cancelUrl } = JSON.parse(event.body);

      if (!venueId || !plan) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing venueId or plan' }) };
      }

      // Get venue info
      const { data: venue, error: venueError } = await supabase
        .from('venues')
        .select('id, name, owner_email, subscription_id')
        .eq('id', venueId)
        .single();

      if (venueError || !venue) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Venue not found' }) };
      }

      // Check if they already have a Stripe customer
      let customerId;
      if (venue.subscription_id) {
        // Retrieve existing subscription to get customer
        try {
          const existingSub = await stripe.subscriptions.retrieve(venue.subscription_id);
          customerId = existingSub.customer;
        } catch (e) {
          // Subscription doesn't exist anymore, that's fine
        }
      }

      const priceId = plan === 'annual' ? PRICES.annual : PRICES.monthly;

      const sessionParams = {
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{
          price: priceId,
          quantity: 1,
        }],
        success_url: successUrl || `${process.env.URL}/${venue.slug || ''}/admin?billing=success`,
        cancel_url: cancelUrl || `${process.env.URL}/${venue.slug || ''}/admin?billing=cancelled`,
        metadata: {
          venue_id: venueId,
        },
        subscription_data: {
          metadata: {
            venue_id: venueId,
          },
          trial_period_days: 14,
        },
      };

      if (customerId) {
        sessionParams.customer = customerId;
      } else {
        sessionParams.customer_email = venue.owner_email;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: session.url }),
      };
    }

    // ---- CREATE CUSTOMER PORTAL SESSION ----
    if (path === '/customer-portal' && event.httpMethod === 'POST') {
      const { venueId, returnUrl } = JSON.parse(event.body);

      const { data: venue } = await supabase
        .from('venues')
        .select('subscription_id')
        .eq('id', venueId)
        .single();

      if (!venue?.subscription_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No active subscription' }) };
      }

      const subscription = await stripe.subscriptions.retrieve(venue.subscription_id);

      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.customer,
        return_url: returnUrl || `${process.env.URL}/admin`,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: session.url }),
      };
    }

    // ---- WEBHOOK ----
    if (path === '/webhook' && event.httpMethod === 'POST') {
      const sig = event.headers['stripe-signature'];
      let stripeEvent;

      try {
        stripeEvent = stripe.webhooks.constructEvent(
          event.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
      }

      const { type, data } = stripeEvent;

      switch (type) {
        case 'checkout.session.completed': {
          const session = data.object;
          const venueId = session.metadata?.venue_id;
          const subscriptionId = session.subscription;

          if (venueId && subscriptionId) {
            await supabase
              .from('venues')
              .update({
                subscription_id: subscriptionId,
                subscription_status: 'active',
              })
              .eq('id', venueId);
          }
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = data.object;
          const venueId = subscription.metadata?.venue_id;
          const status = subscription.status;

          if (venueId) {
            let mappedStatus = 'active';
            if (status === 'trialing') mappedStatus = 'trial';
            else if (status === 'past_due') mappedStatus = 'past_due';
            else if (status === 'canceled' || status === 'unpaid') mappedStatus = 'cancelled';
            else if (status === 'active') mappedStatus = 'active';

            await supabase
              .from('venues')
              .update({ subscription_status: mappedStatus })
              .eq('id', venueId);
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = data.object;
          const venueId = subscription.metadata?.venue_id;

          if (venueId) {
            await supabase
              .from('venues')
              .update({
                subscription_status: 'cancelled',
                subscription_id: null,
              })
              .eq('id', venueId);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = data.object;
          const subscriptionId = invoice.subscription;

          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const venueId = subscription.metadata?.venue_id;

            if (venueId) {
              await supabase
                .from('venues')
                .update({ subscription_status: 'past_due' })
                .eq('id', venueId);
            }
          }
          break;
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

  } catch (error) {
    console.error('Stripe billing error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
