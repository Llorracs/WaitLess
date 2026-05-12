/**
 * ============================================
 * WAITLESS — Legal Pages (v2)
 * ============================================
 *
 * FILE: src/LegalPages.jsx
 *
 * Exports four React components, one per legal page:
 *   - <TermsOfService />     — /terms
 *   - <RefundPolicy />       — /refund-policy
 *   - <PrivacyPolicy />      — /privacy
 *   - <VenueTerms />         — /venue-terms (linked from onboarding)
 *
 * Each is a single, self-contained, styled component.
 *
 * VERSIONING: When updating policy text, bump POLICY_VERSION below. The buy
 * page records this version on each order so we can prove what each historical
 * buyer agreed to. When the version changes, existing venues should re-accept
 * (handled in admin UI later).
 *
 * REVIEW NOTES (for the lawyer pass later):
 *   - Pattern A pricing assumption: buyer pays Square processing on top of face
 *   - Mandatory refund-reason categories defined in process-refund.js
 *   - Three-strike chargeback policy
 *   - Force majeure with refund-OR-credit option
 *   - Strict failed-age-verification at door (no refund)
 *   - Venue indemnification for alcohol service compliance
 * ============================================
 */

import React from "react";

// Bump this whenever any policy text materially changes
export const POLICY_VERSION = "2026.05.12";

// ============================================================================
// SHARED LAYOUT
// ============================================================================

function LegalLayout({ title, version, lastUpdated, children }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#f5f5f5",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1a1a1a",
        padding: "24px 20px",
        background: "linear-gradient(180deg, #0a0a0a, #050505)",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <a href="/" style={{ textDecoration: "none", display: "inline-block" }}>
            <h1 style={{
              fontFamily: "'Oswald', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              margin: 0,
              background: "linear-gradient(135deg, #1E4D8C, #D4A843)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              WAITLESS
            </h1>
          </a>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 9,
            color: "#555",
            letterSpacing: 3,
            marginTop: 4,
            textTransform: "uppercase",
          }}>
            Legal
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px 80px" }}>
        <h2 style={{
          fontFamily: "'Oswald', sans-serif",
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: 2,
          margin: "0 0 8px",
          color: "#f5f5f5",
        }}>
          {title}
        </h2>
        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 10,
          color: "#666",
          letterSpacing: 1,
          marginBottom: 32,
        }}>
          VERSION {version} &nbsp;&middot;&nbsp; LAST UPDATED {lastUpdated}
        </div>
        <div style={{
          fontSize: 15,
          lineHeight: 1.7,
          color: "#ccc",
        }}>
          {children}
        </div>

        {/* Footer nav */}
        <div style={{
          marginTop: 64,
          paddingTop: 24,
          borderTop: "1px solid #1a1a1a",
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          fontFamily: "'Space Mono', monospace",
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}>
          <a href="/terms" style={{ color: "#888", textDecoration: "none" }}>Terms</a>
          <a href="/refund-policy" style={{ color: "#888", textDecoration: "none" }}>Refunds</a>
          <a href="/privacy" style={{ color: "#888", textDecoration: "none" }}>Privacy</a>
          <a href="/venue-terms" style={{ color: "#888", textDecoration: "none" }}>For Venues</a>
          <a href="/" style={{ color: "#D4A843", textDecoration: "none", marginLeft: "auto" }}>
            &larr; Back to Waitless
          </a>
        </div>
      </div>
    </div>
  );
}

