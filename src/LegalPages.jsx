/**
 * ============================================
 * WAITLESS — Legal Pages
 * ============================================
 * 
 * FILE: src/LegalPages.jsx
 * 
 * Routes:
 *   waitless.app/privacy  → Privacy Policy
 *   waitless.app/terms    → Terms of Service
 * ============================================
 */

import { useState } from "react";

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="April 2026">
      <Section title="Introduction">
        <P>Waitless ("we," "us," or "our") operates a mobile ordering platform that connects venue patrons with bartenders and food service staff. This Privacy Policy explains how we collect, use, and protect your information when you use our service.</P>
      </Section>

      <Section title="Information We Collect">
        <H4>Information You Provide</H4>
        <P>When you place an order through Waitless, we may collect:</P>
        <UL items={[
          "Phone number (optional) — only if you choose to receive SMS notifications when your order is ready",
          "Payment information — processed securely through Square. We do not store your credit card numbers.",
          "Order details — items ordered, amounts, and timestamps",
        ]} />

        <H4>Information Collected Automatically</H4>
        <P>When you use Waitless, we automatically collect:</P>
        <UL items={[
          "Device type and browser information",
          "IP address",
          "Pages visited and time spent",
        ]} />

        <H4>Age Verification</H4>
        <P>For venues that serve alcohol, we may request age verification. If you choose to scan your ID, the image is processed entirely within your device's browser using local OCR technology. The photo is never uploaded, transmitted, or stored on our servers. We only record that age verification was completed and the timestamp — no images, names, addresses, or other personal information from your ID is stored.</P>
      </Section>

      <Section title="How We Use Your Information">
        <P>We use your information to:</P>
        <UL items={[
          "Process and fulfill your orders",
          "Send you SMS notifications about your order status (only if you provide your phone number)",
          "Send browser push notifications about your order status (only if you grant permission)",
          "Provide venue owners with aggregated, anonymized analytics about order volume and trends",
          "Improve our platform and troubleshoot issues",
        ]} />
      </Section>

      <Section title="Payment Processing">
        <P>All payments are processed by Square (squareup.com). Your payment information is transmitted directly to Square's secure servers and is subject to Square's privacy policy. We receive a confirmation of payment but never see or store your full credit card number.</P>
      </Section>

      <Section title="SMS Notifications">
        <P>If you provide your phone number during checkout, you consent to receive a text message when your order is ready for pickup. This is a single, transactional message per order — we do not send marketing messages, promotional content, or recurring texts. Standard message and data rates may apply. You can opt out of SMS at any time by replying STOP to any message.</P>
      </Section>

      <Section title="Data Sharing">
        <P>We do not sell, rent, or trade your personal information. We share information only in the following circumstances:</P>
        <UL items={[
          "With the venue where you placed your order — they see your order details and confirmation badge, but not your phone number or payment details",
          "With Square — for payment processing",
          "With Twilio — for SMS delivery (phone number only, if provided)",
          "If required by law — in response to valid legal requests",
        ]} />
      </Section>

      <Section title="Data Retention">
        <P>Order records are retained for 90 days for analytics and dispute resolution purposes, then automatically deleted. Phone numbers are stored only for the duration of the order lifecycle and are purged when the order is completed or expired. Age verification results (verified/not verified) are stored only in your browser session and are cleared when you close the tab.</P>
      </Section>

      <Section title="Your Rights">
        <P>You have the right to:</P>
        <UL items={[
          "Decline to provide your phone number (SMS notifications are optional)",
          "Deny push notification permissions",
          "Request deletion of your order data by contacting us",
          "Opt out of SMS by replying STOP",
        ]} />
      </Section>

      <Section title="Security">
        <P>We implement industry-standard security measures including encrypted connections (HTTPS/TLS), row-level security on our database, and secure API authentication. Payment processing is handled entirely by Square's PCI-compliant infrastructure.</P>
      </Section>

      <Section title="Children's Privacy">
        <P>Waitless is not intended for use by individuals under 13 years of age. We do not knowingly collect personal information from children under 13.</P>
      </Section>

      <Section title="Changes to This Policy">
        <P>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date.</P>
      </Section>

      <Section title="Contact Us">
        <P>If you have questions about this Privacy Policy, contact us at privacy@waitless.app.</P>
      </Section>
    </LegalPage>
  );
}

