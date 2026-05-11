/**
 * ============================================
 * WAITLESS — Resend Email Test
 * Netlify Serverless Function
 * ============================================
 *
 * Path: netlify/functions/test-email.js
 *
 * ONE-TIME DIAGNOSTIC. Hit this endpoint to verify that:
 *   1. RESEND_API_KEY env var is set correctly in Netlify
 *   2. waitless.events DNS is verified on Resend
 *   3. Netlify functions can reach the Resend API
 *
 * Usage (from a browser):
 *   https://waitless.events/.netlify/functions/test-email?to=YOUR_EMAIL@gmail.com
 *
 * Delete this file after the email arrives successfully. Leaving open test
 * endpoints in production is a small security risk (someone could spam emails
 * by hitting your URL with different `to` values).
 * ============================================
 */

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Pull recipient from the query string
  const toAddress = event.queryStringParameters?.to;
  if (!toAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddress)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "Missing or invalid 'to' parameter",
        usage: "Append ?to=your@email.com to the URL",
      }),
    };
  }

  // Check that the API key is actually set
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "RESEND_API_KEY env var is not set in Netlify",
      }),
    };
  }

  const fromAddress = process.env.EMAIL_FROM_DEFAULT || "Waitless Tickets <tickets@waitless.events>";

  // Call the Resend API directly via fetch — no SDK needed for a single send
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        subject: "Waitless test send — domain and API key verified",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #0a0a0a; color: #f5f5f5;">
            <h1 style="font-family: 'Oswald', sans-serif; font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 0 0 8px; background: linear-gradient(135deg, #e91e8c, #d4a843); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">WAITLESS</h1>
            <p style="font-size: 11px; letter-spacing: 3px; color: #666; margin: 0 0 24px; text-transform: uppercase;">Weightless service, zero wait</p>
            <p style="font-size: 16px; line-height: 1.6; color: #f5f5f5;">If you're reading this, your email infrastructure is working end-to-end:</p>
            <ul style="font-size: 14px; line-height: 1.8; color: #888;">
              <li>Cloudflare DNS records propagated</li>
              <li>Resend verified <strong style="color: #d4a843;">waitless.events</strong></li>
              <li>Netlify environment variables loaded</li>
              <li>Serverless function reached Resend API</li>
            </ul>
            <p style="font-size: 13px; color: #666; margin-top: 32px; padding-top: 16px; border-top: 1px solid #222;">Sent from a Netlify function via Resend. This was a test send — you can delete /netlify/functions/test-email.js now.</p>
          </div>
        `,
        text: "Waitless test send. If you received this, the email infrastructure (Cloudflare DNS - Resend - Netlify function) is fully working.",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          success: false,
          status: response.status,
          error: "Resend rejected the request",
          resendResponse: data,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Email sent to ${toAddress}. Check inbox (and spam folder) within 30 seconds.`,
        resendId: data.id,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Function crashed",
        message: err.message,
      }),
    };
  }
};
