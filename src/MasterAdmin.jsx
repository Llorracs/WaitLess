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
import QRGenerator from "./QRGenerator";
import AnalyticsView from "./AnalyticsView";
import BillingView from "./BillingView";

// Hardcode your admin email — only this email can access master admin
const MASTER_ADMIN_EMAIL = "atimelssconcept@gmail.com";

// Inline menu builder for master admin
function MasterMenuBuilder({ venue, onBack }) {
  const [menu, setMenu] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => { loadMenu(); }, [venue.id]);

  async function loadMenu() {
    const { data } = await supabase.from("menus").select("*").eq("venue_id", venue.id).order("category").order("sort_order");
    if (data) setMenu(data);
  }

  const flash = (msg) => { setSaveMsg(msg); setTimeout(() => setSaveMsg(null), 2000); };

  const handleSave = async (item) => {
    if (item.id) {
      await supabase.from("menus").update({ item_name: item.item_name, description: item.description, price_cents: item.price_cents, category: item.category, sort_order: item.sort_order, active: item.active }).eq("id", item.id);
    } else {
      await supabase.from("menus").insert({ venue_id: venue.id, item_name: item.item_name, description: item.description || "", price_cents: item.price_cents, category: item.category, sort_order: item.sort_order || 0, active: true });
    }
    await loadMenu(); setEditingItem(null); setNewItem(null); flash("Saved");
  };

  const handleDelete = async (id) => { if (!confirm("Remove?")) return; await supabase.from("menus").delete().eq("id", id); await loadMenu(); flash("Removed"); };
  const handleToggle = async (item) => { await supabase.from("menus").update({ active: !item.active }).eq("id", item.id); await loadMenu(); flash(item.active ? "Hidden" : "Visible"); };

  const categories = [...new Set(menu.map((m) => m.category))];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={onBack} style={MS.backBtn}>← BACK TO VENUES</button>
        {saveMsg && <span style={MS.flash}>{saveMsg}</span>}
      </div>
      <h3 style={MS.manageTitle}>Menu — {venue.name}</h3>

      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 24 }}>
          <h4 style={MS.catHeader}>{cat}</h4>
          {menu.filter((m) => m.category === cat).map((item) =>
            editingItem?.id === item.id ? (
              <div key={item.id} style={MS.editCard}>
                <input placeholder="Name" value={editingItem.item_name} onChange={(e) => setEditingItem({ ...editingItem, item_name: e.target.value })} style={MS.input} />
                <input placeholder="Description" value={editingItem.description || ""} onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })} style={MS.input} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" step="0.01" value={(editingItem.price_cents / 100).toFixed(2)} onChange={(e) => setEditingItem({ ...editingItem, price_cents: Math.round(parseFloat(e.target.value || 0) * 100) })} style={{ ...MS.input, flex: 1 }} />
                  <input type="number" value={editingItem.sort_order} onChange={(e) => setEditingItem({ ...editingItem, sort_order: parseInt(e.target.value || 0) })} style={{ ...MS.input, width: 60 }} />
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setEditingItem(null)} style={MS.dimBtn}>CANCEL</button>
                  <button onClick={() => handleSave(editingItem)} style={MS.saveBtn}>SAVE</button>
                </div>
              </div>
            ) : (
              <div key={item.id} style={{ ...MS.itemRow, opacity: item.active ? 1 : 0.5 }}>
                <div style={{ flex: 1 }}>
                  <span style={MS.itemName}>{item.item_name}</span>
                  {item.description && <span style={MS.itemDesc}>{item.description}</span>}
                </div>
                <span style={MS.itemPrice}>${(item.price_cents / 100).toFixed(2)}</span>
                <button onClick={() => handleToggle(item)} style={MS.iconBtn}>{item.active ? "👁" : "🚫"}</button>
                <button onClick={() => setEditingItem({ ...item })} style={MS.iconBtn}>✏️</button>
                <button onClick={() => handleDelete(item.id)} style={MS.iconBtn}>🗑</button>
              </div>
            )
          )}
          <button onClick={() => setNewItem({ item_name: "", description: "", price_cents: 0, category: cat, sort_order: menu.filter((m) => m.category === cat).length + 1 })} style={MS.addBtn}>+ Add to {cat}</button>
        </div>
      ))}

      {newItem && (
        <div style={MS.editCard}>
          <input placeholder="Name" value={newItem.item_name} onChange={(e) => setNewItem({ ...newItem, item_name: e.target.value })} style={MS.input} />
          <input placeholder="Description" value={newItem.description || ""} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} style={MS.input} />
          <input type="number" step="0.01" placeholder="Price" value={newItem.price_cents ? (newItem.price_cents / 100).toFixed(2) : ""} onChange={(e) => setNewItem({ ...newItem, price_cents: Math.round(parseFloat(e.target.value || 0) * 100) })} style={MS.input} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setNewItem(null)} style={MS.dimBtn}>CANCEL</button>
            <button onClick={() => handleSave(newItem)} style={MS.saveBtn}>SAVE</button>
          </div>
        </div>
      )}

      {showNewCategory ? (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input placeholder="Category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} style={MS.input} />
          <button onClick={() => { if (newCategory.trim()) { setNewItem({ item_name: "", description: "", price_cents: 0, category: newCategory.trim(), sort_order: 1 }); setShowNewCategory(false); setNewCategory(""); }}} style={MS.saveBtn}>CREATE</button>
          <button onClick={() => { setShowNewCategory(false); setNewCategory(""); }} style={MS.dimBtn}>CANCEL</button>
        </div>
      ) : (
        <button onClick={() => setShowNewCategory(true)} style={{ ...MS.addBtn, marginTop: 12 }}>+ New Category</button>
      )}
    </div>
  );
}

