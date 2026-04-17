/**
 * ============================================
 * WAITLESS — Dynamic Venue App
 * ============================================
 * 
 * FILE: src/App.jsx
 * 
 * Multi-tenant app with the original TRFQ styling.
 * URL structure:
 *   waitless.app/{slug}            → Patron ordering view
 *   waitless.app/{slug}/bartender  → Bartender queue view
 * 
 * On load:
 * 1. Parses venue slug from URL
 * 2. Fetches venue config from Supabase (branding, Square config, menu)
 * 3. Renders with that venue's theme
 * ============================================
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getVenueBySlug,
  getVenueMenu,
  getMenuItemModifiers,
  verifyBartenderPin,
  generateUniqueConfirmation,
  createBarOrder,
  subscribeToOrder,
  subscribeToBartenderQueue,
  startMakingOrder,
  markOrderReady,
  markOrderPickedUp,
  supabase,
} from "./lib/barOrderService";
import AgeVerification, { isAgeVerified } from "./AgeVerification";
import LandingPage from "./LandingPage";
import QRGenerator from "./QRGenerator";
import AdminView from "./AdminView";
import OnboardingView from "./OnboardingView";
import MasterAdmin from "./MasterAdmin";
import InstallPrompt from "./InstallPrompt";
import { PrivacyPolicy, TermsOfService } from "./LegalPages";

// ============================================
// URL PARSING
// ============================================
function getRouteFromUrl() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  const slug = parts[0] || null;
  const isBartender = parts[1] === "bartender";
  const isQR = parts[1] === "qr";
  const isAdmin = parts[1] === "admin";
  const isSignup = parts[0] === "admin" && parts[1] === "signup";
  const isMasterAdmin = parts[0] === "admin" && parts[1] === "master";
  const isOAuthComplete = parts[0] === "oauth-complete";
  const isPrivacy = parts[0] === "privacy";
  const isTerms = parts[0] === "terms";
  return { slug, isBartender, isQR, isAdmin, isSignup, isMasterAdmin, isOAuthComplete, isPrivacy, isTerms };
}

// ============================================
// DEFAULT BRAND (used as fallback)
// ============================================
const DEFAULT_BRAND = {
  primary: "#e91e8c",
  accent: "#d4a843",
  background: "#0a0a0a",
};

function getBrand(venue) {
  const colors = venue?.brand_colors || DEFAULT_BRAND;
  return {
    black: colors.background || "#0a0a0a",
    darkGray: "#141414",
    cardBg: "#1a1a1a",
    primary: colors.primary || "#e91e8c",
    primaryGlow: (colors.primary || "#e91e8c") + "40",
    accent: colors.accent || "#d4a843",
    accentMuted: (colors.accent || "#d4a843") + "4d",
    white: "#f5f5f5",
    gray: "#888",
    dimText: "#666",
    success: "#2ecc71",
    warning: "#f39c12",
    danger: "#e74c3c",
  };
}

// ============================================
// SHARED COMPONENTS
// ============================================

function ConfirmationBadge({ letter, color, timestamp, drinkReady, size = 180 }) {
  const [pulse, setPulse] = useState(true);
  const PICKUP_WINDOW = 600;
  const [remaining, setRemaining] = useState(PICKUP_WINDOW);

  useEffect(() => {
    const speed = drinkReady ? 600 : 1200;
    const i = setInterval(() => setPulse((p) => !p), speed);
    return () => clearInterval(i);
  }, [drinkReady]);

  useEffect(() => {
    if (drinkReady) return;
    const i = setInterval(() => {
      const elapsed = Math.floor((Date.now() - timestamp) / 1000);
      setRemaining(Math.max(0, PICKUP_WINDOW - elapsed));
    }, 1000);
    return () => clearInterval(i);
  }, [timestamp, drinkReady]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isUrgent = remaining <= 120;
  const isExpired = remaining === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.13,
          background: `radial-gradient(circle, ${color.hex}22, #141414)`,
          border: `3px solid ${color.hex}`,
          boxShadow: pulse
            ? `0 0 40px ${color.hex}88, 0 0 80px ${color.hex}44, inset 0 0 30px ${color.hex}22`
            : `0 0 15px ${color.hex}44, inset 0 0 10px ${color.hex}11`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "box-shadow 0.6s ease",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 6,
            borderRadius: size * 0.1,
            border: `1px solid ${color.hex}`,
            opacity: pulse ? 0.6 : 0.15,
            transition: "opacity 0.6s ease",
          }}
        />
        <span
          style={{
            fontSize: size * 0.5,
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 700,
            color: color.hex,
            textShadow: `0 0 20px ${color.hex}88`,
            lineHeight: 1,
          }}
        >
          {letter}
        </span>
      </div>
      <div
        style={{
          fontSize: 14,
          fontFamily: "'Space Mono', monospace",
          color: color.hex,
          textTransform: "uppercase",
          letterSpacing: 3,
        }}
      >
        {color.name}
      </div>
      <div
        style={{
          fontSize: 11,
          fontFamily: "'Space Mono', monospace",
          color: drinkReady ? "#2ecc71" : isExpired ? "#e74c3c" : isUrgent ? "#d4a843" : "#666",
          letterSpacing: 1,
        }}
      >
        {drinkReady
          ? "READY TO PICKUP"
          : isExpired
            ? "PICKUP WINDOW EXPIRED"
            : `PICKUP IN ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`}
      </div>
    </div>
  );
}

function WaitTimer({ since }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setSecs(Math.floor((Date.now() - new Date(since).getTime()) / 1000)), 1000);
    return () => clearInterval(i);
  }, [since]);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const isLong = m >= 5;
  return (
    <span
      style={{
        fontFamily: "'Space Mono', monospace",
        fontSize: 13,
        color: isLong ? "#e74c3c" : m >= 3 ? "#f39c12" : "#666",
        fontWeight: isLong ? 700 : 400,
      }}
    >
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}

// ============================================
// MAIN APP
// ============================================
export default function App() {
  const [venue, setVenue] = useState(null);
  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ageVerified, setAgeVerifiedState] = useState(false);
  const [demoView, setDemoView] = useState("patron");
  const { slug, isBartender, isQR, isAdmin, isSignup, isMasterAdmin, isOAuthComplete, isPrivacy, isTerms } = getRouteFromUrl();

  // Set demo view based on URL on mount
  useEffect(() => {
    if (isBartender) setDemoView("bartender");
  }, []);

  // OAuth redirect handler
  useEffect(() => {
    if (!isOAuthComplete) return;
    const urlParams = new URLSearchParams(window.location.search);
    const venueId = urlParams.get("venue_id");
    const squareStatus = urlParams.get("square");
    const oauthError = urlParams.get("error");

    async function redirectToAdmin() {
      if (venueId) {
        const { data } = await supabase
          .from("venues")
          .select("slug")
          .eq("id", venueId)
          .single();
        if (data?.slug) {
          const params = squareStatus ? `?square=${squareStatus}` : oauthError ? `?error=${oauthError}` : "";
          window.location.href = `/${data.slug}/admin${params}`;
          return;
        }
      }
      window.location.href = "/";
    }
    redirectToAdmin();
  }, [isOAuthComplete]);

  // Legal pages — no venue needed
  if (isPrivacy) return <PrivacyPolicy />;
  if (isTerms) return <TermsOfService />;

  // Signup page — no venue needed
  if (isSignup) {
    return <OnboardingView BRAND={getBrand(null)} />;
  }

  // Master admin — platform owner panel
  if (isMasterAdmin) {
    return <MasterAdmin />;
  }

  // OAuth complete — show loading while redirect happens
  if (isOAuthComplete) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f5" }}>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", letterSpacing: 2 }}>CONNECTING SQUARE...</p>
      </div>
    );
  }

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }

    async function loadVenue() {
      try {
        const venueData = await getVenueBySlug(slug);
        setVenue(venueData);

        const menuData = await getVenueMenu(venueData.id);
        setMenu(menuData);

        // Check if already verified in this session
        if (isAgeVerified(venueData.id)) {
          setAgeVerifiedState(true);
        }
      } catch (err) {
        console.error("Failed to load venue:", err);
        setError(`Venue "${slug}" not found. Check the URL and try again.`);
      } finally {
        setLoading(false);
      }
    }

    loadVenue();
  }, [slug]);

  const BRAND = getBrand(venue);

  // No slug = landing page
  if (!slug && !loading) {
    return <LandingPage />;
  }

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f5" }}>
        <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <div style={{ width: 50, height: 50, borderRadius: "50%", border: "3px solid #222", borderTopColor: "#1E4D8C", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", marginTop: 16, letterSpacing: 2 }}>LOADING VENUE...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f5", padding: 24, textAlign: "center" }}>
        <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: 4, marginBottom: 16, background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>WAITLESS</h1>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#888", maxWidth: 400 }}>{error}</p>
      </div>
    );
  }

  // Age verification gate (patron view only — not bartender, QR, or admin)
  const needsAgeVerification = !isBartender && !isQR && !isAdmin && venue?.require_age_verification && !ageVerified;

  const isDemo = slug === "demo";

  return (
    <div style={{ minHeight: "100vh", background: BRAND.black, color: BRAND.white, fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />

      {/* Demo view switcher bar */}
      {isDemo && !isAdmin && !isQR && (
        <div style={{
          position: "sticky", top: 0, zIndex: 200,
          background: "#1E4D8C15", borderBottom: "1px solid #1E4D8C33",
          padding: "8px 20px", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#D4A843" }} />
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#D4A843", letterSpacing: 2 }}>WAITLESS DEMO</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setDemoView("patron")}
              style={{
                padding: "5px 14px", borderRadius: 14, cursor: "pointer",
                fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 1,
                border: demoView === "patron" ? "1px solid #D4A843" : "1px solid #333",
                background: demoView === "patron" ? "#D4A84322" : "transparent",
                color: demoView === "patron" ? "#D4A843" : "#666",
              }}
            >
              PATRON VIEW
            </button>
            <button
              onClick={() => setDemoView("bartender")}
              style={{
                padding: "5px 14px", borderRadius: 14, cursor: "pointer",
                fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 1,
                border: demoView === "bartender" ? "1px solid #1E4D8C" : "1px solid #333",
                background: demoView === "bartender" ? "#1E4D8C22" : "transparent",
                color: demoView === "bartender" ? "#1E4D8C" : "#666",
              }}
            >
              BARTENDER VIEW
            </button>
          </div>
        </div>
      )}

      {needsAgeVerification && (
        <AgeVerification venue={venue} BRAND={BRAND} onVerified={() => setAgeVerifiedState(true)} />
      )}
      {isAdmin ? (
        <AdminView venue={venue} BRAND={BRAND} />
      ) : isQR ? (
        <QRGenerator venue={venue} BRAND={BRAND} />
      ) : (isDemo ? demoView === "bartender" : isBartender) ? (
        <BartenderView venue={venue} BRAND={BRAND} />
      ) : (
        <PatronView venue={venue} menu={menu} BRAND={BRAND} />
      )}
    </div>
  );
}

