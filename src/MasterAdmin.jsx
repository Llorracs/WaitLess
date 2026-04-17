/**
 * ============================================
 * WAITLESS — Master Admin Panel
 * ============================================
 * 
 * FILE: src/MasterAdmin.jsx
 * 
 * Route: waitless.app/admin/master
 * 
 * YOUR panel (platform owner). Shows:
 * - All venues across the platform
 * - Subscription statuses
 * - Platform-wide order/revenue metrics
 * - Ability to activate/suspend venues
 * ============================================
 */

import { useState, useEffect } from "react";
import { supabase } from "./lib/barOrderService";

// Hardcode your admin email — only this email can access master admin
const MASTER_ADMIN_EMAIL = "atimelssconcept@gmail.com";

export default function MasterAdmin() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(null);

  const [venues, setVenues] = useState([]);
  const [platformStats, setPlatformStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [venueOrders, setVenueOrders] = useState([]);

  // Check session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
      }
      setAuthLoading(false);
    });
  }, []);

  // Load data when authenticated
  useEffect(() => {
    if (!user) return;
    loadPlatformData();
  }, [user]);

  async function loadPlatformData() {
    setLoading(true);

    // Get all venues
    const { data: venueData } = await supabase
      .from("venues")
      .select("*")
      .order("created_at", { ascending: false });

    if (venueData) setVenues(venueData);

    // Get platform-wide order stats (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: orderData } = await supabase
      .from("bar_orders")
      .select("total_cents, fee_cents, status, ordered_at, venue_id")
      .gte("ordered_at", thirtyDaysAgo.toISOString());

    if (orderData) {
      const completed = orderData.filter((o) => o.status === "picked_up");
      const totalRevenue = completed.reduce((sum, o) => sum + (o.total_cents || 0), 0);
      const totalFees = completed.reduce((sum, o) => sum + (o.fee_cents || 0), 0);
      const activeVenueIds = new Set(orderData.map((o) => o.venue_id).filter(Boolean));

      setPlatformStats({
        totalOrders: orderData.length,
        completedOrders: completed.length,
        totalRevenue,
        totalFees,
        activeVenues: activeVenueIds.size,
        totalVenues: venueData?.length || 0,
      });
    }

    setLoading(false);
  }

  async function loadVenueOrders(venueId) {
    const { data } = await supabase
      .from("bar_orders")
      .select("*")
      .eq("venue_id", venueId)
      .order("ordered_at", { ascending: false })
      .limit(50);
    setVenueOrders(data || []);
  }

  async function toggleVenueStatus(venue) {
    const newStatus = venue.is_active ? false : true;
    const { error } = await supabase
      .from("venues")
      .update({ is_active: newStatus })
      .eq("id", venue.id);
    if (!error) loadPlatformData();
  }

  async function updateSubscription(venueId, status) {
    const { error } = await supabase
      .from("venues")
      .update({ subscription_status: status })
      .eq("id", venueId);
    if (!error) loadPlatformData();
  }

  const handleLogin = async () => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setAuthError(error.message); return; }
    setUser(data.user);
  };

  // ---- AUTH GATE ----
  if (authLoading) {
    return (
      <div style={S.centered}>
        <div style={S.spinner} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={S.centered}>
        <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <div style={S.authCard}>
          <h1 style={S.logo}>WAITLESS</h1>
          <p style={S.authSub}>MASTER ADMIN</p>
          <input type="email" placeholder="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} style={S.input} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} style={S.input} />
          {authError && <p style={S.error}>{authError}</p>}
          <button onClick={handleLogin} style={S.primaryBtn}>LOG IN</button>
        </div>
      </div>
    );
  }

  // ---- MASTER DASHBOARD ----
  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={S.header}>
        <div>
          <h1 style={S.headerTitle}>WAITLESS</h1>
          <p style={S.headerSub}>MASTER ADMIN · PLATFORM OVERVIEW</p>
        </div>
        <button onClick={() => supabase.auth.signOut().then(() => setUser(null))} style={S.logoutBtn}>LOG OUT</button>
      </div>

      {loading ? (
        <div style={S.centered}>
          <div style={S.spinner} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <>
          {/* Platform KPIs */}
          {platformStats && (
            <div style={S.kpiGrid}>
              <div style={S.kpiCard}>
                <span style={S.kpiLabel}>TOTAL VENUES</span>
                <span style={S.kpiValue}>{platformStats.totalVenues}</span>
              </div>
              <div style={S.kpiCard}>
                <span style={{ ...S.kpiLabel, color: "#2ecc71" }}>ACTIVE VENUES</span>
                <span style={S.kpiValue}>{platformStats.activeVenues}</span>
                <span style={S.kpiSub}>with orders in last 30d</span>
              </div>
              <div style={S.kpiCard}>
                <span style={{ ...S.kpiLabel, color: "#d4a843" }}>PLATFORM REVENUE</span>
                <span style={S.kpiValue}>${(platformStats.totalRevenue / 100).toFixed(2)}</span>
                <span style={S.kpiSub}>{platformStats.completedOrders} orders (30d)</span>
              </div>
              <div style={S.kpiCard}>
                <span style={{ ...S.kpiLabel, color: "#e91e8c" }}>TOTAL FEES</span>
                <span style={S.kpiValue}>${(platformStats.totalFees / 100).toFixed(2)}</span>
                <span style={S.kpiSub}>service fees collected (30d)</span>
              </div>
            </div>
          )}

          {/* Venue list */}
          <div style={S.section}>
            <div style={S.sectionHeader}>
              <h2 style={S.sectionTitle}>All Venues</h2>
              <span style={S.venueCount}>{venues.length} total</span>
            </div>

            <div style={S.venueList}>
              {venues.map((v) => (
                <div key={v.id} style={{ ...S.venueCard, opacity: v.is_active ? 1 : 0.5 }}>
                  <div style={S.venueTop}>
                    <div style={S.venueInfo}>
                      <span style={S.venueName}>{v.name}</span>
                      <span style={S.venueSlug}>/{v.slug}</span>
                    </div>
                    <div style={S.venueBadges}>
                      <span style={{
                        ...S.badge,
                        color: v.is_active ? "#2ecc71" : "#e74c3c",
                        borderColor: v.is_active ? "#2ecc7144" : "#e74c3c44",
                        background: v.is_active ? "#2ecc7111" : "#e74c3c11",
                      }}>
                        {v.is_active ? "ACTIVE" : "INACTIVE"}
                      </span>
                      <span style={{
                        ...S.badge,
                        color: v.subscription_status === "active" ? "#2ecc71" : v.subscription_status === "trial" ? "#d4a843" : "#e74c3c",
                        borderColor: v.subscription_status === "active" ? "#2ecc7144" : v.subscription_status === "trial" ? "#d4a84344" : "#e74c3c44",
                        background: v.subscription_status === "active" ? "#2ecc7111" : v.subscription_status === "trial" ? "#d4a84311" : "#e74c3c11",
                      }}>
                        {v.subscription_status?.toUpperCase()}
                      </span>
                      {v.square_access_token && (
                        <span style={{ ...S.badge, color: "#3498db", borderColor: "#3498db44", background: "#3498db11" }}>
                          SQUARE
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={S.venueDetails}>
                    <span style={S.venueDetail}>Owner: {v.owner_email || "—"}</span>
                    <span style={S.venueDetail}>Fee: {v.service_fee_percent}%</span>
                    <span style={S.venueDetail}>Created: {new Date(v.created_at).toLocaleDateString()}</span>
                    {v.trial_ends_at && v.subscription_status === "trial" && (
                      <span style={{ ...S.venueDetail, color: new Date(v.trial_ends_at) < new Date() ? "#e74c3c" : "#d4a843" }}>
                        Trial {new Date(v.trial_ends_at) < new Date() ? "expired" : `ends ${new Date(v.trial_ends_at).toLocaleDateString()}`}
                      </span>
                    )}
                  </div>

                  <div style={S.venueActions}>
                    <button onClick={() => toggleVenueStatus(v)} style={S.actionBtn}>
                      {v.is_active ? "SUSPEND" : "ACTIVATE"}
                    </button>

                    <select
                      value={v.subscription_status}
                      onChange={(e) => updateSubscription(v.id, e.target.value)}
                      style={S.actionSelect}
                    >
                      <option value="trial">Trial</option>
                      <option value="active">Active</option>
                      <option value="past_due">Past Due</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="suspended">Suspended</option>
                    </select>

                    <button
                      onClick={() => {
                        setSelectedVenue(selectedVenue?.id === v.id ? null : v);
                        if (selectedVenue?.id !== v.id) loadVenueOrders(v.id);
                      }}
                      style={S.actionBtn}
                    >
                      {selectedVenue?.id === v.id ? "HIDE ORDERS" : "VIEW ORDERS"}
                    </button>

                    <a href={`/${v.slug}`} target="_blank" rel="noopener noreferrer" style={S.actionLink}>PATRON ↗</a>
                    <a href={`/${v.slug}/admin`} target="_blank" rel="noopener noreferrer" style={S.actionLink}>ADMIN ↗</a>
                  </div>

                  {/* Expanded order view */}
                  {selectedVenue?.id === v.id && (
                    <div style={S.orderExpand}>
                      <h4 style={S.orderExpandTitle}>Recent Orders — {v.name}</h4>
                      {venueOrders.length === 0 ? (
                        <p style={S.empty}>No orders yet</p>
                      ) : (
                        <div style={S.orderList}>
                          {venueOrders.slice(0, 20).map((o) => (
                            <div key={o.id} style={S.orderRow}>
                              <div style={{ ...S.orderBadge, backgroundColor: o.confirm_hex }}>
                                <span style={S.orderLetter}>{o.confirm_letter}</span>
                              </div>
                              <span style={S.orderColor}>{o.confirm_color} {o.confirm_letter}</span>
                              <span style={S.orderTime}>
                                {new Date(o.ordered_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                              </span>
                              <span style={S.orderAmount}>${((o.total_cents || 0) / 100).toFixed(2)}</span>
                              <span style={{
                                ...S.orderStatus,
                                color: o.status === "picked_up" ? "#2ecc71" : o.status === "expired" ? "#e74c3c" : "#d4a843",
                              }}>
                                {o.status.replace("_", " ").toUpperCase()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const S = {
  centered: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", background: "#050505", color: "#f5f5f5", padding: 24,
  },
  page: {
    maxWidth: 960, margin: "0 auto", padding: "0 20px 60px",
    minHeight: "100vh", background: "#050505", color: "#f5f5f5",
    fontFamily: "'Inter', sans-serif",
  },
  spinner: {
    width: 40, height: 40, borderRadius: "50%", border: "3px solid #222",
    borderTopColor: "#e91e8c", animation: "spin 1s linear infinite",
  },

  // Auth
  authCard: {
    background: "#0a0a0a", borderRadius: 20, padding: "36px 28px", maxWidth: 360, width: "100%",
    display: "flex", flexDirection: "column", gap: 16, border: "1px solid #1a1a1a",
  },
  logo: {
    fontFamily: "'Oswald', sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: 4,
    textAlign: "center", margin: 0,
    background: "linear-gradient(135deg, #e91e8c, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  authSub: {
    fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#666", textAlign: "center",
    letterSpacing: 3, margin: 0,
  },
  input: {
    padding: "14px", background: "#141414", border: "1px solid #222", borderRadius: 10,
    color: "#f5f5f5", fontFamily: "'Inter', sans-serif", fontSize: 14, outline: "none", width: "100%",
  },
  error: { color: "#e74c3c", fontSize: 13, margin: 0, textAlign: "center" },
  primaryBtn: {
    padding: "14px", borderRadius: 10, border: "none",
    background: "linear-gradient(135deg, #e91e8c, #d4a843)",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
    letterSpacing: 3, cursor: "pointer",
  },

  // Header
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "24px 0", borderBottom: "1px solid #1a1a1a",
  },
  headerTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: 4, margin: 0,
    background: "linear-gradient(135deg, #e91e8c, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  headerSub: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 3, margin: "2px 0 0" },
  logoutBtn: {
    background: "transparent", border: "1px solid #222", borderRadius: 8, padding: "6px 14px",
    color: "#666", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer",
  },

  // KPIs
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, padding: "20px 0" },
  kpiCard: {
    padding: "18px", background: "#0a0a0a", borderRadius: 12, border: "1px solid #1a1a1a",
    display: "flex", flexDirection: "column", gap: 4,
  },
  kpiLabel: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#e91e8c", letterSpacing: 2 },
  kpiValue: { fontFamily: "'Oswald', sans-serif", fontSize: 32, fontWeight: 700 },
  kpiSub: { fontSize: 11, color: "#666" },

  // Sections
  section: { padding: "20px 0" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sectionTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 600, letterSpacing: 3,
    color: "#d4a843", textTransform: "uppercase", margin: 0,
  },
  venueCount: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", letterSpacing: 1 },

  // Venue cards
  venueList: { display: "flex", flexDirection: "column", gap: 12 },
  venueCard: {
    padding: "18px", background: "#0a0a0a", borderRadius: 14, border: "1px solid #1a1a1a",
    display: "flex", flexDirection: "column", gap: 12,
  },
  venueTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 },
  venueInfo: { display: "flex", flexDirection: "column", gap: 2 },
  venueName: { fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 600, letterSpacing: 1 },
  venueSlug: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#d4a843" },
  venueBadges: { display: "flex", gap: 6, flexWrap: "wrap" },
  badge: {
    fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 2,
    padding: "3px 8px", borderRadius: 4, border: "1px solid",
  },

  venueDetails: { display: "flex", gap: 16, flexWrap: "wrap" },
  venueDetail: { fontSize: 12, color: "#666" },

  venueActions: { display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid #1a1a1a" },
  actionBtn: {
    padding: "6px 14px", borderRadius: 6, border: "1px solid #333", background: "transparent",
    color: "#888", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer",
  },
  actionSelect: {
    padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: "#141414",
    color: "#888", fontFamily: "'Space Mono', monospace", fontSize: 10, outline: "none", cursor: "pointer",
  },
  actionLink: {
    padding: "6px 14px", borderRadius: 6, border: "1px solid #333",
    color: "#d4a843", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1,
    textDecoration: "none",
  },

  // Order expand
  orderExpand: {
    padding: "16px", background: "#050505", borderRadius: 10, border: "1px solid #1a1a1a", marginTop: 4,
  },
  orderExpandTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 2,
    color: "#d4a843", marginBottom: 12,
  },
  orderList: { display: "flex", flexDirection: "column", gap: 4 },
  orderRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
    background: "#0a0a0a", borderRadius: 6, border: "1px solid #1a1a1a",
  },
  orderBadge: {
    width: 28, height: 28, borderRadius: 6, display: "flex",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  orderLetter: { fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700, color: "#fff" },
  orderColor: { fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500, flex: 1 },
  orderTime: { fontSize: 10, color: "#666", fontFamily: "'Space Mono', monospace" },
  orderAmount: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#d4a843" },
  orderStatus: { fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 1, minWidth: 70, textAlign: "right" },
  empty: { textAlign: "center", color: "#666", padding: 20, fontSize: 12 },
};