// Inline venue settings for master admin
function MasterVenueSettings({ venue, setManagedVenue, onBack }) {
  const [form, setForm] = useState({
    name: venue.name || "", tagline: venue.tagline || "", bartender_pin: venue.bartender_pin || "0000",
    service_fee_percent: venue.service_fee_percent || 5, primary: venue.brand_colors?.primary || "#e91e8c",
    accent: venue.brand_colors?.accent || "#d4a843", background: venue.brand_colors?.background || "#0a0a0a",
    square_app_id: venue.square_app_id || "", square_access_token: venue.square_access_token || "",
    square_location_id: venue.square_location_id || "", square_environment: venue.square_environment || "sandbox",
  });
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await supabase.from("venues").update({
      name: form.name, tagline: form.tagline, bartender_pin: form.bartender_pin,
      service_fee_percent: form.service_fee_percent,
      brand_colors: { primary: form.primary, accent: form.accent, background: form.background },
      square_app_id: form.square_app_id || null, square_access_token: form.square_access_token || null,
      square_location_id: form.square_location_id || null, square_environment: form.square_environment,
    }).eq("id", venue.id);
    setManagedVenue((prev) => ({ ...prev, ...form, brand_colors: { primary: form.primary, accent: form.accent, background: form.background } }));
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={onBack} style={MS.backBtn}>← BACK TO VENUES</button>
        {saved && <span style={MS.flash}>Saved</span>}
      </div>
      <h3 style={MS.manageTitle}>Settings — {venue.name}</h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label style={MS.label}>Venue Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={MS.input} /></div>
        <div><label style={MS.label}>Tagline</label><input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} style={MS.input} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label style={MS.label}>Bartender PIN</label><input maxLength={4} value={form.bartender_pin} onChange={(e) => setForm({ ...form, bartender_pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={MS.input} /></div>
          <div style={{ flex: 1 }}><label style={MS.label}>Service Fee %</label><input type="number" step="0.5" value={form.service_fee_percent} onChange={(e) => setForm({ ...form, service_fee_percent: parseFloat(e.target.value || 0) })} style={MS.input} /></div>
        </div>
        <div><label style={MS.label}>Brand Colors</label>
          <div style={{ display: "flex", gap: 12 }}>
            {[{ key: "primary", label: "Primary" }, { key: "accent", label: "Accent" }, { key: "background", label: "Background" }].map((c) => (
              <div key={c.key}>
                <span style={{ fontSize: 9, color: "#666", fontFamily: "'Space Mono', monospace" }}>{c.label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="color" value={form[c.key]} onChange={(e) => setForm({ ...form, [c.key]: e.target.value })} style={{ width: 32, height: 32, border: "none", borderRadius: 4, cursor: "pointer" }} />
                  <input type="text" value={form[c.key]} onChange={(e) => setForm({ ...form, [c.key]: e.target.value })} style={{ ...MS.input, width: 80, fontSize: 11 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 12, borderTop: "1px solid #1a1a1a", paddingTop: 12 }}>
          <label style={{ ...MS.label, color: "#d4a843" }}>Square Credentials</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <input placeholder="Square App ID" value={form.square_app_id} onChange={(e) => setForm({ ...form, square_app_id: e.target.value })} style={MS.input} />
            <input placeholder="Square Access Token" type="password" value={form.square_access_token} onChange={(e) => setForm({ ...form, square_access_token: e.target.value })} style={MS.input} />
            <input placeholder="Square Location ID" value={form.square_location_id} onChange={(e) => setForm({ ...form, square_location_id: e.target.value })} style={MS.input} />
            <select value={form.square_environment} onChange={(e) => setForm({ ...form, square_environment: e.target.value })} style={MS.input}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </div>
        </div>
        <button onClick={handleSave} style={{ ...MS.saveBtn, padding: "14px", fontSize: 14, marginTop: 8 }}>SAVE ALL SETTINGS</button>
      </div>
    </div>
  );
}

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

  // Manage mode — full admin for a specific venue
  const [managedVenue, setManagedVenue] = useState(null);
  const [manageTab, setManageTab] = useState("analytics"); // analytics | menu | settings | qr | billing

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
      ) : managedVenue ? (
        /* ---- MANAGE MODE — full admin for a single venue ---- */
        <div style={{ padding: "20px 0" }}>
          {/* Manage header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, padding: "12px 16px", background: "#0a0a0a", borderRadius: 10, border: "1px solid #e91e8c33" }}>
            <div>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>{managedVenue.name?.toUpperCase()}</span>
              <span style={{ display: "block", fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#d4a843", letterSpacing: 2 }}>MANAGING VENUE</span>
            </div>
            <button onClick={() => { setManagedVenue(null); loadPlatformData(); }} style={S.actionBtn}>← ALL VENUES</button>
          </div>

          {/* Manage tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
            {[
              { key: "analytics", label: "Analytics" },
              { key: "menu", label: "Menu" },
              { key: "settings", label: "Settings" },
              { key: "qr", label: "QR Code" },
            ].map((tab) => (
              <button key={tab.key} onClick={() => setManageTab(tab.key)} style={{
                padding: "8px 16px", borderRadius: 8, border: manageTab === tab.key ? "1px solid #e91e8c" : "1px solid #222",
                background: manageTab === tab.key ? "#e91e8c22" : "transparent",
                color: manageTab === tab.key ? "#e91e8c" : "#888",
                fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500, letterSpacing: 1, cursor: "pointer",
              }}>{tab.label}</button>
            ))}
          </div>

          {/* Manage content */}
          {manageTab === "analytics" && <AnalyticsView venue={managedVenue} BRAND={{ primary: managedVenue.brand_colors?.primary || "#e91e8c", accent: managedVenue.brand_colors?.accent || "#d4a843" }} />}
          {manageTab === "menu" && <MasterMenuBuilder venue={managedVenue} onBack={() => setManageTab("analytics")} />}
          {manageTab === "settings" && <MasterVenueSettings venue={managedVenue} setManagedVenue={setManagedVenue} onBack={() => setManageTab("analytics")} />}
          {manageTab === "qr" && <QRGenerator venue={managedVenue} BRAND={{ primary: managedVenue.brand_colors?.primary || "#e91e8c", accent: managedVenue.brand_colors?.accent || "#d4a843" }} embedded={true} />}
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
                    <button onClick={() => { setManagedVenue(v); setManageTab("analytics"); }} style={S.manageBtn}>MANAGE</button>
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
  manageBtn: {
    padding: "6px 14px", borderRadius: 6, border: "1px solid #e91e8c",
    background: "#e91e8c22", color: "#e91e8c", fontFamily: "'Space Mono', monospace",
    fontSize: 10, letterSpacing: 1, cursor: "pointer", fontWeight: 700,
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

// Manage mode styles
const MS = {
  backBtn: { background: "transparent", border: "1px solid #333", borderRadius: 8, padding: "6px 14px", color: "#888", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer" },
  flash: { fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#2ecc71", letterSpacing: 2, padding: "4px 10px", background: "#2ecc7115", borderRadius: 6, border: "1px solid #2ecc7133" },
  manageTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 2, marginBottom: 16 },
  catHeader: { fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 3, color: "#d4a843", textTransform: "uppercase", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #d4a8431a" },
  itemRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#0a0a0a", borderRadius: 8, border: "1px solid #1a1a1a", marginBottom: 4 },
  itemName: { fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, display: "block" },
  itemDesc: { fontSize: 11, color: "#888", display: "block" },
  itemPrice: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#d4a843" },
  iconBtn: { background: "transparent", border: "none", fontSize: 13, cursor: "pointer", padding: 4, filter: "grayscale(0.5)" },
  addBtn: { width: "100%", padding: "8px", borderRadius: 6, border: "1px dashed #333", background: "transparent", color: "#666", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer" },
  editCard: { padding: 14, background: "#0a0a0a", borderRadius: 10, border: "1px solid #e91e8c44", display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 },
  input: { padding: "10px", background: "#141414", border: "1px solid #222", borderRadius: 6, color: "#f5f5f5", fontFamily: "'Inter', sans-serif", fontSize: 13, outline: "none", width: "100%" },
  label: { display: "block", fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#888", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  saveBtn: { padding: "8px 16px", borderRadius: 6, border: "none", background: "#e91e8c", color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 2, cursor: "pointer" },
  dimBtn: { padding: "8px 16px", borderRadius: 6, border: "1px solid #333", background: "transparent", color: "#888", fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500, letterSpacing: 2, cursor: "pointer" },
};
