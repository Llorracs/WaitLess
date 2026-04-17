/**
 * ============================================
 * WAITLESS — Billing & Subscription
 * ============================================
 * 
 * FILE: src/BillingView.jsx
 * 
 * Embedded in admin dashboard as a tab.
 * Shows subscription status, plan options,
 * and links to Stripe checkout/portal.
 * ============================================
 */

import { useState, useEffect } from "react";

export default function BillingView({ venue, BRAND }) {
  const [loading, setLoading] = useState(false);
  const [billingMessage, setBillingMessage] = useState(null);

  // Check for billing callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") {
      setBillingMessage({ type: "success", text: "Subscription activated! Welcome to Waitless." });
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("billing") === "cancelled") {
      setBillingMessage({ type: "info", text: "Checkout cancelled. No charges were made." });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const isSubscribed = venue.subscription_status === "active";
  const isTrial = venue.subscription_status === "trial";
  const isPastDue = venue.subscription_status === "past_due";
  const isCancelled = venue.subscription_status === "cancelled" || venue.subscription_status === "suspended";

  const trialDaysLeft = venue.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(venue.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24)))
    : 0;

  const handleCheckout = async (plan) => {
    setLoading(true);
    try {
      const response = await fetch("/.netlify/functions/stripe-billing/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId: venue.id,
          plan,
          successUrl: `${window.location.origin}/${venue.slug}/admin?billing=success`,
          cancelUrl: `${window.location.origin}/${venue.slug}/admin?billing=cancelled`,
        }),
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Failed to start checkout. Please try again.");
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setLoading(true);
    try {
      const response = await fetch("/.netlify/functions/stripe-billing/customer-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId: venue.id,
          returnUrl: `${window.location.origin}/${venue.slug}/admin`,
        }),
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Portal error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.container}>
      {/* Billing message */}
      {billingMessage && (
        <div style={{
          ...S.messageBanner,
          background: billingMessage.type === "success" ? "#2ecc7115" : "#d4a84315",
          borderColor: billingMessage.type === "success" ? "#2ecc7133" : "#d4a84333",
        }}>
          <span style={{
            fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 2,
            color: billingMessage.type === "success" ? "#2ecc71" : "#d4a843",
          }}>
            {billingMessage.type === "success" ? "✓" : "ℹ"} {billingMessage.text}
          </span>
        </div>
      )}

      {/* Current status */}
      <div style={S.statusCard}>
        <div style={S.statusTop}>
          <div>
            <span style={S.statusLabel}>SUBSCRIPTION STATUS</span>
            <span style={{
              ...S.statusValue,
              color: isSubscribed ? "#2ecc71" : isTrial ? "#d4a843" : isPastDue ? "#e74c3c" : "#666",
            }}>
              {isSubscribed ? "ACTIVE" : isTrial ? "FREE TRIAL" : isPastDue ? "PAST DUE" : isCancelled ? "CANCELLED" : venue.subscription_status?.toUpperCase()}
            </span>
          </div>
          <div style={{
            ...S.statusIcon,
            background: isSubscribed ? "#2ecc7122" : isTrial ? "#d4a84322" : "#e74c3c22",
          }}>
            {isSubscribed ? "✓" : isTrial ? "⏳" : isPastDue ? "!" : "✗"}
          </div>
        </div>

        {isTrial && (
          <div style={S.trialInfo}>
            <div style={S.trialBar}>
              <div style={{ ...S.trialProgress, width: `${Math.max(5, ((14 - trialDaysLeft) / 14) * 100)}%` }} />
            </div>
            <span style={S.trialText}>
              {trialDaysLeft > 0
                ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""} remaining in free trial`
                : "Trial expired — subscribe to continue"}
            </span>
          </div>
        )}

        {isPastDue && (
          <div style={{ ...S.warningBox }}>
            <span style={S.warningText}>⚠ Your payment failed. Update your payment method to avoid service interruption.</span>
          </div>
        )}

        {isSubscribed && venue.subscription_id && (
          <button onClick={handleManageSubscription} disabled={loading} style={S.manageBtn}>
            {loading ? "LOADING..." : "MANAGE SUBSCRIPTION"}
          </button>
        )}
      </div>

      {/* Plan selection — show when not subscribed */}
      {!isSubscribed && (
        <>
          <h3 style={S.sectionTitle}>Choose Your Plan</h3>
          <p style={S.sectionSub}>Start with a 14-day free trial. Cancel anytime.</p>

          <div style={S.planGrid}>
            {/* Monthly */}
            <div style={S.planCard}>
              <span style={S.planLabel}>MONTHLY</span>
              <div style={S.planPrice}>
                <span style={S.planCurrency}>$</span>
                <span style={S.planAmount}>199</span>
                <span style={S.planPeriod}>/mo</span>
              </div>
              <div style={S.planFeatures}>
                {[
                  "Full ordering system",
                  "Bartender queue",
                  "Custom branding",
                  "Menu management",
                  "Analytics dashboard",
                  "Square integration",
                  "QR code & posters",
                  "Age verification",
                  "Unlimited orders",
                ].map((f) => (
                  <div key={f} style={S.planFeature}>
                    <span style={S.check}>✓</span> {f}
                  </div>
                ))}
              </div>
              <button onClick={() => handleCheckout("monthly")} disabled={loading} style={S.planBtn}>
                {loading ? "LOADING..." : "START FREE TRIAL"}
              </button>
              <span style={S.planNote}>14 days free, then $199/mo</span>
            </div>

            {/* Annual */}
            <div style={{ ...S.planCard, ...S.planFeatured }}>
              <div style={S.saveBadge}>SAVE $589</div>
              <span style={{ ...S.planLabel, color: "#1E4D8C" }}>ANNUAL</span>
              <div style={S.planPrice}>
                <span style={S.planCurrency}>$</span>
                <span style={S.planAmount}>1,799</span>
                <span style={S.planPeriod}>/yr</span>
              </div>
              <div style={S.planPriceBreakdown}>
                That's <strong>$150/mo</strong> — save 25%
              </div>
              <div style={S.planFeatures}>
                {[
                  "Everything in Monthly",
                  "25% discount",
                  "Locked-in pricing",
                  "Priority support",
                ].map((f) => (
                  <div key={f} style={S.planFeature}>
                    <span style={S.check}>✓</span> {f}
                  </div>
                ))}
              </div>
              <button onClick={() => handleCheckout("annual")} disabled={loading} style={{ ...S.planBtn, background: "linear-gradient(135deg, #1E4D8C, #d4a843)" }}>
                {loading ? "LOADING..." : "START FREE TRIAL"}
              </button>
              <span style={S.planNote}>14 days free, then $1,799/yr</span>
            </div>
          </div>

          {/* Value proposition */}
          <div style={S.valueBox}>
            <h4 style={S.valueTitle}>Why Waitless pays for itself</h4>
            <div style={S.valueGrid}>
              <div style={S.valueItem}>
                <span style={S.valueNum}>30-40%</span>
                <span style={S.valueDesc}>more customers served by eliminating line wait times</span>
              </div>
              <div style={S.valueItem}>
                <span style={S.valueNum}>$2,400+</span>
                <span style={S.valueDesc}>in additional weekend revenue for a typical high-volume venue</span>
              </div>
              <div style={S.valueItem}>
                <span style={S.valueNum}>3 sec</span>
                <span style={S.valueDesc}>drink handoff with visual badge verification</span>
              </div>
              <div style={S.valueItem}>
                <span style={S.valueNum}>0</span>
                <span style={S.valueDesc}>app downloads required for your customers</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* FAQ */}
      <div style={S.faqSection}>
        <h4 style={S.faqTitle}>Common Questions</h4>
        {[
          { q: "Can I cancel anytime?", a: "Yes. Cancel through your subscription portal anytime. No cancellation fees." },
          { q: "What happens when my trial ends?", a: "Your card is charged automatically. If you cancel before the trial ends, you pay nothing." },
          { q: "Do you take a cut of my sales?", a: "No. We never touch your revenue. Square payments go directly to your bank account. You keep 100% of your sales and tips." },
          { q: "What if I need help getting set up?", a: "We'll walk you through everything. Setup takes about 5 minutes." },
        ].map((faq) => (
          <div key={faq.q} style={S.faqItem}>
            <span style={S.faqQ}>{faq.q}</span>
            <span style={S.faqA}>{faq.a}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const S = {
  container: { display: "flex", flexDirection: "column", gap: 20 },

  messageBanner: {
    padding: "14px 16px", borderRadius: 10, border: "1px solid",
  },

  // Status
  statusCard: {
    padding: "24px", background: "#141414", borderRadius: 14, border: "1px solid #222",
    display: "flex", flexDirection: "column", gap: 16,
  },
  statusTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  statusLabel: { display: "block", fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#888", letterSpacing: 2, marginBottom: 6 },
  statusValue: { display: "block", fontFamily: "'Oswald', sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: 3 },
  statusIcon: {
    width: 48, height: 48, borderRadius: 12, display: "flex", alignItems: "center",
    justifyContent: "center", fontSize: 22,
  },

  trialInfo: { display: "flex", flexDirection: "column", gap: 8 },
  trialBar: { width: "100%", height: 6, borderRadius: 3, background: "#222", overflow: "hidden" },
  trialProgress: { height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #d4a843, #1E4D8C)", transition: "width 0.5s ease" },
  trialText: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#d4a843", letterSpacing: 1 },

  warningBox: { padding: "12px", background: "#e74c3c15", borderRadius: 8, border: "1px solid #e74c3c33" },
  warningText: { fontSize: 13, color: "#e74c3c", lineHeight: 1.5 },

  manageBtn: {
    padding: "12px", borderRadius: 10, border: "1px solid #333", background: "transparent",
    color: "#888", fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600,
    letterSpacing: 2, cursor: "pointer", alignSelf: "flex-start",
  },

  // Section
  sectionTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 3, margin: 0, textAlign: "center" },
  sectionSub: { fontSize: 14, color: "#888", textAlign: "center", margin: "4px 0 16px" },

  // Plans
  planGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 },
  planCard: {
    padding: "28px 24px", background: "#0a0a0a", borderRadius: 16, border: "1px solid #1a1a1a",
    display: "flex", flexDirection: "column", gap: 12, position: "relative",
  },
  planFeatured: { border: "1px solid #1E4D8C44", boxShadow: "0 0 30px #1E4D8C11" },
  saveBadge: {
    position: "absolute", top: -10, right: 16, padding: "4px 12px", borderRadius: 12,
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)",
    fontFamily: "'Space Mono', monospace", fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: 1,
  },
  planLabel: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#d4a843", letterSpacing: 3 },
  planPrice: { display: "flex", alignItems: "baseline", gap: 2 },
  planCurrency: { fontFamily: "'Oswald', sans-serif", fontSize: 20, fontWeight: 300, color: "#888" },
  planAmount: { fontFamily: "'Oswald', sans-serif", fontSize: 48, fontWeight: 700 },
  planPeriod: { fontSize: 16, color: "#666" },
  planPriceBreakdown: { fontSize: 13, color: "#888", marginTop: -4 },
  planFeatures: { display: "flex", flexDirection: "column", gap: 8, flex: 1, padding: "8px 0" },
  planFeature: { fontSize: 13, color: "#ccc", display: "flex", alignItems: "center", gap: 8 },
  check: { color: "#2ecc71", fontSize: 13 },
  planBtn: {
    padding: "16px", borderRadius: 12, border: "none", background: "#222",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
    letterSpacing: 3, cursor: "pointer", textAlign: "center",
  },
  planNote: { fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#666", textAlign: "center", letterSpacing: 1 },

  // Value prop
  valueBox: {
    padding: "24px", background: "#141414", borderRadius: 14, border: "1px solid #222", marginTop: 8,
  },
  valueTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 600, letterSpacing: 2, margin: "0 0 16px", textAlign: "center", color: "#d4a843" },
  valueGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 16 },
  valueItem: { display: "flex", flexDirection: "column", gap: 4, textAlign: "center" },
  valueNum: { fontFamily: "'Oswald', sans-serif", fontSize: 28, fontWeight: 700, color: "#1E4D8C" },
  valueDesc: { fontSize: 11, color: "#888", lineHeight: 1.5 },

  // FAQ
  faqSection: { marginTop: 8 },
  faqTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: 3,
    color: "#d4a843", textTransform: "uppercase", marginBottom: 12, paddingBottom: 8,
    borderBottom: "1px solid #d4a8431a",
  },
  faqItem: {
    padding: "14px 0", borderBottom: "1px solid #1a1a1a",
    display: "flex", flexDirection: "column", gap: 4,
  },
  faqQ: { fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: 0.5 },
  faqA: { fontSize: 13, color: "#888", lineHeight: 1.6 },
};