// Reusable styled section header within a legal doc
function Section({ number, title, children }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h3 style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 18,
        fontWeight: 600,
        letterSpacing: 1,
        color: "#D4A843",
        marginBottom: 12,
        marginTop: 0,
      }}>
        {number ? `${number}. ` : ""}{title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

// ============================================================================
// TERMS OF SERVICE
// ============================================================================

export function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service" version={POLICY_VERSION} lastUpdated="May 12, 2026">
      <p style={{ marginBottom: 24 }}>
        These Terms of Service ("Terms") govern your use of the Waitless platform ("Waitless," "we," "us"). By using Waitless to purchase tickets or place orders, you agree to these Terms.
      </p>

      <Section number={1} title="What Waitless is">
        <p>Waitless provides software infrastructure that allows event venues and organizers ("Venues") to sell tickets, accept drink and food orders, and manage event operations. Waitless is not a Venue, does not sell tickets directly, and does not provide goods or services at events.</p>
        <p>Each transaction occurs between you (the "buyer" or "attendee") and the Venue hosting the event. Waitless facilitates the transaction technically.</p>
      </Section>

      <Section number={2} title="Eligibility">
        <p>You must be at least 18 years old to make purchases through Waitless. Certain ticket types or drink orders may require additional age verification (e.g., 21+ for events serving alcohol). Such requirements will be displayed at the time of purchase, and you must truthfully confirm your age before completing the transaction.</p>
      </Section>

      <Section number={3} title="Age verification at events">
        <p>For events or ticket types requiring age verification, attendees must present valid government-issued photo ID confirming they meet the age requirement at check-in.</p>
        <p>The Venue may, at its sole discretion, refuse entry to any attendee whose identification appears invalid, expired, altered, or who appears to be presenting another person's identification. <strong>Tickets denied entry under this section are not eligible for refund.</strong></p>
        <p>One person may purchase tickets for multiple attendees. The name on the ticket may not match the name on the attendee's ID, and this is allowed. However, the Venue may exercise judgment when an age-restricted ticket appears to involve identity misrepresentation.</p>
      </Section>

      <Section number={4} title="Payment">
        <p>All purchases are processed through Square, a third-party payment processor. By providing payment information, you authorize the Venue to charge the displayed total to your payment method.</p>
        <p>Your total may include the face value of the ticket plus a payment processing fee, displayed clearly before purchase. Waitless does not collect any per-transaction fees from buyers.</p>
      </Section>

      <Section number={5} title="Tickets and check-in">
        <p>Upon successful payment, you will receive an email with a QR code for each ticket purchased. Present this QR code at the event for check-in. Once a ticket is scanned, it is considered used and cannot be transferred or refunded.</p>
        <p>Tickets are non-transferable through the Waitless platform. As the buyer of record, you may distribute QR codes to companions, but the Venue reserves the right to deny entry if QR codes appear to have been resold for profit or otherwise distributed in bad faith.</p>
      </Section>

      <Section number={6} title="Buyer responsibility for accurate information">
        <p>You are responsible for providing accurate contact information (name, email, phone) at the time of purchase. Waitless and the Venue are not responsible for tickets sent to an incorrectly entered email address.</p>
        <p>If you lose your confirmation email, you can recover your tickets using the ticket lookup tool at <a href="/lookup" style={{ color: "#D4A843" }}>waitless.events/lookup</a> with your original purchase email.</p>
      </Section>

      <Section number={7} title="Right to refuse service">
        <p>Venues reserve the right to refuse entry or remove any attendee at their discretion for behavior including but not limited to intoxication, aggression, disruption, harassment of other guests or staff, or violation of Venue policies. Refunds in such cases are not provided.</p>
      </Section>

      <Section number={8} title="Refunds">
        <p>Refund eligibility is governed by our <a href="/refund-policy" style={{ color: "#D4A843" }}>Refund Policy</a>, which is incorporated into these Terms by reference.</p>
      </Section>

      <Section number={9} title="Chargebacks">
        <p>If you believe a charge is incorrect, contact the Venue or Waitless support before filing a chargeback with your bank or card issuer. Repeat chargebacks (three or more across any orders) may result in your email address being banned from future Waitless purchases.</p>
      </Section>

      <Section number={10} title="Platform liability">
        <p>Waitless provides software infrastructure only and is not a party to any transaction between buyers and Venues. Waitless makes no warranties about events, products, or services sold through the platform.</p>
        <p>Buyers acknowledge that attending events — particularly those involving alcohol, large crowds, or physical activity — carries inherent risks. You attend events at your own risk and waive any claims against Waitless arising from your attendance, consumption of alcohol or food, interactions with other attendees, or actions of Venue staff.</p>
      </Section>

      <Section number={11} title="Privacy">
        <p>Your use of Waitless is also governed by our <a href="/privacy" style={{ color: "#D4A843" }}>Privacy Policy</a>.</p>
      </Section>

      <Section number={12} title="Changes to these Terms">
        <p>Waitless may update these Terms at any time. Material changes will be reflected in the version number at the top of this page. Continued use of the platform after a version change constitutes acceptance of the updated Terms.</p>
      </Section>

      <Section number={13} title="Contact">
        <p>Questions about these Terms? Contact us at <strong>atimelssconcept@gmail.com</strong>.</p>
        {/* TODO: Update to support@waitless.events once domain email is configured */}
      </Section>
    </LegalLayout>
  );
}

// ============================================================================
// REFUND POLICY
// ============================================================================

