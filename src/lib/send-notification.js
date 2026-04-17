/**
 * ============================================
 * WAITLESS — SMS Notification
 * Netlify Serverless Function
 * ============================================
 * 
 * Path: netlify/functions/send-notification.js
 * 
 * Sends SMS via Twilio when bartender marks order ready.
 * Called from the bartender view.
 * ============================================
 */

const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { orderId, venueId } = JSON.parse(event.body);

    if (!orderId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing orderId' }) };
    }

    // Get the order with phone number
    const { data: order, error: orderError } = await supabase
      .from('bar_orders')
      .select('id, confirm_letter, confirm_color, patron_phone, venue_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
    }

    // No phone number = no SMS (patron opted out)
    if (!order.patron_phone) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ sent: false, reason: 'No phone number on order' }),
      };
    }

    // Get venue name
    const { data: venue } = await supabase
      .from('venues')
      .select('name')
      .eq('id', order.venue_id)
      .single();

    const venueName = venue?.name || 'Your venue';

    // Send SMS
    const message = await client.messages.create({
      body: `Your order is ready for pickup! Show your ${order.confirm_color} ${order.confirm_letter} badge at the bar. - ${venueName} via Waitless`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: order.patron_phone,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sent: true, messageId: message.sid }),
    };

  } catch (error) {
    console.error('SMS notification error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to send notification' }),
    };
  }
};