// ============================================
// PATRON VIEW
// ============================================

function PatronView({ venue, menu, BRAND }) {
  const [cart, setCart] = useState([]);
  const [view, setView] = useState("menu"); // menu | cart | payment | processing | confirmation
  const [processingStep, setProcessingStep] = useState("");
  const [activeOrders, setActiveOrders] = useState([]); // All active orders for this patron
  const [activeOrderIndex, setActiveOrderIndex] = useState(0); // Which badge is showing
  const [tipPercent, setTipPercent] = useState(0); // 0, 15, 18, 20, or custom
  const [customTip, setCustomTip] = useState("");
  const [showCustomTip, setShowCustomTip] = useState(false);
  const [patronPhone, setPatronPhone] = useState(""); // For SMS notifications
  const [notifyMethod, setNotifyMethod] = useState("both"); // sms | push | both | none
  const [specialInstructions, setSpecialInstructions] = useState(""); // Order-level notes

  // Modifier modal state
  const [modifierModal, setModifierModal] = useState(null); // { item, modifiers, selectedMods, notes }
  const [loadingModifiers, setLoadingModifiers] = useState(false);

  // Request push notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      // We'll ask when they place their first order, not on page load
    }
  }, []);

  // Group menu items by category
  const menuByCategory = menu.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
  const categories = Object.keys(menuByCategory);

  // Current displayed order
  const currentOrder = activeOrders[activeOrderIndex];
  const anyReady = activeOrders.some((o) => o.status === "ready");

  // Handle adding an item — check for modifiers first
  const handleAddItem = async (item) => {
    setLoadingModifiers(true);
    try {
      const modifiers = await getMenuItemModifiers(item.id);
      if (modifiers && modifiers.length > 0) {
        // Item has modifiers — show the modal
        const selectedMods = {};
        modifiers.forEach((group) => {
          const defaultOpt = group.options.find((o) => o.is_default);
          if (defaultOpt) {
            selectedMods[group.id] = group.max_selections > 1 ? [defaultOpt.id] : defaultOpt.id;
          } else {
            selectedMods[group.id] = group.max_selections > 1 ? [] : null;
          }
        });
        setModifierModal({ item, modifiers, selectedMods, notes: "" });
      } else {
        // No modifiers — add directly
        addToCart(item, [], "");
      }
    } catch (err) {
      // If modifier fetch fails, just add the item plain
      addToCart(item, [], "");
    } finally {
      setLoadingModifiers(false);
    }
  };

  // Confirm modifier selections and add to cart
  const confirmModifierSelection = () => {
    if (!modifierModal) return;
    const { item, modifiers, selectedMods, notes } = modifierModal;

    // Build selected modifier labels and extra cost
    const selectedModifiers = [];
    let extraCents = 0;

    modifiers.forEach((group) => {
      const sel = selectedMods[group.id];
      if (!sel) return;
      const ids = Array.isArray(sel) ? sel : [sel];
      ids.forEach((optId) => {
        const opt = group.options.find((o) => o.id === optId);
        if (opt) {
          selectedModifiers.push({ group: group.group_name, option: opt.option_name, priceCents: opt.price_cents });
          extraCents += opt.price_cents || 0;
        }
      });
    });

    addToCart(item, selectedModifiers, notes, extraCents);
    setModifierModal(null);
  };

  const addToCart = (item, modifiers = [], itemNotes = "", extraCents = 0) => {
    // Create a unique key based on item + modifiers combo
    const modKey = modifiers.map((m) => `${m.group}:${m.option}`).sort().join("|");
    const cartKey = `${item.id}_${modKey}_${itemNotes}`;

    setCart((prev) => {
      const ex = prev.find((c) => c.cartKey === cartKey);
      if (ex) return prev.map((c) => (c.cartKey === cartKey ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { ...item, qty: 1, cartKey, modifiers, itemNotes, extraCents }];
    });
  };

  const removeFromCart = (cartKey) => {
    setCart((prev) => {
      const ex = prev.find((c) => c.cartKey === cartKey);
      if (ex && ex.qty > 1) return prev.map((c) => (c.cartKey === cartKey ? { ...c, qty: c.qty - 1 } : c));
      return prev.filter((c) => c.cartKey !== cartKey);
    });
  };

  const subtotalCents = cart.reduce((s, i) => s + (i.price_cents + (i.extraCents || 0)) * i.qty, 0);
  const feeCents = Math.round(subtotalCents * (venue.service_fee_percent / 100));
  const tipCents = showCustomTip
    ? Math.round((parseFloat(customTip) || 0) * 100)
    : Math.round(subtotalCents * (tipPercent / 100));
  const totalCents = subtotalCents + feeCents + tipCents;
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  // Subscribe to all active orders
  useEffect(() => {
    if (activeOrders.length === 0) return;

    const unsubscribers = activeOrders.map((ord) =>
      subscribeToOrder(ord.id, (newStatus, updatedOrder) => {
        setActiveOrders((prev) =>
          prev.map((o) => (o.id === ord.id ? { ...o, status: newStatus } : o))
        );

        // Fire push notification when drink is ready
        if (newStatus === "ready") {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(`${venue.name} — Your drink is ready!`, {
              body: `Show your ${ord.confirm_color} ${ord.confirm_letter} badge at the bar.`,
              icon: venue.logo_url || undefined,
              tag: `order-${ord.id}`,
            });
          }
        }
      })
    );

    return () => unsubscribers.forEach((unsub) => unsub());
  }, [activeOrders.length]);

  // Demo mode: no Square credentials → skip payment entirely
  const isDemoMode = !venue.square_app_id || !venue.square_location_id;

  const handleCheckout = async () => {
    setView("processing");

    try {
      if (isDemoMode) {
        // Demo flow — simulate payment steps, skip Square
        setProcessingStep("Securing payment...");
        await new Promise((r) => setTimeout(r, 800));
        setProcessingStep("Processing payment...");
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        // Real flow — tokenize and charge via Square
        setProcessingStep("Securing payment...");

        const cardResult = await window.__waitlessCard?.tokenize();
        if (!cardResult || cardResult.status !== "OK") {
          throw new Error(cardResult?.errors?.[0]?.message || "Card tokenization failed");
        }

        setProcessingStep("Processing with Square...");

        const response = await fetch("/.netlify/functions/process-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId: venue.id,
            sourceId: cardResult.token,
            amountCents: totalCents,
            items: cart.map((i) => ({ name: i.item_name, qty: i.qty, price: i.price_cents / 100 })),
            idempotencyKey: crypto.randomUUID(),
          }),
        });

        const data = await response.json();
        if (!data.success) throw new Error(data.error || "Payment failed");
      }

      setProcessingStep("Confirming order...");

      // Generate confirmation and create order (same for both modes)
      const { letter, color } = await generateUniqueConfirmation(venue.id);
      const newOrder = await createBarOrder({
        venueId: venue.id,
        letter,
        color,
        items: cart.map((i) => ({
          id: i.id,
          name: i.item_name,
          qty: i.qty,
          price: (i.price_cents + (i.extraCents || 0)) / 100,
          modifiers: i.modifiers || [],
          notes: i.itemNotes || "",
        })),
        subtotalCents,
        feeCents: feeCents + tipCents,
        totalCents,
        squarePaymentId: isDemoMode ? "DEMO" : data.paymentId,
        squareOrderId: isDemoMode ? "DEMO" : data.orderId,
        patronPhone: patronPhone || null,
        specialInstructions: specialInstructions || null,
      });

      // Request push notification permission after first order
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }

      setActiveOrders((prev) => [...prev, newOrder]);
      setActiveOrderIndex((prev) => prev === 0 && activeOrders.length === 0 ? 0 : activeOrders.length);
      setCart([]);
      setTipPercent(0);
      setCustomTip("");
      setShowCustomTip(false);
      setView("confirmation");
    } catch (err) {
      console.error("Payment/order error:", err);
      setProcessingStep("");
      setView("cart");
      alert(err.message || "Payment failed. Please try again.");
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 90, background: `linear-gradient(180deg, ${BRAND.black} 80%, transparent)`, padding: "12px 20px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {venue.logo_url && <img src={venue.logo_url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", marginBottom: 4 }} />}
            <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: 4, margin: 0, background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {venue.name.toUpperCase()}
            </h1>
            {venue.tagline && (
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 3, color: BRAND.dimText, margin: "2px 0 0", textTransform: "uppercase" }}>{venue.tagline}</p>
            )}
          </div>
          {view === "menu" && cartCount > 0 && (
            <button onClick={() => setView("cart")} style={{ background: BRAND.primary, border: "none", borderRadius: 20, padding: "10px 20px", color: BRAND.white, fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: `0 0 20px ${BRAND.primaryGlow}` }}>
              <span style={{ background: BRAND.white, color: BRAND.primary, width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{cartCount}</span>
              VIEW ORDER
            </button>
          )}
          {view === "menu" && cartCount === 0 && activeOrders.length > 0 && (
            <button onClick={() => setView("confirmation")} style={{ background: "transparent", border: `1.5px solid ${anyReady ? BRAND.success : BRAND.primary}`, borderRadius: 20, padding: "10px 20px", color: anyReady ? BRAND.success : BRAND.primary, fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, animation: anyReady ? "readyPulse 1s ease infinite alternate" : "none" }}>
              {anyReady ? "DRINK READY" : `${activeOrders.length} ACTIVE`}
            </button>
          )}
          <style>{`@keyframes readyPulse { from { box-shadow: 0 0 0px transparent; } to { box-shadow: 0 0 16px ${BRAND.success}66; } }`}</style>
          {(view === "cart" || view === "payment") && (
            <button onClick={() => setView(view === "payment" ? "cart" : "menu")} style={{ background: "transparent", border: `1px solid ${BRAND.dimText}`, borderRadius: 20, padding: "10px 20px", color: BRAND.gray, fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 500, letterSpacing: 2, cursor: "pointer" }}>
              ← BACK
            </button>
          )}
        </div>
      </div>

      {/* MENU */}
      {view === "menu" && (
        <div style={{ padding: "0 20px 100px" }}>
          {categories.map((catName) => (
            <div key={catName} style={{ marginBottom: 32 }}>
              <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase", marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${BRAND.accentMuted}` }}>
                {catName}
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {menuByCategory[catName].map((item) => {
                  const inCart = cart.filter((c) => c.id === item.id);
                  const totalInCart = inCart.reduce((s, c) => s + c.qty, 0);
                  return (
                    <div key={item.id} style={{ background: BRAND.cardBg, borderRadius: 14, padding: "14px 16px", border: totalInCart > 0 ? `1px solid ${BRAND.primary}44` : "1px solid #222", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 500, letterSpacing: 1, marginBottom: 3 }}>{item.item_name}</div>
                        {item.description && <div style={{ fontSize: 12, color: BRAND.gray, fontWeight: 300 }}>{item.description}</div>}
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 14, color: BRAND.accent, marginTop: 4 }}>${(item.price_cents / 100).toFixed(2)}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {totalInCart > 0 && (
                          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 14, width: 20, textAlign: "center", color: BRAND.primary }}>{totalInCart}</span>
                        )}
                        <button onClick={() => handleAddItem(item)} style={{ width: 32, height: 32, borderRadius: "50%", border: totalInCart > 0 ? `1px solid ${BRAND.primary}` : `1px solid ${BRAND.dimText}`, background: totalInCart > 0 ? BRAND.primary : "transparent", color: totalInCart > 0 ? BRAND.white : BRAND.gray, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease" }}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODIFIER MODAL */}
      {modifierModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 0 }}>
          <div style={{ background: BRAND.darkGray, borderRadius: "20px 20px 0 0", padding: "24px 20px 32px", maxWidth: 480, width: "100%", maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{modifierModal.item.item_name}</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: BRAND.accent, marginTop: 2 }}>${(modifierModal.item.price_cents / 100).toFixed(2)}</div>
              </div>
              <button onClick={() => setModifierModal(null)} style={{ background: "transparent", border: "none", color: BRAND.gray, fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>

            {modifierModal.modifiers.map((group) => (
              <div key={group.id} style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 2, color: BRAND.accent, textTransform: "uppercase", marginBottom: 8 }}>
                  {group.group_name}
                  {group.required && <span style={{ color: BRAND.primary, marginLeft: 6, fontSize: 10 }}>REQUIRED</span>}
                </div>
                {group.options.map((opt) => {
                  const sel = modifierModal.selectedMods[group.id];
                  const isSelected = group.max_selections > 1
                    ? (Array.isArray(sel) && sel.includes(opt.id))
                    : sel === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setModifierModal((prev) => {
                          const newMods = { ...prev.selectedMods };
                          if (group.max_selections > 1) {
                            const arr = Array.isArray(newMods[group.id]) ? [...newMods[group.id]] : [];
                            if (arr.includes(opt.id)) {
                              newMods[group.id] = arr.filter((x) => x !== opt.id);
                            } else if (arr.length < group.max_selections) {
                              newMods[group.id] = [...arr, opt.id];
                            }
                          } else {
                            newMods[group.id] = isSelected ? null : opt.id;
                          }
                          return { ...prev, selectedMods: newMods };
                        });
                      }}
                      style={{
                        width: "100%", padding: "12px 14px", marginBottom: 4, borderRadius: 10,
                        border: isSelected ? `1.5px solid ${BRAND.primary}` : "1px solid #333",
                        background: isSelected ? BRAND.primary + "15" : "transparent",
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: isSelected ? BRAND.white : BRAND.gray }}>{opt.option_name}</span>
                      {opt.price_cents > 0 && (
                        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: BRAND.accent }}>+${(opt.price_cents / 100).toFixed(2)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* Item-level notes */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 2, color: BRAND.accent, textTransform: "uppercase", marginBottom: 8 }}>Special Instructions</div>
              <input
                type="text"
                placeholder="e.g., extra ice, no garnish..."
                value={modifierModal.notes}
                onChange={(e) => setModifierModal((prev) => ({ ...prev, notes: e.target.value }))}
                style={{ width: "100%", padding: "12px", background: "#0a0a0a", border: "1px solid #333", borderRadius: 8, color: BRAND.white, fontFamily: "'Inter', sans-serif", fontSize: 14, outline: "none" }}
              />
            </div>

            <button
              onClick={confirmModifierSelection}
              style={{ width: "100%", padding: "16px", background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`, border: "none", borderRadius: 12, color: BRAND.white, fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: 2, cursor: "pointer" }}
            >
              ADD TO ORDER
            </button>
          </div>
        </div>
      )}

      {/* CART */}
      {view === "cart" && (
        <div style={{ padding: "0 20px 100px" }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase", marginBottom: 16, paddingBottom: 8, borderBottom: `1px solid ${BRAND.accentMuted}` }}>Your Order</h2>
          {cart.length === 0 ? (
            <p style={{ color: BRAND.gray, fontSize: 14, textAlign: "center", marginTop: 40 }}>Your order is empty</p>
          ) : (
            <>
              {cart.map((item) => (
                <div key={item.cartKey} style={{ background: BRAND.cardBg, borderRadius: 14, padding: "14px 16px", border: "1px solid #222", marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 500, letterSpacing: 1 }}>{item.item_name} × {item.qty}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 14, color: BRAND.accent }}>${(((item.price_cents + (item.extraCents || 0)) * item.qty) / 100).toFixed(2)}</span>
                      <button onClick={() => removeFromCart(item.cartKey)} style={{ background: "transparent", border: "1px solid #333", borderRadius: "50%", width: 28, height: 28, color: BRAND.gray, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                    </div>
                  </div>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {item.modifiers.map((m, idx) => (
                        <span key={idx} style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.primary, marginRight: 8 }}>
                          {m.option}{m.priceCents > 0 ? ` +$${(m.priceCents / 100).toFixed(2)}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.itemNotes && (
                    <div style={{ marginTop: 4, fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.dimText, fontStyle: "italic" }}>
                      "{item.itemNotes}"
                    </div>
                  )}
                </div>
              ))}

              {/* Order-level special instructions */}
              <div style={{ marginTop: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: BRAND.gray, marginBottom: 6 }}>Order notes (optional)</div>
                <input
                  type="text"
                  placeholder="e.g., allergies, group order, table number..."
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  style={{ width: "100%", padding: "12px", background: "#0a0a0a", border: "1px solid #333", borderRadius: 10, color: BRAND.white, fontFamily: "'Inter', sans-serif", fontSize: 14, outline: "none" }}
                />
              </div>

              <div style={{ marginTop: 20, padding: "16px 0", borderTop: "1px solid #222" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, color: BRAND.gray }}>
                  <span>Subtotal</span><span style={{ fontFamily: "'Space Mono', monospace" }}>${(subtotalCents / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, color: BRAND.gray }}>
                  <span>Service fee ({venue.service_fee_percent}%)</span><span style={{ fontFamily: "'Space Mono', monospace" }}>${(feeCents / 100).toFixed(2)}</span>
                </div>

                {/* Tip selector */}
                <div style={{ margin: "16px 0 12px" }}>
                  <div style={{ fontSize: 13, color: BRAND.gray, marginBottom: 10 }}>Add a tip</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[
                      { label: "No tip", pct: 0 },
                      { label: "15%", pct: 15 },
                      { label: "18%", pct: 18 },
                      { label: "20%", pct: 20 },
                    ].map((opt) => (
                      <button
                        key={opt.pct}
                        onClick={() => { setTipPercent(opt.pct); setShowCustomTip(false); setCustomTip(""); }}
                        style={{
                          flex: 1, padding: "10px 4px", borderRadius: 10,
                          border: !showCustomTip && tipPercent === opt.pct ? `1.5px solid ${BRAND.primary}` : "1px solid #333",
                          background: !showCustomTip && tipPercent === opt.pct ? BRAND.primary + "22" : "transparent",
                          color: !showCustomTip && tipPercent === opt.pct ? BRAND.primary : BRAND.gray,
                          fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 1,
                          cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                        }}
                      >
                        <span>{opt.label}</span>
                        {opt.pct > 0 && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, opacity: 0.7 }}>${(subtotalCents * opt.pct / 10000).toFixed(2)}</span>}
                      </button>
                    ))}
                    <button
                      onClick={() => { setShowCustomTip(true); setTipPercent(0); }}
                      style={{
                        flex: 1, padding: "10px 4px", borderRadius: 10,
                        border: showCustomTip ? `1.5px solid ${BRAND.primary}` : "1px solid #333",
                        background: showCustomTip ? BRAND.primary + "22" : "transparent",
                        color: showCustomTip ? BRAND.primary : BRAND.gray,
                        fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 1,
                        cursor: "pointer",
                      }}
                    >
                      Other
                    </button>
                  </div>
                  {showCustomTip && (
                    <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 16, color: BRAND.accent }}>$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={customTip}
                        onChange={(e) => setCustomTip(e.target.value)}
                        style={{
                          flex: 1, padding: "12px", background: BRAND.cardBg, border: "1px solid #333",
                          borderRadius: 10, color: BRAND.white, fontFamily: "'Space Mono', monospace",
                          fontSize: 16, outline: "none",
                        }}
                      />
                    </div>
                  )}
                </div>

                {tipCents > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, color: BRAND.accent }}>
                    <span>Tip</span><span style={{ fontFamily: "'Space Mono', monospace" }}>${(tipCents / 100).toFixed(2)}</span>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontFamily: "'Oswald', sans-serif", fontWeight: 600, marginTop: 10, paddingTop: 10, borderTop: "1px solid #333" }}>
                  <span>Total</span><span style={{ color: BRAND.accent }}>${(totalCents / 100).toFixed(2)}</span>
                </div>
              </div>

              {/* Notification preferences */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: BRAND.gray, marginBottom: 10 }}>Get notified when ready</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: BRAND.cardBg, borderRadius: 10, border: "1px solid #222" }}>
                  <span style={{ fontSize: 16 }}>📱</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    placeholder="Phone number (optional)"
                    value={patronPhone}
                    onChange={(e) => setPatronPhone(e.target.value.replace(/[^\d+\-() ]/g, ""))}
                    style={{
                      flex: 1, padding: "8px 0", background: "transparent", border: "none",
                      color: BRAND.white, fontFamily: "'Space Mono', monospace", fontSize: 14,
                      outline: "none",
                    }}
                  />
                </div>
                <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: BRAND.dimText, letterSpacing: 1, marginTop: 6 }}>
                  WE'LL TEXT YOU WHEN YOUR ORDER IS READY · OR JUST WATCH YOUR SCREEN
                </p>
              </div>

              {/* Square card input — only show when Square is configured */}
              {!isDemoMode && (
                <>
                  <div id="card-container" style={{ marginBottom: 16, minHeight: 50 }} />
                  <SquareCardLoader venue={venue} />
                </>
              )}

              {isDemoMode && (
                <div style={{ padding: "16px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 10, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.dimText, letterSpacing: 2 }}>CARD INFORMATION</span>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: BRAND.accent, letterSpacing: 2, padding: "3px 8px", background: BRAND.accent + "15", borderRadius: 4, border: `1px solid ${BRAND.accent}33` }}>DEMO</span>
                  </div>
                  <div style={{ padding: "14px", background: "#0a0a0a", borderRadius: 8, border: "1px dashed #333", fontFamily: "'Space Mono', monospace", fontSize: 13, color: BRAND.dimText, letterSpacing: 1 }}>
                    •••• •••• •••• 4242 &nbsp;&nbsp; 12/34 &nbsp;&nbsp; •••
                  </div>
                  <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.dimText, letterSpacing: 1, marginTop: 10, textAlign: "center" }}>NO REAL CHARGE WILL BE MADE</p>
                </div>
              )}

              <button onClick={handleCheckout} style={{ width: "100%", padding: "18px", background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`, border: "none", borderRadius: 14, color: BRAND.white, fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 3, cursor: "pointer", boxShadow: `0 4px 30px ${BRAND.primaryGlow}` }}>
                {isDemoMode ? `DEMO PAY $${(totalCents / 100).toFixed(2)}` : `PAY $${(totalCents / 100).toFixed(2)}`}
              </button>
              <p style={{ textAlign: "center", fontSize: 10, color: BRAND.dimText, marginTop: 10, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>{isDemoMode ? "DEMO — NO CHARGE" : "SECURE PAYMENT VIA SQUARE"}</p>
            </>
          )}
        </div>
      )}

      {/* PROCESSING */}
      {view === "processing" && (
        <div style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 24 }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", border: "3px solid #222", borderTopColor: BRAND.primary, animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 500, letterSpacing: 2, color: BRAND.white }}>{processingStep}</div>
          <div style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: BRAND.dimText, letterSpacing: 1 }}>DO NOT CLOSE THIS SCREEN</div>
        </div>
      )}

      {/* CONFIRMATION */}
      {view === "confirmation" && activeOrders.length > 0 && currentOrder && (
        <div style={{ padding: "30px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 28, minHeight: "60vh", justifyContent: "center" }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: currentOrder.status === "ready" ? 20 : 13, fontWeight: currentOrder.status === "ready" ? 700 : 600, letterSpacing: 4, color: BRAND.success, textTransform: "uppercase", textAlign: "center", transition: "all 0.5s ease" }}>
            {currentOrder.status === "ready" ? "YOUR DRINK IS READY" : "Order Confirmed"}
          </div>

          {currentOrder.status === "ready" && (
            <div style={{ background: `${BRAND.success}15`, border: `1.5px solid ${BRAND.success}44`, borderRadius: 14, padding: "14px 22px", textAlign: "center", maxWidth: 300, animation: "readyFadeIn 0.5s ease" }}>
              <style>{`@keyframes readyFadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
              <p style={{ fontSize: 15, fontFamily: "'Oswald', sans-serif", fontWeight: 500, color: BRAND.success, letterSpacing: 1, margin: 0 }}>Head to the bar and show your confirmation</p>
            </div>
          )}

          <ConfirmationBadge
            letter={currentOrder.confirm_letter}
            color={{ hex: currentOrder.confirm_hex, name: currentOrder.confirm_color }}
            timestamp={new Date(currentOrder.ordered_at).getTime()}
            drinkReady={currentOrder.status === "ready"}
          />

          {/* Order items for current badge */}
          <div style={{ maxWidth: 280, width: "100%" }}>
            {(currentOrder.items || []).map((item, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: BRAND.gray }}>
                <span>{item.name}</span>
                <span style={{ fontFamily: "'Space Mono', monospace" }}>×{item.qty}</span>
              </div>
            ))}
          </div>

          {/* Swipe dots — only show if multiple orders */}
          {activeOrders.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button
                onClick={() => setActiveOrderIndex((i) => Math.max(0, i - 1))}
                style={{ background: "transparent", border: "none", color: activeOrderIndex > 0 ? BRAND.white : BRAND.dimText, fontSize: 20, cursor: "pointer", padding: "8px" }}
              >
                ‹
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                {activeOrders.map((ord, idx) => (
                  <button
                    key={ord.id}
                    onClick={() => setActiveOrderIndex(idx)}
                    style={{
                      width: activeOrderIndex === idx ? 24 : 10,
                      height: 10,
                      borderRadius: 5,
                      border: "none",
                      background: ord.status === "ready" ? BRAND.success : activeOrderIndex === idx ? BRAND.primary : "#333",
                      cursor: "pointer",
                      transition: "all 0.3s ease",
                    }}
                  />
                ))}
              </div>
              <button
                onClick={() => setActiveOrderIndex((i) => Math.min(activeOrders.length - 1, i + 1))}
                style={{ background: "transparent", border: "none", color: activeOrderIndex < activeOrders.length - 1 ? BRAND.white : BRAND.dimText, fontSize: 20, cursor: "pointer", padding: "8px" }}
              >
                ›
              </button>
            </div>
          )}

          {activeOrders.length > 1 && (
            <p style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: BRAND.dimText, letterSpacing: 1, margin: 0 }}>
              ORDER {activeOrderIndex + 1} OF {activeOrders.length}
            </p>
          )}

          {currentOrder.status !== "ready" && (
            <p style={{ fontSize: 14, color: BRAND.gray, lineHeight: 1.6, margin: 0, textAlign: "center" }}>
              We'll let you know when your drink is ready.
            </p>
          )}

          <button onClick={() => { setView("menu"); }} style={{ marginTop: 12, padding: "14px 32px", background: "transparent", border: `1px solid ${BRAND.dimText}`, borderRadius: 12, color: BRAND.gray, fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, letterSpacing: 2, cursor: "pointer" }}>
            NEW ORDER
          </button>
        </div>
      )}

      {/* PWA Install Prompt */}
      <InstallPrompt BRAND={BRAND} />
    </div>
  );
}