export function RefundPolicy() {
  return (
    <LegalLayout title="Refund Policy" version={POLICY_VERSION} lastUpdated="May 12, 2026">
      <p style={{ marginBottom: 24 }}>
        This Refund Policy governs ticket purchases made through the Waitless platform on behalf of event organizers and venues ("Venues"). By purchasing tickets, you agree to the terms below.
      </p>

      <Section number={1} title="All sales final after event start">
        <p>All ticket sales become final at the start time of the event listed at time of purchase. Refund requests must be received <strong>before</strong> the event start time to be considered.</p>
      </Section>

      <Section number={2} title="Refunds are at Venue discretion">
        <p>Refunds are issued at the discretion of the Venue hosting the event. Waitless does not unilaterally issue refunds. To request a refund, contact the Venue directly using the support information on your ticket confirmation email.</p>
      </Section>

      <Section number={3} title="Checked-in tickets are non-refundable">
        <p>Once a ticket has been scanned at the event entrance, it is no longer eligible for refund under any circumstance. This applies to the individual ticket scanned; other tickets in the same order may remain refundable if they have not been scanned.</p>
      </Section>

      <Section number={4} title="Payment processing fees are non-refundable">
        <p>When you purchase a ticket, your total includes a payment processing fee charged by our payment processor (Square). <strong>This processing fee is not refundable</strong> by Waitless or the Venue, even when the full face value of the ticket is refunded. This fee is retained by Square and is outside our control.</p>
        <p style={{
          background: "#141414",
          padding: "12px 16px",
          borderRadius: 8,
          borderLeft: "3px solid #D4A843",
          fontSize: 14,
          color: "#aaa",
        }}>
          <strong style={{ color: "#D4A843" }}>Example:</strong> If you paid $52.00 for a ticket ($50.00 face value + $2.00 processing fee) and receive a full refund, you will receive $52.00 back to your card. The Venue absorbs the $2.00 processing fee.
        </p>
      </Section>

      <Section number={5} title="Partial refunds">
        <p>If you purchased multiple tickets in a single order, the Venue may issue a refund for individual tickets while leaving others valid. The refunded amount will be the face value of the specific tickets refunded.</p>
      </Section>

      <Section number={6} title="Refund processing time">
        <p>Approved refunds will be returned to the original payment method within 5–10 business days. Waitless does not control the speed at which your bank or card issuer credits your account.</p>
      </Section>

      <Section number={7} title="Event cancellations by the Venue">
        <p>If an event is cancelled by the Venue (for any reason other than force majeure described in Section 8), all ticket holders will be refunded the face value of their tickets. Processing fees remain non-refundable per Section 4 — the Venue absorbs the processing fee on cancellation.</p>
      </Section>

      <Section number={8} title="Force majeure">
        <p>In the event of cancellation, postponement, or material modification due to circumstances outside the Venue's reasonable control — including severe weather, natural disasters, public health emergencies, government orders, venue infrastructure failures, or similar events — the Venue may offer affected ticket holders either:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>A full refund of the ticket face value, or</li>
          <li>A credit for an equivalent ticket at a rescheduled or future event hosted by the same Venue</li>
        </ul>
        <p style={{ marginTop: 12 }}>The choice between refund and credit is at the Venue's discretion and will be communicated to ticket holders via email. Processing fees remain non-refundable.</p>
      </Section>

      <Section number={9} title="Event changes (date, location, format)">
        <p>If a Venue materially changes an event's date, location, or format after tickets are sold, ticket holders may request a refund within 24 hours of the change being announced. Contact the Venue directly to request a refund under this provision.</p>
      </Section>

      <Section number={10} title="Failed age verification">
        <p>For tickets requiring age verification, attendees who cannot present valid identification meeting the age requirement will be denied entry per our <a href="/terms" style={{ color: "#D4A843" }}>Terms of Service</a>. <strong>Tickets denied entry due to failed age verification are not eligible for refund.</strong></p>
        <p>This includes attendees who are underage, attendees presenting another person's identification, and attendees who fail to bring identification.</p>
      </Section>

      <Section number={11} title="Disputes">
        <p>If you believe a refund has been wrongly denied, contact the Venue first. If the dispute cannot be resolved with the Venue, you may contact Waitless support at <strong>atimelssconcept@gmail.com</strong>. Waitless will review the dispute but reserves the right to defer to the Venue's decision.</p>
        {/* TODO: Update to support@waitless.events once domain email is configured */}
      </Section>

      <Section number={12} title="Chargebacks">
        <p>Filing a chargeback with your bank or card issuer without first attempting to resolve the issue with the Venue is strongly discouraged. Repeat chargebacks (three or more across any orders) may result in your email address being banned from future Waitless purchases. Chargebacks are reviewed on a case-by-case basis.</p>
      </Section>

      <Section number={13} title="Venue-specific policies">
        <p>Venues may publish a stricter or more lenient refund policy that supersedes this default. When a Venue has a custom policy, it will be displayed on the ticket purchase page at the time of sale and on the event listing.</p>
      </Section>
    </LegalLayout>
  );
}

