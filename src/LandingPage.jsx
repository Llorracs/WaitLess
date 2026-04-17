/**
 * ============================================
 * WAITLESS — Landing Page
 * ============================================
 * 
 * FILE: src/LandingPage.jsx
 * 
 * Route: waitless.app/ (root, no slug)
 * 
 * Sells the product to venue owners.
 * Links to live demo and contact.
 * ============================================
 */

import { useState, useEffect, useRef } from "react";

export default function LandingPage() {
  const [visible, setVisible] = useState({});
  const sectionRefs = useRef([]);

  // Intersection observer for scroll-triggered animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible((prev) => ({ ...prev, [entry.target.dataset.section]: true }));
          }
        });
      },
      { threshold: 0.15 }
    );

    sectionRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, []);

  const addRef = (el, index) => {
    sectionRefs.current[index] = el;
  };

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />

      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
        @keyframes pulse { 0%, 100% { box-shadow: 0 0 20px #1E4D8C44; } 50% { box-shadow: 0 0 40px #1E4D8C66; } }
        .hover-lift { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .hover-lift:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
      `}</style>

      {/* ---- NAV ---- */}
      <nav style={S.nav}>
        <span style={S.navLogo}>WAITLESS</span>
        <div style={S.navLinks}>
          <a href="#how-it-works" style={S.navLink}>How It Works</a>
          <a href="#demo" style={S.navLink}>Live Demo</a>
          <a href="#contact" style={S.ctaSmall}>GET STARTED</a>
        </div>
      </nav>

      {/* ---- HERO ---- */}
      <section style={S.hero}>
        <div style={S.heroGlow} />
        <div style={{ ...S.heroContent, animation: "fadeUp 1s ease forwards" }}>
          <div style={S.heroBadge}>MOBILE ORDERING FOR VENUES</div>
          <h1 style={S.heroTitle}>
            Drop the weight.<br />
            <span style={S.heroAccent}>Lose the wait.</span>
          </h1>
          <p style={S.heroSub}>
            Your customers order and pay from their phone. Your bartenders see a live queue. No app download. No hardware. Just faster service and happier people.
          </p>
          <div style={S.heroCtas}>
            <a href="#contact" style={S.heroPrimary}>GET STARTED FREE</a>
            <a href="#demo" style={S.heroSecondary}>SEE LIVE DEMO →</a>
          </div>
        </div>

        {/* Floating phone mockup */}
        <div style={{ ...S.phoneMockup, animation: "float 4s ease-in-out infinite" }}>
          <div style={S.phoneScreen}>
            <div style={S.phoneHeader}>
              <span style={S.phoneVenue}>YOUR VENUE</span>
              <span style={S.phoneTag}>Mobile Bar</span>
            </div>
            <div style={S.phoneCategory}>COCKTAILS</div>
            {["Margarita", "Old Fashioned", "Moscow Mule"].map((drink, i) => (
              <div key={drink} style={{ ...S.phoneItem, animationDelay: `${1.2 + i * 0.2}s` }}>
                <span style={S.phoneItemName}>{drink}</span>
                <div style={S.phoneAdd}>+</div>
              </div>
            ))}
            <div style={S.phoneCart}>VIEW ORDER — $34.00</div>
          </div>
        </div>
      </section>

      {/* ---- STATS BAR ---- */}
      <section
        ref={(el) => addRef(el, 0)}
        data-section="stats"
        style={{ ...S.statsBar, opacity: visible.stats ? 1 : 0, transform: visible.stats ? "none" : "translateY(20px)", transition: "all 0.8s ease" }}
      >
        {[
          { value: "40%", label: "Less time walking to the bar" },
          { value: "2x", label: "Faster drink service" },
          { value: "0", label: "App downloads required" },
          { value: "5min", label: "Setup time per venue" },
        ].map((stat, i) => (
          <div key={stat.label} style={{ ...S.stat, animationDelay: `${i * 0.15}s` }}>
            <span style={S.statValue}>{stat.value}</span>
            <span style={S.statLabel}>{stat.label}</span>
          </div>
        ))}
      </section>

      {/* ---- HOW IT WORKS ---- */}
      <section
        id="how-it-works"
        ref={(el) => addRef(el, 1)}
        data-section="how"
        style={{ ...S.section, opacity: visible.how ? 1 : 0, transform: visible.how ? "none" : "translateY(30px)", transition: "all 0.8s ease" }}
      >
        <h2 style={S.sectionTitle}>How It Works</h2>
        <p style={S.sectionSub}>Three screens. Zero friction.</p>

        <div style={S.stepsGrid}>
          {[
            {
              num: "01",
              title: "Customer Scans & Orders",
              desc: "Patron opens your unique URL on their phone. No app download. They browse your menu, add to cart, and pay — all from their seat.",
              icon: "📱",
            },
            {
              num: "02",
              title: "Bartender Sees Live Queue",
              desc: "Orders appear instantly on the bartender's iPad. Color-coded priorities, wait timers, one-tap status updates. No shouting across the bar.",
              icon: "📋",
            },
            {
              num: "03",
              title: "Customer Picks Up",
              desc: "Customer gets a unique color + letter badge on their phone. When the drink is ready, their screen flashes green. Quick visual verify, hand off, done.",
              icon: "🍸",
            },
          ].map((step, i) => (
            <div key={step.num} className="hover-lift" style={{ ...S.stepCard, animationDelay: `${i * 0.2}s` }}>
              <div style={S.stepIcon}>{step.icon}</div>
              <div style={S.stepNum}>{step.num}</div>
              <h3 style={S.stepTitle}>{step.title}</h3>
              <p style={S.stepDesc}>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- USE CASES ---- */}
      <section
        ref={(el) => addRef(el, 2)}
        data-section="use"
        style={{ ...S.section, ...S.sectionDark, opacity: visible.use ? 1 : 0, transform: visible.use ? "none" : "translateY(30px)", transition: "all 0.8s ease" }}
      >
        <h2 style={S.sectionTitle}>Built For</h2>
        <p style={S.sectionSub}>Anywhere there's a line and people don't want to wait in it.</p>

        <div style={S.useCaseGrid}>
          {[
            { name: "Mobile Bars", icon: "🚐" },
            { name: "Rooftop Lounges", icon: "🌆" },
            { name: "Music Venues", icon: "🎵" },
            { name: "Hotel Pool Bars", icon: "🏨" },
            { name: "Food Trucks", icon: "🌮" },
            { name: "Wedding Receptions", icon: "💍" },
            { name: "Farmers Markets", icon: "🥬" },
            { name: "Cruise Ships", icon: "🚢" },
          ].map((uc) => (
            <div key={uc.name} className="hover-lift" style={S.useCaseCard}>
              <span style={S.useCaseIcon}>{uc.icon}</span>
              <span style={S.useCaseName}>{uc.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- FEATURES ---- */}
      <section
        ref={(el) => addRef(el, 3)}
        data-section="features"
        style={{ ...S.section, opacity: visible.features ? 1 : 0, transform: visible.features ? "none" : "translateY(30px)", transition: "all 0.8s ease" }}
      >
        <h2 style={S.sectionTitle}>Everything You Need</h2>
        <div style={S.featureGrid}>
          {[
            { title: "White-Label Branding", desc: "Your colors, your logo, your URL. Customers see your brand, not ours.", icon: "🎨" },
            { title: "Real-Time Queue", desc: "Orders stream live to the bartender's screen. No delay, no refresh, no missed orders.", icon: "⚡" },
            { title: "Anti-Screenshot Verification", desc: "Pulsing badges with live countdown timers. A screenshot is obviously stale.", icon: "🛡" },
            { title: "Square Payments", desc: "Integrated with Square. Payments go directly to your bank account.", icon: "💳" },
            { title: "Custom Service Fees", desc: "Set your own service fee percentage. You keep 100% of it.", icon: "💰" },
            { title: "Menu Management", desc: "Add, edit, hide, reorder items anytime from your admin dashboard.", icon: "📝" },
          ].map((f) => (
            <div key={f.title} className="hover-lift" style={S.featureCard}>
              <span style={{ fontSize: 28 }}>{f.icon}</span>
              <h4 style={S.featureTitle}>{f.title}</h4>
              <p style={S.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- LIVE DEMO ---- */}
      <section
        id="demo"
        ref={(el) => addRef(el, 4)}
        data-section="demo"
        style={{ ...S.section, ...S.sectionDark, opacity: visible.demo ? 1 : 0, transform: visible.demo ? "none" : "translateY(30px)", transition: "all 0.8s ease" }}
      >
        <h2 style={S.sectionTitle}>See It In Action</h2>
        <p style={S.sectionSub}>Try the live demo right now. No signup needed.</p>

        <div style={S.demoCards}>
          <a href="/demo" target="_blank" rel="noopener noreferrer" className="hover-lift" style={S.demoCard}>
            <span style={S.demoIcon}>📱</span>
            <span style={S.demoLabel}>PATRON VIEW</span>
            <span style={S.demoDesc}>Browse menu, add to cart, place order</span>
            <span style={S.demoLink}>Open Demo →</span>
          </a>
          <a href="/demo/bartender" target="_blank" rel="noopener noreferrer" className="hover-lift" style={S.demoCard}>
            <span style={S.demoIcon}>📋</span>
            <span style={S.demoLabel}>BARTENDER VIEW</span>
            <span style={S.demoDesc}>Live queue, status updates, verification</span>
            <span style={S.demoLink}>Open Demo → (PIN: 1234)</span>
          </a>
        </div>
      </section>

      {/* ---- PRICING ---- */}
      <section
        ref={(el) => addRef(el, 5)}
        data-section="pricing"
        style={{ ...S.section, opacity: visible.pricing ? 1 : 0, transform: visible.pricing ? "none" : "translateY(30px)", transition: "all 0.8s ease" }}
      >
        <h2 style={S.sectionTitle}>Simple Pricing</h2>
        <p style={S.sectionSub}>One plan. Everything included. No feature gates, no upsells.</p>

        <div style={S.pricingCards}>
          <div className="hover-lift" style={S.pricingCard}>
            <span style={S.pricingTier}>MONTHLY</span>
            <div style={S.pricingPrice}>
              <span style={S.pricingCurrency}>$</span>
              <span style={S.pricingAmount}>199</span>
              <span style={S.pricingPeriod}>/mo</span>
            </div>
            <span style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>14-day free trial included</span>
            <div style={S.pricingFeatures}>
              {[
                "Full mobile ordering system",
                "Real-time bartender queue",
                "White-label branding",
                "Menu management dashboard",
                "Revenue analytics",
                "Square payment integration",
                "QR codes & print posters",
                "Age verification",
                "Unlimited orders",
                "We never touch your revenue",
              ].map((f) => (
                <div key={f} style={S.pricingFeature}>
                  <span style={S.checkmark}>✓</span> {f}
                </div>
              ))}
            </div>
            <a href="#contact" style={{ ...S.pricingCta, background: "linear-gradient(135deg, #1E4D8C, #d4a843)" }}>START FREE TRIAL</a>
          </div>

          <div className="hover-lift" style={{ ...S.pricingCard, ...S.pricingFeatured }}>
            <div style={{ position: "absolute", top: -10, right: 16, padding: "4px 12px", borderRadius: 12, background: "linear-gradient(135deg, #1E4D8C, #d4a843)", fontFamily: "'Space Mono', monospace", fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: 1 }}>SAVE $589</div>
            <span style={{ ...S.pricingTier, color: "#1E4D8C" }}>ANNUAL</span>
            <div style={S.pricingPrice}>
              <span style={S.pricingCurrency}>$</span>
              <span style={S.pricingAmount}>1,799</span>
              <span style={S.pricingPeriod}>/yr</span>
            </div>
            <span style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>That's $150/mo — save 25%</span>
            <div style={S.pricingFeatures}>
              {[
                "Everything included",
                "25% discount",
                "Locked-in pricing",
                "Priority support",
              ].map((f) => (
                <div key={f} style={S.pricingFeature}>
                  <span style={S.checkmark}>✓</span> {f}
                </div>
              ))}
            </div>
            <a href="#contact" style={{ ...S.pricingCta, background: "linear-gradient(135deg, #1E4D8C, #d4a843)" }}>START FREE TRIAL</a>
          </div>
        </div>

        {/* ROI callout */}
        <div style={{ maxWidth: 600, margin: "32px auto 0", padding: "20px 24px", background: "#0a0a0a", borderRadius: 14, border: "1px solid #1a1a1a", textAlign: "center" }}>
          <p style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 600, letterSpacing: 2, color: "#d4a843", margin: "0 0 8px" }}>THE MATH</p>
          <p style={{ fontSize: 14, color: "#ccc", lineHeight: 1.8, margin: 0 }}>
            A venue serving 10 extra customers per event at $12 average = <strong style={{ color: "#1E4D8C" }}>$480+ in additional monthly revenue</strong>. Waitless pays for itself in a single busy weekend.
          </p>
        </div>
      </section>

      {/* ---- CONTACT / CTA ---- */}
      <section
        id="contact"
        ref={(el) => addRef(el, 6)}
        data-section="contact"
        style={{ ...S.section, ...S.sectionDark, opacity: visible.contact ? 1 : 0, transform: visible.contact ? "none" : "translateY(30px)", transition: "all 0.8s ease" }}
      >
        <h2 style={S.sectionTitle}>Ready to Go Waitless?</h2>
        <p style={S.sectionSub}>Get your venue set up in under 5 minutes.</p>

        <ContactForm />
      </section>

      {/* ---- FOOTER ---- */}
      <footer style={S.footer}>
        <span style={S.footerLogo}>WAITLESS</span>
        <span style={S.footerTag}>Weightless service, zero wait.</span>
        <span style={S.footerCopy}>© {new Date().getFullYear()} Waitless. All rights reserved.</span>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <a href="/privacy" style={{ fontSize: 11, color: "#444", textDecoration: "none", fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>Privacy Policy</a>
          <a href="/terms" style={{ fontSize: 11, color: "#444", textDecoration: "none", fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}

// ============================================
// CONTACT FORM
// ============================================
function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", venue: "", message: "" });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    // For now, construct a mailto link. Replace with real form handler later.
    const subject = encodeURIComponent(`Waitless Inquiry — ${form.venue || "New Venue"}`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\nVenue: ${form.venue}\n\n${form.message}`
    );
    window.location.href = `mailto:hello@waitless.app?subject=${subject}&body=${body}`;
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div style={S.contactCard}>
        <div style={{ fontSize: 36, textAlign: "center" }}>✉️</div>
        <p style={{ ...S.sectionSub, marginTop: 12 }}>Thanks! We'll be in touch soon.</p>
      </div>
    );
  }

  return (
    <div style={S.contactCard}>
      <div style={S.contactRow}>
        <input type="text" placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={S.contactInput} />
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={S.contactInput} />
      </div>
      <input type="text" placeholder="Venue name" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} style={S.contactInput} />
      <textarea placeholder="Tell us about your venue (optional)" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} style={{ ...S.contactInput, resize: "vertical" }} />
      <button onClick={handleSubmit} disabled={!form.name || !form.email} style={{ ...S.heroPrimary, width: "100%", opacity: !form.name || !form.email ? 0.5 : 1 }}>
        SEND INQUIRY
      </button>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const S = {
  page: {
    minHeight: "100vh", background: "#050505", color: "#f5f5f5",
    fontFamily: "'DM Sans', sans-serif", overflowX: "hidden",
  },

  // Nav
  nav: {
    position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "16px 32px", background: "rgba(5,5,5,0.85)", backdropFilter: "blur(16px)",
    borderBottom: "1px solid #ffffff08",
  },
  navLogo: {
    fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 4,
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  navLinks: { display: "flex", alignItems: "center", gap: 24 },
  navLink: { color: "#888", fontSize: 13, textDecoration: "none", fontWeight: 500, letterSpacing: 0.5 },
  ctaSmall: {
    padding: "8px 20px", borderRadius: 8, background: "#1E4D8C", color: "#fff",
    fontSize: 11, fontFamily: "'Oswald', sans-serif", fontWeight: 600, letterSpacing: 2,
    textDecoration: "none",
  },

  // Hero
  hero: {
    position: "relative", minHeight: "100vh",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "120px 48px 80px", maxWidth: 1200, margin: "0 auto", gap: 60,
    flexWrap: "wrap",
  },
  heroGlow: {
    position: "absolute", top: "20%", left: "10%", width: 400, height: 400,
    borderRadius: "50%", background: "radial-gradient(circle, #1E4D8C15, transparent 70%)",
    filter: "blur(60px)", pointerEvents: "none",
  },
  heroContent: { flex: 1, minWidth: 320, position: "relative", zIndex: 1 },
  heroBadge: {
    display: "inline-block", padding: "6px 16px", borderRadius: 20,
    background: "#1E4D8C15", border: "1px solid #1E4D8C33", color: "#1E4D8C",
    fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 3, marginBottom: 24,
  },
  heroTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 56, fontWeight: 700, letterSpacing: 2,
    lineHeight: 1.1, margin: "0 0 24px",
  },
  heroAccent: {
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  heroSub: { fontSize: 18, color: "#999", lineHeight: 1.7, maxWidth: 500, margin: "0 0 32px", fontWeight: 300 },
  heroCtas: { display: "flex", gap: 16, flexWrap: "wrap" },
  heroPrimary: {
    padding: "16px 32px", borderRadius: 12, border: "none",
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
    letterSpacing: 3, cursor: "pointer", textDecoration: "none", textAlign: "center",
    animation: "pulse 3s ease infinite",
  },
  heroSecondary: {
    padding: "16px 32px", borderRadius: 12, border: "1px solid #333",
    color: "#999", fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 500,
    letterSpacing: 3, cursor: "pointer", textDecoration: "none",
  },

  // Phone mockup
  phoneMockup: {
    width: 260, height: 480, borderRadius: 32, background: "#0a0a0a",
    border: "2px solid #222", overflow: "hidden", flexShrink: 0,
    boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px #1E4D8C11",
    position: "relative", zIndex: 1,
  },
  phoneScreen: { padding: "20px 16px", display: "flex", flexDirection: "column", gap: 10 },
  phoneHeader: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 12px" },
  phoneVenue: {
    fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 3,
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  phoneTag: { fontFamily: "'Space Mono', monospace", fontSize: 7, color: "#666", letterSpacing: 2 },
  phoneCategory: {
    fontFamily: "'Oswald', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 3,
    color: "#d4a843", borderBottom: "1px solid #d4a8431a", paddingBottom: 6,
  },
  phoneItem: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 12px", background: "#1a1a1a", borderRadius: 10, border: "1px solid #222",
  },
  phoneItemName: { fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 500, letterSpacing: 0.5 },
  phoneAdd: {
    width: 24, height: 24, borderRadius: "50%", border: "1px solid #666",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, color: "#666",
  },
  phoneCart: {
    marginTop: 8, padding: "12px", borderRadius: 10, background: "#1E4D8C",
    fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2,
    color: "#fff", textAlign: "center",
  },

  // Stats
  statsBar: {
    display: "flex", justifyContent: "center", gap: 48, padding: "48px 32px",
    borderTop: "1px solid #111", borderBottom: "1px solid #111",
    flexWrap: "wrap", maxWidth: 900, margin: "0 auto",
  },
  stat: { textAlign: "center", minWidth: 140 },
  statValue: { display: "block", fontFamily: "'Oswald', sans-serif", fontSize: 36, fontWeight: 700, color: "#1E4D8C" },
  statLabel: { fontSize: 12, color: "#888", letterSpacing: 0.5, marginTop: 4 },

  // Sections
  section: { padding: "80px 32px", maxWidth: 1100, margin: "0 auto" },
  sectionDark: { background: "#0a0a0a", maxWidth: "100%", padding: "80px 32px" },
  sectionTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 36, fontWeight: 700, letterSpacing: 3,
    textAlign: "center", margin: "0 0 8px",
  },
  sectionSub: { fontSize: 16, color: "#888", textAlign: "center", margin: "0 0 48px", fontWeight: 300 },

  // Steps
  stepsGrid: { display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" },
  stepCard: {
    flex: "1 1 280px", maxWidth: 340, padding: "32px 24px", background: "#0a0a0a",
    borderRadius: 16, border: "1px solid #1a1a1a", textAlign: "center",
  },
  stepIcon: { fontSize: 36, marginBottom: 12 },
  stepNum: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#1E4D8C", letterSpacing: 2, marginBottom: 12 },
  stepTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 600, letterSpacing: 1, margin: "0 0 8px" },
  stepDesc: { fontSize: 14, color: "#888", lineHeight: 1.7, margin: 0, fontWeight: 300 },

  // Use cases
  useCaseGrid: {
    display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", maxWidth: 700, margin: "0 auto",
  },
  useCaseCard: {
    padding: "16px 24px", borderRadius: 12, background: "#141414", border: "1px solid #222",
    display: "flex", alignItems: "center", gap: 10,
  },
  useCaseIcon: { fontSize: 20 },
  useCaseName: { fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, letterSpacing: 1 },

  // Features
  featureGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 },
  featureCard: {
    padding: "28px 24px", background: "#0a0a0a", borderRadius: 14, border: "1px solid #1a1a1a",
  },
  featureTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 600, letterSpacing: 1, margin: "12px 0 6px" },
  featureDesc: { fontSize: 13, color: "#888", lineHeight: 1.7, margin: 0, fontWeight: 300 },

  // Demo
  demoCards: { display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", maxWidth: 600, margin: "0 auto" },
  demoCard: {
    flex: "1 1 240px", padding: "32px 24px", background: "#141414", borderRadius: 16,
    border: "1px solid #222", textAlign: "center", textDecoration: "none", color: "#f5f5f5",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
  },
  demoIcon: { fontSize: 36 },
  demoLabel: { fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: 3 },
  demoDesc: { fontSize: 12, color: "#888", fontWeight: 300 },
  demoLink: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#1E4D8C", letterSpacing: 1, marginTop: 8 },

  // Pricing
  pricingCards: { display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", maxWidth: 700, margin: "0 auto" },
  pricingCard: {
    flex: "1 1 280px", maxWidth: 320, padding: "36px 28px", background: "#0a0a0a",
    borderRadius: 16, border: "1px solid #1a1a1a", display: "flex", flexDirection: "column", gap: 16,
  },
  pricingFeatured: { border: "1px solid #1E4D8C44", boxShadow: "0 0 30px #1E4D8C11" },
  pricingTier: { fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 3, color: "#d4a843" },
  pricingPrice: { display: "flex", alignItems: "baseline", gap: 2 },
  pricingCurrency: { fontFamily: "'Oswald', sans-serif", fontSize: 20, fontWeight: 300, color: "#888" },
  pricingAmount: { fontFamily: "'Oswald', sans-serif", fontSize: 48, fontWeight: 700 },
  pricingPeriod: { fontSize: 14, color: "#666" },
  pricingFeatures: { display: "flex", flexDirection: "column", gap: 10, flex: 1 },
  pricingFeature: { fontSize: 14, color: "#ccc", display: "flex", alignItems: "center", gap: 8, fontWeight: 300 },
  checkmark: { color: "#2ecc71", fontSize: 14 },
  pricingCta: {
    padding: "14px", borderRadius: 10, border: "1px solid #333", background: "transparent",
    color: "#f5f5f5", fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600,
    letterSpacing: 2, cursor: "pointer", textAlign: "center", textDecoration: "none",
  },

  // Contact
  contactCard: {
    maxWidth: 500, margin: "0 auto", padding: "28px 24px", background: "#141414",
    borderRadius: 16, border: "1px solid #222", display: "flex", flexDirection: "column", gap: 12,
  },
  contactRow: { display: "flex", gap: 12 },
  contactInput: {
    flex: 1, padding: "14px", background: "#0a0a0a", border: "1px solid #222", borderRadius: 10,
    color: "#f5f5f5", fontFamily: "'DM Sans', sans-serif", fontSize: 14, outline: "none", width: "100%",
  },

  // Footer
  footer: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
    padding: "48px 32px", borderTop: "1px solid #111",
  },
  footerLogo: {
    fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: 4,
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  footerTag: { fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#444", letterSpacing: 2 },
  footerCopy: { fontSize: 11, color: "#333", marginTop: 8 },
};