// ============================================
// SQUARE CARD LOADER
// ============================================
function SquareCardLoader({ venue }) {
  useEffect(() => {
    if (!venue.square_app_id || !venue.square_location_id) return;
    if (!window.Square) return;

    let card;
    async function init() {
      try {
        const payments = window.Square.payments(venue.square_app_id, venue.square_location_id);
        card = await payments.card();
        await card.attach("#card-container");
        window.__waitlessCard = card;
      } catch (err) {
        console.error("Square init error:", err);
      }
    }
    init();

    return () => {
      if (card) card.destroy();
      window.__waitlessCard = null;
    };
  }, [venue.square_app_id, venue.square_location_id]);

  return null;
}

// ============================================
// BARTENDER VIEW
// ============================================

const STATUS_CONFIG = {
  pending: { label: "QUEUED", bg: "#1a1520", border: "#e91e8c66", accent: "#e91e8c" },
  in_progress: { label: "MAKING", bg: "#1a1a10", border: "#d4a84366", accent: "#d4a843" },
  ready: { label: "READY", bg: "#0a1a10", border: "#2ecc7166", accent: "#2ecc71" },
};

function BartenderView({ venue, BRAND }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [orders, setOrders] = useState([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [verifyOrder, setVerifyOrder] = useState(null);

  // PIN submit
  const handlePinCheck = async (fullPin) => {
    const valid = await verifyBartenderPin(venue.id, fullPin);
    if (valid) {
      setAuthenticated(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput("");
    }
  };

  // Subscribe to queue
  useEffect(() => {
    if (!authenticated) return;
    const unsub = subscribeToBartenderQueue(venue.id, (updatedOrders) => {
      setOrders(updatedOrders);
    });
    return unsub;
  }, [authenticated, venue.id]);

  // ---- PIN SCREEN ----
  if (!authenticated) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div style={{ background: BRAND.darkGray, borderRadius: 24, padding: "36px 28px", maxWidth: 320, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, border: "1px solid #333" }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase" }}>
            Staff Access
          </div>

          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={BRAND.accent} strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>

          <p style={{ fontSize: 13, color: BRAND.gray, textAlign: "center", margin: 0, lineHeight: 1.5 }}>
            Enter the bartender PIN to access the queue.
          </p>

          {/* PIN dots */}
          <div style={{ display: "flex", gap: 12, margin: "8px 0" }}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: pinInput.length > i ? (pinError ? BRAND.danger : BRAND.accent) : "transparent",
                  border: `2px solid ${pinError ? BRAND.danger : pinInput.length > i ? BRAND.accent : "#444"}`,
                  transition: "all 0.15s ease",
                }}
              />
            ))}
          </div>

          {pinError && (
            <div style={{ fontSize: 12, color: BRAND.danger, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>
              WRONG PIN
            </div>
          )}

          {/* Number pad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%" }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"].map((key, idx) => (
              <button
                key={idx}
                onClick={() => {
                  if (key === null) return;
                  setPinError(false);
                  if (key === "del") {
                    setPinInput((p) => p.slice(0, -1));
                  } else {
                    const next = pinInput + String(key);
                    setPinInput(next);
                    if (next.length === 4) {
                      setTimeout(() => handlePinCheck(next), 200);
                    }
                  }
                }}
                style={{
                  padding: "16px",
                  background: key === null ? "transparent" : "#222",
                  border: key === null ? "none" : "1px solid #333",
                  borderRadius: 12,
                  color: key === "del" ? BRAND.dimText : BRAND.white,
                  fontFamily: key === "del" ? "'Space Mono', monospace" : "'Oswald', sans-serif",
                  fontSize: key === "del" ? 11 : 22,
                  fontWeight: 600,
                  cursor: key === null ? "default" : "pointer",
                  letterSpacing: key === "del" ? 1 : 0,
                  visibility: key === null ? "hidden" : "visible",
                }}
              >
                {key === "del" ? "DEL" : key}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- QUEUE ----
  const counts = {
    all: orders.length,
    pending: orders.filter((o) => o.status === "pending").length,
    in_progress: orders.filter((o) => o.status === "in_progress").length,
    ready: orders.filter((o) => o.status === "ready").length,
  };

  const sorted = [...orders]
    .filter((o) => filterStatus === "all" || o.status === filterStatus)
    .sort((a, b) => {
      const p = { pending: 0, in_progress: 1, ready: 2 };
      if (p[a.status] !== p[b.status]) return p[a.status] - p[b.status];
      return new Date(a.ordered_at) - new Date(b.ordered_at);
    });

  return (
    <div>
      {/* Bartender mode bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: BRAND.accent + "15", borderBottom: `1px solid ${BRAND.accent}33`, padding: "8px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: BRAND.accent }} />
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.accent, letterSpacing: 2 }}>BARTENDER MODE</span>
        </div>
        <button onClick={() => { setAuthenticated(false); setPinInput(""); }} style={{ background: "transparent", border: `1px solid ${BRAND.danger}44`, borderRadius: 14, padding: "5px 12px", color: BRAND.danger, fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 1, cursor: "pointer" }}>
          LOCK
        </button>
      </div>

      {/* Header */}
      <div style={{ position: "sticky", top: 36, zIndex: 90, background: BRAND.black, borderBottom: "1px solid #1a1a1a", padding: "12px 20px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 4, margin: 0, background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{venue.name.toUpperCase()}</h1>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 3, color: BRAND.dimText, margin: "2px 0 0", textTransform: "uppercase" }}>Bartender Queue</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: BRAND.success, boxShadow: `0 0 8px ${BRAND.success}88`, animation: "livePulse 2s ease infinite" }} />
            <style>{`@keyframes livePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: BRAND.success, letterSpacing: 2 }}>LIVE</span>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[{ key: "all", label: "All" }, { key: "pending", label: "Queued" }, { key: "in_progress", label: "Making" }, { key: "ready", label: "Ready" }].map((tab) => (
            <button key={tab.key} onClick={() => setFilterStatus(tab.key)} style={{ padding: "7px 14px", borderRadius: 20, border: filterStatus === tab.key ? `1px solid ${BRAND.primary}` : "1px solid #333", background: filterStatus === tab.key ? BRAND.primary + "22" : "transparent", color: filterStatus === tab.key ? BRAND.primary : BRAND.gray, fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500, letterSpacing: 1, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              {tab.label}
              <span style={{ background: filterStatus === tab.key ? BRAND.primary : "#333", color: filterStatus === tab.key ? BRAND.white : BRAND.gray, width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontFamily: "'Space Mono', monospace" }}>{counts[tab.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Order cards */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {sorted.map((order) => {
          const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
          return (
            <div key={order.id} style={{ background: config.bg, borderRadius: 16, border: `1.5px solid ${config.border}`, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Top row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 10, background: `radial-gradient(circle, ${order.confirm_hex}22, ${BRAND.darkGray})`, border: `2px solid ${order.confirm_hex}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 12px ${order.confirm_hex}44` }}>
                    <span style={{ fontSize: 26, fontFamily: "'Oswald', sans-serif", fontWeight: 700, color: order.confirm_hex, lineHeight: 1 }}>{order.confirm_letter}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontFamily: "'Oswald', sans-serif", fontWeight: 600, color: order.confirm_hex, letterSpacing: 1, textTransform: "uppercase" }}>{order.confirm_color} {order.confirm_letter}</div>
                    <WaitTimer since={order.ordered_at} />
                  </div>
                </div>
                <div style={{ padding: "5px 12px", borderRadius: 20, background: config.accent + "22", border: `1px solid ${config.accent}44`, fontFamily: "'Space Mono', monospace", fontSize: 10, fontWeight: 700, color: config.accent, letterSpacing: 2 }}>{config.label}</div>
              </div>

              {/* Items with modifiers */}
              {(order.items || []).map((item, idx) => (
                <div key={idx}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 15, fontFamily: "'Oswald', sans-serif", fontWeight: 500, color: BRAND.white, letterSpacing: 0.5 }}>{item.name}</span>
                    <span style={{ fontSize: 13, fontFamily: "'Space Mono', monospace", color: BRAND.dimText }}>×{item.qty}</span>
                  </div>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3, marginLeft: 8 }}>
                      {item.modifiers.map((m, mi) => (
                        <span key={mi} style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.primary, padding: "2px 6px", background: BRAND.primary + "15", borderRadius: 4 }}>
                          {m.option}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.notes && (
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: BRAND.accent, marginTop: 3, marginLeft: 8, fontStyle: "italic" }}>
                      "{item.notes}"
                    </div>
                  )}
                </div>
              ))}

              {/* Order-level special instructions */}
              {order.special_instructions && (
                <div style={{ padding: "8px 10px", background: BRAND.accent + "11", borderRadius: 6, border: `1px solid ${BRAND.accent}22` }}>
                  <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: BRAND.accent, letterSpacing: 1 }}>NOTE: </span>
                  <span style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: BRAND.white }}>{order.special_instructions}</span>
                </div>
              )}

              {/* Ready timestamp */}
              {order.status === "ready" && order.ready_at && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#0a1a1022", borderRadius: 6, border: `1px solid ${BRAND.success}22` }}>
                  <span style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: BRAND.dimText }}>READY SINCE</span>
                  <span style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: BRAND.success }}>{new Date(order.ready_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 10 }}>
                {order.status === "pending" && (
                  <button onClick={() => startMakingOrder(order.id)} style={{ flex: 1, padding: "13px", background: BRAND.accent, border: "none", borderRadius: 10, color: BRAND.black, fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 2, cursor: "pointer" }}>START MAKING</button>
                )}
                {order.status === "in_progress" && (
                  <button onClick={async () => { await markOrderReady(order.id); fetch("/.netlify/functions/send-notification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, venueId: venue.id }) }).catch(() => {}); }} style={{ flex: 1, padding: "13px", background: BRAND.success, border: "none", borderRadius: 10, color: BRAND.black, fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 2, cursor: "pointer" }}>DRINK READY</button>
                )}
                {order.status === "ready" && (
                  <button onClick={() => setVerifyOrder(order)} style={{ flex: 1, padding: "13px", background: "transparent", border: `1.5px solid ${BRAND.success}`, borderRadius: 10, color: BRAND.success, fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 2, cursor: "pointer" }}>VERIFY & HAND OFF</button>
                )}
              </div>
            </div>
          );
        })}

        {sorted.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>🍸</div>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, color: BRAND.dimText, letterSpacing: 2 }}>NO ORDERS YET</div>
          </div>
        )}
      </div>

      {/* Verify Modal */}
      {verifyOrder && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: BRAND.darkGray, borderRadius: 24, padding: "36px 28px", maxWidth: 380, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, border: "1px solid #333" }}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase" }}>Verify Pickup</div>

            <ConfirmationBadge
              letter={verifyOrder.confirm_letter}
              color={{ hex: verifyOrder.confirm_hex, name: verifyOrder.confirm_color }}
              timestamp={new Date(verifyOrder.ordered_at).getTime()}
              drinkReady={true}
              size={140}
            />

            {/* Timestamps */}
            <div style={{ width: "100%", background: BRAND.black, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: BRAND.dimText }}>ORDERED</span>
                <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: BRAND.gray }}>{new Date(verifyOrder.ordered_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              </div>
              {verifyOrder.ready_at && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: BRAND.dimText }}>READY</span>
                  <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: BRAND.success }}>{new Date(verifyOrder.ready_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid #222" }}>
                <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: BRAND.dimText }}>SITTING</span>
                <WaitTimer since={verifyOrder.ready_at || verifyOrder.ordered_at} />
              </div>
            </div>

            <p style={{ fontSize: 13, color: BRAND.gray, textAlign: "center", lineHeight: 1.5, margin: 0 }}>Match this to the patron's phone before handing off.</p>

            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <button onClick={() => setVerifyOrder(null)} style={{ flex: 1, padding: "13px", background: "transparent", border: "1px solid #444", borderRadius: 10, color: BRAND.gray, fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: 2, cursor: "pointer" }}>CANCEL</button>
              <button onClick={() => { markOrderPickedUp(verifyOrder.id); setVerifyOrder(null); }} style={{ flex: 1, padding: "13px", background: BRAND.success, border: "none", borderRadius: 10, color: BRAND.black, fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: "pointer" }}>CONFIRM</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