// ============================================================================
// PRIVACY POLICY
// ============================================================================

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" version={POLICY_VERSION} lastUpdated="May 12, 2026">
      <p style={{ marginBottom: 24 }}>
        This Privacy Policy describes how Waitless collects, uses, and shares information when you use our platform.
      </p>

      <Section number={1} title="What we collect">
        <p>When you make a purchase or interact with Waitless, we collect:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li><strong>Contact information:</strong> name, email address, and (optionally) phone number you provide at checkout</li>
          <li><strong>Order information:</strong> tickets purchased, drinks ordered, event attended, timestamps</li>
          <li><strong>Payment information:</strong> processed by Square; Waitless does not store full card numbers</li>
          <li><strong>Device information:</strong> browser type, IP address, and basic usage analytics</li>
        </ul>
      </Section>

      <Section number={2} title="How we use it">
        <p>We use this information to:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Process your orders and deliver tickets</li>
          <li>Send transactional emails (order confirmations, refund notifications, drink-ready alerts)</li>
          <li>Share order details with the Venue you purchased from, so they can serve you</li>
          <li>Detect and prevent fraud</li>
          <li>Improve the platform</li>
        </ul>
      </Section>

      <Section number={3} title="Who we share it with">
        <p>We share your information only with:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li><strong>The Venue you purchased from</strong> — required so they can fulfill your order</li>
          <li><strong>Square</strong> — to process payments</li>
          <li><strong>Resend</strong> — to deliver confirmation emails</li>
          <li><strong>Twilio</strong> — if SMS notifications are enabled for your order</li>
          <li><strong>Law enforcement or regulators</strong> — only if legally required</li>
        </ul>
        <p style={{ marginTop: 12 }}><strong>We do not sell your personal information to third parties.</strong></p>
      </Section>

      <Section number={4} title="How long we keep it">
        <p>Order records are retained for 7 years for tax, accounting, and dispute-resolution purposes. Marketing communications (which we currently do not send) would be retained until you opt out.</p>
        <p>If you wish to delete your data, contact us at <strong>atimelssconcept@gmail.com</strong>. We may retain anonymized records as required by law.</p>
        {/* TODO: Update to support@waitless.events once domain email is configured */}
      </Section>

      <Section number={5} title="Your rights">
        <p>Depending on your location, you may have rights to:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Access the personal information we hold about you</li>
          <li>Request correction of inaccurate information</li>
          <li>Request deletion of your information</li>
          <li>Opt out of certain uses of your data</li>
        </ul>
        <p style={{ marginTop: 12 }}>To exercise these rights, contact us at the email above.</p>
      </Section>

      <Section number={6} title="Cookies and tracking">
        <p>Waitless uses minimal cookies necessary for the platform to function (e.g., maintaining your active order on the patron app, remembering your age verification within a session). We do not use advertising trackers or sell data to advertisers.</p>
      </Section>

      <Section number={7} title="Security">
        <p>Payment information is handled by Square under their PCI-compliant infrastructure. Your contact information is stored encrypted-in-transit and encrypted-at-rest in our database. No system is perfectly secure, but we follow industry-standard practices.</p>
      </Section>

      <Section number={8} title="Children">
        <p>Waitless is not directed to children under 18. We do not knowingly collect information from anyone under 18. If we discover we have collected information from someone under 18, we will delete it.</p>
      </Section>

      <Section number={9} title="Changes to this Policy">
        <p>We may update this Privacy Policy from time to time. Material changes will be reflected in the version number above. The Policy in effect at the time of your purchase governs that purchase.</p>
      </Section>
    </LegalLayout>
  );
}

// ============================================================================
// VENUE TERMS (for venues onboarding to Waitless)
// ============================================================================