export function TermsOfService() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="April 2026">
      <Section title="Acceptance of Terms">
        <P>By using Waitless ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</P>
      </Section>

      <Section title="Description of Service">
        <P>Waitless is a mobile ordering platform that enables patrons to place and pay for food and drink orders at participating venues. The Service includes a patron-facing ordering interface, a bartender/staff queue management interface, and a venue administration dashboard.</P>
      </Section>

      <Section title="User Conduct">
        <P>When using Waitless, you agree to:</P>
        <UL items={[
          "Provide accurate information, including truthful age verification where required",
          "Not misrepresent your identity or age",
          "Not attempt to interfere with, disrupt, or exploit the Service",
          "Not use the Service for any unlawful purpose",
          "Comply with all applicable local, state, and federal laws, including alcohol consumption laws",
        ]} />
      </Section>

      <Section title="Age Verification">
        <P>Certain venues require age verification to order alcoholic beverages. By completing the age verification process, you certify that the information provided is accurate and that you meet the minimum age requirement for the venue. Misrepresenting your age is a violation of these Terms and may be illegal under applicable law. Physical identification may be verified at the venue entrance independently of the digital verification.</P>
      </Section>

      <Section title="Orders and Payments">
        <P>When you place an order through Waitless, you authorize the applicable payment amount to be charged to your payment method via Square. All sales are final once the order is submitted and confirmed. Refund policies are determined by each individual venue. Payment processing is subject to Square's terms of service.</P>
      </Section>

      <Section title="Service Fees">
        <P>Venues may apply a service fee to orders placed through Waitless. The service fee percentage is set by each venue and is clearly displayed before you complete your order. Tips are optional and go directly to the venue staff.</P>
      </Section>

      <Section title="SMS Communications">
        <P>By providing your phone number, you consent to receive transactional SMS messages related to your order status. Message frequency varies based on your orders. Message and data rates may apply. Reply STOP to opt out. Reply HELP for assistance. Carrier messaging terms also apply.</P>
      </Section>

      <Section title="For Venue Owners">
        <H4>Subscription</H4>
        <P>Venue owners subscribe to Waitless on a monthly or annual basis. Subscriptions automatically renew unless cancelled. You may cancel at any time through your admin dashboard or Stripe customer portal. No refunds are issued for partial billing periods.</P>

        <H4>Venue Responsibilities</H4>
        <P>Venue owners are responsible for:</P>
        <UL items={[
          "Maintaining accurate menu items and pricing",
          "Ensuring compliance with local health, safety, and liquor licensing regulations",
          "Managing their Square account and payment credentials",
          "Physical age verification at their venue entrance where required by law",
          "Fulfilling orders placed through the platform in a timely manner",
        ]} />

        <H4>Payment Processing</H4>
        <P>Waitless does not process payments on behalf of venues. All patron payments are processed directly through the venue's own Square account. Waitless does not take a percentage of venue sales. Funds are deposited directly into the venue's bank account by Square.</P>
      </Section>

      <Section title="Intellectual Property">
        <P>The Waitless name, logo, and all related branding are the property of Waitless. Venue branding displayed through the platform remains the property of each respective venue owner. You may not copy, modify, or distribute the Waitless platform or its code without written permission.</P>
      </Section>

      <Section title="Limitation of Liability">
        <P>Waitless provides the platform "as is" and makes no warranties regarding uptime, accuracy, or fitness for a particular purpose. Waitless is not responsible for the quality, safety, or legality of items sold by venues, nor for any disputes between patrons and venues. Our total liability is limited to the amount you paid for the Service in the preceding 12 months.</P>
      </Section>

      <Section title="Termination">
        <P>We reserve the right to suspend or terminate access to the Service for any user or venue that violates these Terms. Venue subscriptions may be terminated by either party with no penalty beyond the current billing period.</P>
      </Section>

      <Section title="Governing Law">
        <P>These Terms are governed by the laws of the State of Maryland, United States. Any disputes arising from these Terms or the Service shall be resolved in the courts of Maryland.</P>
      </Section>

      <Section title="Changes to Terms">
        <P>We may update these Terms from time to time. Continued use of the Service after changes are posted constitutes acceptance of the revised Terms.</P>
      </Section>

      <Section title="Contact">
        <P>Questions about these Terms? Contact us at legal@waitless.app.</P>
      </Section>
    </LegalPage>
  );
}

// ============================================
// SHARED COMPONENTS
// ============================================
function LegalPage({ title, lastUpdated, children }) {
  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      <nav style={S.nav}>
        <a href="/" style={S.navLogo}>WAITLESS</a>
      </nav>
      <div style={S.container}>
        <h1 style={S.title}>{title}</h1>
        <p style={S.updated}>Last updated: {lastUpdated}</p>
        <div style={S.content}>{children}</div>
        <div style={S.footer}>
          <a href="/privacy" style={S.footerLink}>Privacy Policy</a>
          <span style={S.footerDot}>·</span>
          <a href="/terms" style={S.footerLink}>Terms of Service</a>
          <span style={S.footerDot}>·</span>
          <a href="/" style={S.footerLink}>Home</a>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={S.section}>
      <h3 style={S.sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

function H4({ children }) {
  return <h4 style={S.h4}>{children}</h4>;
}

function P({ children }) {
  return <p style={S.p}>{children}</p>;
}

function UL({ items }) {
  return (
    <ul style={S.ul}>
      {items.map((item, i) => (
        <li key={i} style={S.li}>{item}</li>
      ))}
    </ul>
  );
}

// ============================================
// STYLES
// ============================================
const S = {
  page: { minHeight: "100vh", background: "#050505", color: "#f5f5f5", fontFamily: "'DM Sans', sans-serif" },
  nav: {
    padding: "16px 32px", borderBottom: "1px solid #111",
  },
  navLogo: {
    fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 4,
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    textDecoration: "none",
  },
  container: { maxWidth: 700, margin: "0 auto", padding: "40px 24px 60px" },
  title: { fontFamily: "'Oswald', sans-serif", fontSize: 32, fontWeight: 700, letterSpacing: 3, marginBottom: 8 },
  updated: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", letterSpacing: 1, marginBottom: 40 },
  content: {},

  section: { marginBottom: 32 },
  sectionTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 600, letterSpacing: 2,
    color: "#d4a843", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #d4a8431a",
  },
  h4: { fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 600, letterSpacing: 1, color: "#ccc", margin: "16px 0 8px" },
  p: { fontSize: 14, color: "#aaa", lineHeight: 1.8, margin: "0 0 12px" },
  ul: { paddingLeft: 20, margin: "0 0 12px" },
  li: { fontSize: 14, color: "#aaa", lineHeight: 1.8, marginBottom: 6 },

  footer: {
    marginTop: 48, paddingTop: 24, borderTop: "1px solid #111",
    display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap",
  },
  footerLink: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", textDecoration: "none", letterSpacing: 1 },
  footerDot: { color: "#333" },
};