export function VenueTerms() {
  return (
    <LegalLayout title="Venue Terms" version={POLICY_VERSION} lastUpdated="May 12, 2026">
      <p style={{ marginBottom: 24 }}>
        These Venue Terms govern Venues' ("you," "Venue") use of the Waitless platform to sell tickets, accept orders, and manage events. By creating a Venue account, you agree to these Terms.
      </p>

      <Section number={1} title="Your account">
        <p>You are responsible for maintaining the security of your Waitless account credentials and your connected payment processor (Square) credentials. You are responsible for all activity that occurs under your account.</p>
      </Section>

      <Section number={2} title="Your obligations as a Venue">
        <p>By using Waitless, you agree to:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Comply with all applicable local, state, and federal laws</li>
          <li>Hold all licenses required for your events (alcohol service, capacity permits, food handling, etc.)</li>
          <li>Honor all tickets sold through the platform — including refunds when due under our Refund Policy</li>
          <li>Maintain accurate event information (date, time, location, ticket types, pricing)</li>
          <li>Respond to buyer inquiries through the contact email associated with your account</li>
        </ul>
      </Section>

      <Section number={3} title="Alcohol service compliance">
        <p>If you sell tickets or drinks involving alcohol, you are solely responsible for compliance with all laws governing the sale and service of alcohol — including age verification, license display, and serving limits.</p>
        <p>Waitless provides software tools to support age verification (the optional age-confirmation toggle on ticket types and bar items), but makes no representations or warranties regarding the accuracy of these tools, the validity of identification presented by attendees, or your compliance with applicable law.</p>
        <p><strong>You agree to indemnify Waitless against any claims, liabilities, damages, or costs arising from improper age verification, alcohol service, or related regulatory violations at your events.</strong></p>
      </Section>

      <Section number={4} title="Payment processing">
        <p>Waitless does not handle payment funds. All payment processing occurs through your connected Square account. Funds from ticket and drink sales flow directly to your Square account and are subject to Square's payout schedule and terms.</p>
        <p>Waitless charges a flat subscription fee for use of the platform. Waitless does not take a percentage of your revenue.</p>
      </Section>

      <Section number={5} title="Refunds">
        <p>You are responsible for issuing refunds through the Waitless admin panel when due. The platform Refund Policy sets the baseline rules; you may publish a stricter or more lenient policy that supersedes the default by configuring it in your venue settings.</p>
        <p>Refunds are processed through Square's refund API and may incur a non-recoverable processing fee, which is borne by you.</p>
      </Section>

      <Section number={6} title="Content and data">
        <p>You retain ownership of all content you upload to Waitless (event descriptions, images, menu items, branding). By uploading content, you grant Waitless a non-exclusive license to display it on the platform for the purpose of selling your tickets and orders.</p>
        <p>You may export your event data, ticket data, and customer contact lists at any time through the admin panel.</p>
      </Section>

      <Section number={7} title="Service availability">
        <p>Waitless makes commercially reasonable efforts to keep the platform available, but does not guarantee uptime. We are not liable for losses arising from platform downtime, including missed sales during outages.</p>
        <p>For events of significant size or operational importance, we recommend testing the platform in advance and maintaining a manual backup process (e.g., a printed guest list at the door).</p>
      </Section>

      <Section number={8} title="Termination">
        <p>You may cancel your Waitless account at any time. We may suspend or terminate accounts that violate these Terms, engage in fraudulent activity, fail to honor tickets or refunds, or generate excessive chargebacks from buyers.</p>
        <p>Upon termination, your data will be retained for 90 days in case of re-activation, then deleted (except where retention is legally required).</p>
      </Section>

      <Section number={9} title="Indemnification">
        <p>You agree to indemnify and hold harmless Waitless, its officers, employees, and affiliates from any claims, damages, losses, liabilities, or expenses arising from:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Your events, products, or services</li>
          <li>Your compliance with applicable laws</li>
          <li>Your interactions with attendees, staff, or third parties</li>
          <li>Disputes between you and buyers, including chargebacks</li>
          <li>Your use of the Waitless platform</li>
        </ul>
      </Section>

      <Section number={10} title="Limitation of liability">
        <p>Waitless's total liability to you under these Terms, for any cause, shall not exceed the subscription fees you paid in the 12 months preceding the claim. Waitless is not liable for indirect, consequential, or punitive damages including lost profits.</p>
      </Section>

      <Section number={11} title="Changes to these Terms">
        <p>Waitless may update these Terms. Material changes will require you to re-accept the Terms before creating new events. The version in effect at the time of each event's creation governs that event.</p>
      </Section>

      <Section number={12} title="Contact">
        <p>Questions about these Venue Terms? Contact us at <strong>atimelssconcept@gmail.com</strong>.</p>
        {/* TODO: Update to support@waitless.events once domain email is configured */}
      </Section>
    </LegalLayout>
  );
}
