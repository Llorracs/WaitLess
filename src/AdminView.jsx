/**
 * ============================================
 * WAITLESS — Venue Admin Dashboard
 * ============================================
 * 
 * FILE: src/AdminView.jsx
 * 
 * Route: waitless.app/{slug}/admin
 * 
 * Venue owners can:
 * - Log in / sign up with email & password
 * - Edit venue name, tagline, brand colors
 * - Set bartender PIN and service fee
 * - Add/edit/remove/reorder menu items
 * - Rename, delete, reorder menu CATEGORIES
 * - Enter Square credentials
 * - Manage ticketed events
 *
 * WHITE-LABEL POLICY (Phase 1, May 14 2026):
 * "Shopify model" — auth screen stays Waitless-branded (logo, LOG IN button,
 * tab pills, spinner). Once logged in, the dashboard adopts the venue's
 * primary + accent colors throughout. Background canvas stays Waitless dark
 * (#0a0a0a). Status colors (green/red/yellow) and card backgrounds unchanged.
 * 
 * Pre-login Waitless touchpoints (DO NOT venue-theme):
 * - S.authLogo gradient
 * - S.authButton gradient
 * - S.authTabActive blue
 * - S.spinner topColor
 * 
 * Post-login venue-themed elements (read from BRAND.primary / BRAND.accent):
 * - Header title gradient
 * - Active tab pill (border + background tint + text color)
 * - "SAVE SETTINGS" + other primary action button gradients
 * - "CONNECT SQUARE ACCOUNT" gradient
 * - Category headers (color + border)
 * - Menu item price color
 * - Various accent highlights
 * ============================================
 */
import { useState, useEffect } from "react";
import { supabase, getVenueOwnerSettings } from "./lib/barOrderService";
import QRGenerator from "./QRGenerator";
import AnalyticsView from "./AnalyticsView";
import BillingView from "./BillingView";
import EventsListView from "./EventsListView";
import EventEditorView from "./EventEditorView";
import TicketOrdersView from "./TicketOrdersView";

// ============================================
// VENUE-THEMED STYLE BUILDERS
// ============================================
// Style objects that depend on BRAND (the venue's color scheme).
// Built per-render because BRAND comes from props, not module scope.
// Naming convention: `vs` prefix (venue styles) so they don't shadow `S`.
function buildVenueStyles(BRAND) {
  const primary = BRAND.primary;
  const accent = BRAND.accent;
  return {
    headerTitle: {
      fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 4, margin: 0,
      background: `linear-gradient(135deg, ${primary}, ${accent})`,
      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    },
    tabActive: {
      background: `${primary}22`,
      borderColor: primary,
      color: primary,
    },
    saveBtn: {
      padding: "16px", borderRadius: 10, border: "none",
      background: `linear-gradient(135deg, ${primary}, ${accent})`,
      color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
      letterSpacing: 3, cursor: "pointer", marginTop: 8,
    },
    smallBtn: {
      padding: "8px 16px", borderRadius: 8, border: "none",
      background: primary,
      color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600,
      letterSpacing: 2, cursor: "pointer",
    },
    categoryHeaderText: {
      flex: 1, margin: 0, fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
      letterSpacing: 4,
      color: accent,
      textTransform: "uppercase", cursor: "pointer",
    },
    categoryHeaderRow: {
      display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8,
      borderBottom: `1px solid ${accent}4d`,
    },
    categoryHeaderInput: {
      flex: 1, padding: "6px 10px", background: "#141414",
      border: `1px solid ${accent}`,
      borderRadius: 6, color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 13,
      letterSpacing: 4, textTransform: "uppercase", outline: "none",
    },
    menuItemPrice: {
      fontFamily: "'Space Mono', monospace", fontSize: 14,
      color: accent,
    },
    addCategoryBtn: {
      padding: "12px 20px", borderRadius: 10,
      border: `1px dashed ${accent}66`,
      background: `${accent}08`,
      color: accent,
      fontFamily: "'Oswald', sans-serif",
      fontSize: 14, fontWeight: 500, letterSpacing: 2, cursor: "pointer", marginTop: 8,
    },
    previewLink: {
      fontFamily: "'Space Mono', monospace", fontSize: 11,
      color: accent,
      letterSpacing: 1, textDecoration: "none",
    },
    editorCard: {
      padding: 16, background: "#141414", borderRadius: 12,
      border: `1px solid ${primary}44`,
      display: "flex", flexDirection: "column", gap: 10, marginBottom: 8,
    },
    moveBtnEnabled: (enabled) => ({
      background: "transparent",
      border: `1px solid ${enabled ? accent : "#333"}`,
      borderRadius: 6,
      width: 28, height: 28, fontSize: 12, padding: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: enabled ? accent : "#333",
      cursor: enabled ? "pointer" : "not-allowed",
    }),
    categoryHeaderTextColor: accent,
    primaryColor: primary,
    accentColor: accent,
  };
}

export default function AdminView({ venue: initialVenue, BRAND }) {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [venue, setVenue] = useState(initialVenue);
  const [menu, setMenu] = useState([]);
  const [activeTab, setActiveTab] = useState("analytics"); // analytics | menu | events | settings | square | qr | billing
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  // Venue-themed styles (recomputed when BRAND changes — cheap)
  const vs = buildVenueStyles(BRAND);

  // Check for existing session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);
  // Load menu when authenticated
  useEffect(() => {
    if (!user || !venue) return;
    loadMenu();
  }, [user, venue?.id]);
  async function loadMenu() {
    const { data, error } = await supabase
      .from("menus")
      .select("*")
      .eq("venue_id", venue.id)
      .order("category")
      .order("sort_order");
    if (!error) setMenu(data || []);
  }
  // Load full venue data (including fields not in the public function)
  useEffect(() => {
    if (!user || !venue) return;
    async function loadFullVenue() {
      const { data } = await supabase
        .from("venues")
        .select("*")
        .eq("id", venue.id)
        .single();
      if (data) setVenue(data);
    }
    loadFullVenue();
  }, [user]);
  // Auth handlers
  const handleLogin = async () => {
    setAuthError(null);
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  };
  const handleSignup = async () => {
    setAuthError(null);
    setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setAuthError(error.message);
    } else {
      // Auto-claim venue if email matches
      if (data.user) {
        await supabase.rpc("claim_venue", { p_venue_id: venue.id, p_owner_email: email });
      }
    }
    setAuthLoading(false);
  };
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };
  // Flash save message
  const showSaved = (msg = "Saved") => {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(null), 2000);
  };
  // ---- AUTH SCREEN ---- (stays Waitless-branded per Shopify model)
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
        <div style={S.authCard}>
          <h1 style={S.authLogo}>WAITLESS</h1>
          <p style={S.authSub}>Venue Admin — {venue.name}</p>
          <div style={S.authTabs}>
            <button onClick={() => { setAuthMode("login"); setAuthError(null); }} style={{ ...S.authTab, ...(authMode === "login" ? S.authTabActive : {}) }}>Log In</button>
            <button onClick={() => { setAuthMode("signup"); setAuthError(null); }} style={{ ...S.authTab, ...(authMode === "signup" ? S.authTabActive : {}) }}>Sign Up</button>
          </div>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={S.input}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (authMode === "login" ? handleLogin() : handleSignup())}
            style={S.input}
          />
          {authError && <p style={S.error}>{authError}</p>}
          <button
            onClick={authMode === "login" ? handleLogin : handleSignup}
            style={S.authButton}
          >
            {authMode === "login" ? "LOG IN" : "SIGN UP"}
          </button>
        </div>
      </div>
    );
  }
  // ---- ADMIN DASHBOARD ---- (venue-themed post-login)
  return (
    <div style={S.container}>
      {/* Header — venue colors */}
      <div style={S.header}>
        <div>
          <h1 style={vs.headerTitle}>{venue.name?.toUpperCase()}</h1>
          <p style={S.headerSub}>Admin Dashboard</p>
        </div>
        <div style={S.headerRight}>
          {saveMessage && <span style={S.savedBadge}>{saveMessage}</span>}
          <button onClick={handleLogout} style={S.logoutBtn}>LOG OUT</button>
        </div>
      </div>
      {/* Tab nav — active pill uses venue colors */}
      <div style={S.tabBar}>
        {[
          { key: "analytics", label: "Analytics" },
          { key: "menu", label: "Menu" },
          { key: "events", label: "Events" },
          { key: "settings", label: "Settings" },
          { key: "ticket_orders", label: "Ticket Orders" },
          { key: "square", label: "Payments" },
          { key: "qr", label: "QR Code" },
          { key: "billing", label: "Billing" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{ ...S.tab, ...(activeTab === tab.key ? vs.tabActive : {}) }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Content */}
      <div style={S.content}>
        {activeTab === "analytics" && (
          <AnalyticsView venue={venue} BRAND={BRAND} />
        )}
        {activeTab === "menu" && (
          <MenuBuilder venue={venue} setVenue={setVenue} menu={menu} setMenu={setMenu} onSave={loadMenu} showSaved={showSaved} BRAND={BRAND} vs={vs} />
        )}
        {activeTab === "events" && (
          <EventsTab venue={venue} BRAND={BRAND} />
        )}
        {activeTab === "settings" && (
          <VenueSettings venue={venue} setVenue={setVenue} showSaved={showSaved} BRAND={BRAND} vs={vs} />
        )}
        {activeTab === "ticket_orders" && (<TicketOrdersView venue={venue} BRAND={BRAND} />)}

        {activeTab === "square" && (
          <SquareSettings venue={venue} setVenue={setVenue} showSaved={showSaved} BRAND={BRAND} vs={vs} />
        )}
        {activeTab === "qr" && (
          <QRGenerator venue={venue} BRAND={BRAND} embedded={true} />
        )}
        {activeTab === "billing" && (
          <BillingView venue={venue} BRAND={BRAND} />
        )}
      </div>
      {/* Preview link — accent color */}
      <div style={S.previewBar}>
        <a href={`/${venue.slug}`} target="_blank" rel="noopener noreferrer" style={vs.previewLink}>
          👁 Preview Patron View
        </a>
        <a href={`/${venue.slug}/bartender`} target="_blank" rel="noopener noreferrer" style={vs.previewLink}>
          👁 Preview Bartender View
        </a>
      </div>
    </div>
  );
}
// ============================================
// MENU BUILDER
// ============================================
function MenuBuilder({ venue, setVenue, menu, setMenu, onSave, showSaved, BRAND, vs }) {
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  // Modifier editor state — when modifierItemId is set, we show the mod editor
  // instead of the normal menu list
  const [modifierItemId, setModifierItemId] = useState(null);
  const [modGroups, setModGroups] = useState([]);
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingOption, setEditingOption] = useState(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  // ============================
  // CATEGORY ORDERING
  // ============================
  const orderedCategories = () => {
    const saved = Array.isArray(venue?.category_order) ? venue.category_order : [];
    const present = Array.from(new Set(menu.map((m) => m.category)));
    const extras = present.filter((c) => !saved.includes(c)).sort();
    return [...saved, ...extras];
  };
  const persistCategoryOrder = async (newOrder) => {
    const { error } = await supabase
      .from("venues")
      .update({ category_order: newOrder })
      .eq("id", venue.id);
    if (error) {
      console.error("Category order save failed:", error);
      showSaved("Order save failed");
      return;
    }
    setVenue((prev) => ({ ...prev, category_order: newOrder }));
  };
  const moveCategory = async (cat, direction) => {
    const current = orderedCategories();
    const idx = current.indexOf(cat);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= current.length) return;
    const reordered = [...current];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    await persistCategoryOrder(reordered);
  };
  const renameCategory = async (oldName, newName) => {
    const trimmed = (newName || "").trim();
    if (!trimmed || trimmed === oldName) return;
    const exists = menu.some((m) => m.category === trimmed);
    if (exists) {
      if (!confirm(`Category "${trimmed}" already exists. Merge "${oldName}" into it?`)) return;
    }
    const { error } = await supabase
      .from("menus")
      .update({ category: trimmed })
      .eq("venue_id", venue.id)
      .eq("category", oldName);
    if (error) { showSaved("Rename failed"); return; }
    const current = orderedCategories();
    const updatedOrder = Array.from(new Set(current.map((c) => (c === oldName ? trimmed : c))));
    await persistCategoryOrder(updatedOrder);
    await onSave();
    showSaved(`Renamed to "${trimmed}"`);
  };
  const deleteCategory = async (cat) => {
    const itemsInCat = menu.filter((m) => m.category === cat);
    const confirmText = itemsInCat.length > 0
      ? `Delete "${cat}" and all ${itemsInCat.length} item${itemsInCat.length === 1 ? "" : "s"} inside it? This cannot be undone.`
      : `Delete empty category "${cat}"?`;
    if (!confirm(confirmText)) return;
    if (itemsInCat.length > 0) {
      const { error } = await supabase
        .from("menus")
        .delete()
        .eq("venue_id", venue.id)
        .eq("category", cat);
      if (error) { showSaved("Delete failed"); return; }
    }
    const current = orderedCategories().filter((c) => c !== cat);
    await persistCategoryOrder(current);
    await onSave();
    showSaved(`Removed "${cat}"`);
  };
  const handleCreateEmptyCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    const current = orderedCategories();
    if (current.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      showSaved("Category already exists");
      setShowNewCategory(false);
      setNewCategory("");
      return;
    }
    const newOrder = [...current, trimmed];
    await persistCategoryOrder(newOrder);
    setShowNewCategory(false);
    setNewCategory("");
    showSaved(`Created "${trimmed}"`);
  };
  // ============================
  // ITEM HANDLERS
  // ============================
  const handleSaveItem = async (item) => {
    if (item.id) {
      const { error } = await supabase
        .from("menus")
        .update({
          item_name: item.item_name,
          description: item.description,
          price_cents: item.price_cents,
          category: item.category,
          sort_order: item.sort_order,
          active: item.active,
          station: item.station || "bar",
        })
        .eq("id", item.id);
      if (!error) { await onSave(); showSaved("Item updated"); }
    } else {
      const { error } = await supabase
        .from("menus")
        .insert({
          venue_id: venue.id,
          item_name: item.item_name,
          description: item.description || "",
          price_cents: item.price_cents,
          category: item.category,
          sort_order: item.sort_order || 0,
          active: true,
          station: item.station || "bar",
        });
      if (!error) { await onSave(); showSaved("Item added"); }
    }
    setEditingItem(null);
    setNewItem(null);
  };
  const handleDeleteItem = async (id) => {
    if (!confirm("Remove this item?")) return;
    const { error } = await supabase.from("menus").delete().eq("id", id);
    if (!error) { await onSave(); showSaved("Item removed"); }
  };
  const handleToggleActive = async (item) => {
    const { error } = await supabase
      .from("menus")
      .update({ active: !item.active })
      .eq("id", item.id);
    if (!error) { await onSave(); showSaved(item.active ? "Item hidden" : "Item visible"); }
  };
  // ============================
  // MODIFIER MANAGEMENT
  // ============================
  async function loadModifiers(menuItemId) {
    const { data: groups } = await supabase
      .from("menu_modifiers")
      .select("*")
      .eq("menu_item_id", menuItemId)
      .order("sort_order");
    if (!groups || groups.length === 0) { setModGroups([]); return; }
    const groupIds = groups.map((g) => g.id);
    const { data: options } = await supabase
      .from("modifier_options")
      .select("*")
      .in("modifier_id", groupIds)
      .order("sort_order");
    setModGroups(groups.map((g) => ({
      ...g,
      options: (options || []).filter((o) => o.modifier_id === g.id),
    })));
  }
  const openModifiers = async (itemId) => {
    setModifierItemId(itemId);
    await loadModifiers(itemId);
  };
  const closeModifiers = () => {
    setModifierItemId(null);
    setModGroups([]);
    setEditingGroup(null);
    setEditingOption(null);
    setNewGroupName("");
    setShowCopyPicker(false);
  };
  const addModGroup = async () => {
    if (!newGroupName.trim()) return;
    const { error } = await supabase.from("menu_modifiers").insert({
      menu_item_id: modifierItemId,
      group_name: newGroupName.trim(),
      required: false,
      max_selections: 1,
      sort_order: modGroups.length + 1,
    });
    if (error) { showSaved("Add failed"); return; }
    setNewGroupName("");
    await loadModifiers(modifierItemId);
    showSaved("Group added");
  };
  const updateModGroup = async (group) => {
    const { error } = await supabase
      .from("menu_modifiers")
      .update({
        group_name: group.group_name,
        required: group.required,
        max_selections: group.max_selections,
      })
      .eq("id", group.id);
    if (error) { showSaved("Update failed"); return; }
    await loadModifiers(modifierItemId);
    setEditingGroup(null);
    showSaved("Group updated");
  };
  const deleteModGroup = async (groupId) => {
    if (!confirm("Delete this modifier group and all its options?")) return;
    await supabase.from("modifier_options").delete().eq("modifier_id", groupId);
    const { error } = await supabase.from("menu_modifiers").delete().eq("id", groupId);
    if (error) { showSaved("Delete failed"); return; }
    await loadModifiers(modifierItemId);
    showSaved("Group removed");
  };
  const addOption = async (groupId) => {
    const { error } = await supabase.from("modifier_options").insert({
      modifier_id: groupId,
      option_name: "New Option",
      price_cents: 0,
      is_default: false,
      sort_order: 99,
    });
    if (error) { showSaved("Add failed"); return; }
    await loadModifiers(modifierItemId);
  };
  const updateOption = async (opt) => {
    const { error } = await supabase
      .from("modifier_options")
      .update({
        option_name: opt.option_name,
        price_cents: opt.price_cents,
        is_default: opt.is_default,
        sort_order: opt.sort_order,
      })
      .eq("id", opt.id);
    if (error) { showSaved("Update failed"); return; }
    await loadModifiers(modifierItemId);
    setEditingOption(null);
  };
  const deleteOption = async (optId) => {
    const { error } = await supabase.from("modifier_options").delete().eq("id", optId);
    if (error) { showSaved("Delete failed"); return; }
    await loadModifiers(modifierItemId);
  };
  const copyModifiersFromItem = async (sourceItemId) => {
    const { data: sourceGroups, error: gErr } = await supabase
      .from("menu_modifiers")
      .select("*")
      .eq("menu_item_id", sourceItemId)
      .order("sort_order");
    if (gErr || !sourceGroups || sourceGroups.length === 0) {
      showSaved("Source has no modifiers");
      setShowCopyPicker(false);
      return;
    }
    const sourceGroupIds = sourceGroups.map((g) => g.id);
    const { data: sourceOptions, error: oErr } = await supabase
      .from("modifier_options")
      .select("*")
      .in("modifier_id", sourceGroupIds)
      .order("sort_order");
    if (oErr) { showSaved("Copy failed"); return; }
    const baseSort = modGroups.length;
    for (let i = 0; i < sourceGroups.length; i++) {
      const g = sourceGroups[i];
      const { data: newGroupRows, error: insGErr } = await supabase
        .from("menu_modifiers")
        .insert({
          menu_item_id: modifierItemId,
          group_name: g.group_name,
          required: g.required,
          max_selections: g.max_selections,
          sort_order: baseSort + i + 1,
        })
        .select();
      if (insGErr || !newGroupRows || newGroupRows.length === 0) {
        showSaved("Copy failed mid-way");
        await loadModifiers(modifierItemId);
        setShowCopyPicker(false);
        return;
      }
      const newGroup = newGroupRows[0];
      const optionsForGroup = (sourceOptions || []).filter((o) => o.modifier_id === g.id);
      if (optionsForGroup.length > 0) {
        const newOptions = optionsForGroup.map((o) => ({
          modifier_id: newGroup.id,
          option_name: o.option_name,
          price_cents: o.price_cents,
          is_default: o.is_default,
          sort_order: o.sort_order,
        }));
        const { error: insOErr } = await supabase
          .from("modifier_options")
          .insert(newOptions);
        if (insOErr) {
          showSaved("Copied groups but options failed");
          await loadModifiers(modifierItemId);
          setShowCopyPicker(false);
          return;
        }
      }
    }
    await loadModifiers(modifierItemId);
    setShowCopyPicker(false);
    showSaved(`Copied ${sourceGroups.length} modifier group${sourceGroups.length === 1 ? "" : "s"}`);
  };
  const ordered = orderedCategories();
  const modifierItem = menu.find((m) => m.id === modifierItemId);
  const [copyCandidates, setCopyCandidates] = useState([]);
  useEffect(() => {
    if (!showCopyPicker || !venue?.id) return;
    async function loadCandidates() {
      const { data } = await supabase
        .from("menu_modifiers")
        .select("menu_item_id");
      if (!data) { setCopyCandidates([]); return; }
      const itemIdsWithMods = new Set(data.map((d) => d.menu_item_id));
      const candidates = menu.filter(
        (m) => itemIdsWithMods.has(m.id) && m.id !== modifierItemId
      );
      setCopyCandidates(candidates);
    }
    loadCandidates();
  }, [showCopyPicker, modifierItemId, venue?.id, menu]);
  // ---- MODIFIER EDITOR VIEW ----
  if (modifierItemId && modifierItem) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={closeModifiers} style={S.smallBtnDim}>← BACK TO MENU</button>
        </div>
        <h3 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>
          Modifiers — {modifierItem.item_name}
        </h3>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
          Customization options patrons can pick when ordering this item (e.g., Size, Mixer, Ice).
        </p>
        {/* Copy from another item — uses primary venue color */}
        {!showCopyPicker ? (
          <button
            onClick={() => setShowCopyPicker(true)}
            style={{
              padding: "10px 16px", borderRadius: 8,
              border: `1px dashed ${BRAND.primary}66`,
              background: `${BRAND.primary}11`,
              color: BRAND.primary,
              fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600,
              letterSpacing: 2, cursor: "pointer", width: "100%", marginBottom: 16,
            }}
          >
            📋 COPY MODIFIERS FROM ANOTHER ITEM
          </button>
        ) : (
          <div style={{
            padding: 14, background: "#0a0a0a",
            border: `1px solid ${BRAND.primary}44`,
            borderRadius: 10, marginBottom: 16, display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, letterSpacing: 2, color: BRAND.primary }}>
                COPY FROM WHICH ITEM?
              </span>
              <button onClick={() => setShowCopyPicker(false)} style={S.smallBtnDim}>CANCEL</button>
            </div>
            {copyCandidates.length === 0 ? (
              <p style={{ fontSize: 12, color: "#888", margin: "4px 0" }}>
                No other items have modifiers yet. Create some first, then you can copy them.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {copyCandidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => copyModifiersFromItem(c.id)}
                    style={{
                      padding: "10px 12px", background: "#141414", border: "1px solid #222",
                      borderRadius: 8, textAlign: "left", cursor: "pointer",
                      fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#f5f5f5",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <span>{c.item_name}</span>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#666" }}>
                      {c.category}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p style={{ fontSize: 11, color: "#666", margin: "4px 0 0", fontStyle: "italic" }}>
              This adds the modifier groups to your current item without replacing existing ones.
            </p>
          </div>
        )}
        {/* Existing modifier groups */}
        {modGroups.map((group) => (
          <div key={group.id} style={{
            marginBottom: 20, padding: 14, background: "#0a0a0a",
            borderRadius: 10, border: "1px solid #1a1a1a",
          }}>
            {/* Group header */}
            {editingGroup?.id === group.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                <input
                  value={editingGroup.group_name}
                  onChange={(e) => setEditingGroup({ ...editingGroup, group_name: e.target.value })}
                  style={S.input}
                  placeholder="Group name (e.g., Size, Ice, Mixer)"
                />
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={editingGroup.required}
                      onChange={(e) => setEditingGroup({ ...editingGroup, required: e.target.checked })}
                    />
                    Required
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa" }}>
                    Max picks:
                    <input
                      type="number" min="1" max="10"
                      value={editingGroup.max_selections}
                      onChange={(e) => setEditingGroup({ ...editingGroup, max_selections: parseInt(e.target.value || 1) })}
                      style={{ ...S.input, width: 60, padding: "6px 8px" }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button onClick={() => setEditingGroup(null)} style={S.smallBtnDim}>CANCEL</button>
                  <button onClick={() => updateModGroup(editingGroup)} style={vs.smallBtn}>SAVE</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: 1, color: BRAND.accent }}>
                    {group.group_name}
                  </span>
                  <span style={{ fontSize: 10, color: "#666", marginLeft: 8, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>
                    {group.required ? "REQUIRED" : "OPTIONAL"} · {group.max_selections > 1 ? `Pick up to ${group.max_selections}` : "Pick 1"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setEditingGroup({ ...group })} style={S.iconBtn} title="Edit group">✏️</button>
                  <button onClick={() => deleteModGroup(group.id)} style={S.iconBtn} title="Delete group">🗑</button>
                </div>
              </div>
            )}
            {/* Options list */}
            {group.options.map((opt) =>
              editingOption?.id === opt.id ? (
                <div key={opt.id} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    value={editingOption.option_name}
                    onChange={(e) => setEditingOption({ ...editingOption, option_name: e.target.value })}
                    style={{ ...S.input, flex: 1, minWidth: 120 }}
                    placeholder="Option name"
                  />
                  <input
                    type="number" step="0.01"
                    value={(editingOption.price_cents / 100).toFixed(2)}
                    onChange={(e) => setEditingOption({ ...editingOption, price_cents: Math.round(parseFloat(e.target.value || 0) * 100) })}
                    style={{ ...S.input, width: 80 }}
                    placeholder="+$"
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#888", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={editingOption.is_default}
                      onChange={(e) => setEditingOption({ ...editingOption, is_default: e.target.checked })}
                    />
                    Default
                  </label>
                  <button onClick={() => updateOption(editingOption)} style={{ ...vs.smallBtn, padding: "6px 12px", fontSize: 11 }}>OK</button>
                  <button onClick={() => setEditingOption(null)} style={{ ...S.smallBtnDim, padding: "6px 12px", fontSize: 11 }}>×</button>
                </div>
              ) : (
                <div key={opt.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  marginBottom: 4, borderRadius: 6, background: "#141414",
                }}>
                  <span style={{ flex: 1, fontSize: 13, color: "#ccc" }}>{opt.option_name}</span>
                  {opt.price_cents !== 0 && (
                    <span style={{
                      fontSize: 11,
                      color: opt.price_cents > 0 ? BRAND.accent : "#2ecc71",
                      fontFamily: "'Space Mono', monospace",
                    }}>
                      {opt.price_cents > 0 ? "+" : ""}${(opt.price_cents / 100).toFixed(2)}
                    </span>
                  )}
                  {opt.is_default && (
                    <span style={{
                      fontSize: 8, color: BRAND.primary,
                      fontFamily: "'Space Mono', monospace", letterSpacing: 1,
                      padding: "1px 6px", background: `${BRAND.primary}22`, borderRadius: 4,
                    }}>
                      DEFAULT
                    </span>
                  )}
                  <button onClick={() => setEditingOption({ ...opt })} style={S.iconBtn}>✏️</button>
                  <button onClick={() => deleteOption(opt.id)} style={S.iconBtn}>🗑</button>
                </div>
              )
            )}
            <button
              onClick={() => addOption(group.id)}
              style={{
                marginTop: 6, padding: "6px 12px", borderRadius: 6,
                border: "1px dashed #333", background: "transparent", color: "#666",
                fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer",
              }}
            >
              + Add Option
            </button>
          </div>
        ))}
        {/* Add new modifier group */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            placeholder="New group (e.g., Size, Mixer, Temperature)"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addModGroup()}
            style={{ ...S.input, flex: 1 }}
          />
          <button onClick={addModGroup} style={vs.smallBtn}>ADD GROUP</button>
        </div>
      </div>
    );
  }
  // ---- NORMAL MENU LIST VIEW ----
  return (
    <div>
      {/* NEW CATEGORY BUTTON */}
      {showNewCategory ? (
        <div style={{ ...S.newCategoryRow, marginTop: 0, marginBottom: 24 }}>
          <input
            type="text"
            placeholder="Category name (e.g., Signature Cocktails)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCategory.trim()) {
                handleCreateEmptyCategory();
              }
            }}
            autoFocus
            style={S.input}
          />
          <button
            onClick={handleCreateEmptyCategory}
            style={vs.smallBtn}
          >
            CREATE
          </button>
          <button onClick={() => { setShowNewCategory(false); setNewCategory(""); }} style={S.smallBtnDim}>CANCEL</button>
        </div>
      ) : (
        <button onClick={() => setShowNewCategory(true)} style={{ ...vs.addCategoryBtn, marginTop: 0, marginBottom: 24, width: "100%" }}>
          + New Category
        </button>
      )}
      {/* EXISTING CATEGORIES WITH MANAGEMENT CONTROLS */}
      {ordered.map((cat, catIdx) => (
        <div key={cat} style={S.menuSection}>
          <CategoryHeader
            cat={cat}
            itemCount={menu.filter((m) => m.category === cat).length}
            onRename={(newName) => renameCategory(cat, newName)}
            onDelete={() => deleteCategory(cat)}
            onMoveUp={() => moveCategory(cat, "up")}
            onMoveDown={() => moveCategory(cat, "down")}
            canMoveUp={catIdx > 0}
            canMoveDown={catIdx < ordered.length - 1}
            vs={vs}
            BRAND={BRAND}
          />
          {menu.filter((m) => m.category === cat).map((item) => (
            editingItem?.id === item.id ? (
              <ItemEditor
                key={item.id}
                item={editingItem}
                categories={ordered}
                onChange={setEditingItem}
                onSave={() => handleSaveItem(editingItem)}
                onCancel={() => setEditingItem(null)}
                vs={vs}
                BRAND={BRAND}
              />
            ) : (
              <div key={item.id} style={{ ...S.menuRow, opacity: item.active ? 1 : 0.5 }}>
                <div style={S.menuRowLeft}>
                  <span style={S.menuItemName}>{item.item_name}</span>
                  {item.description && <span style={S.menuItemDesc}>{item.description}</span>}
                </div>
                <div style={S.menuRowRight}>
                  <span style={vs.menuItemPrice}>${(item.price_cents / 100).toFixed(2)}</span>
                  <button
                    onClick={() => openModifiers(item.id)}
                    style={{
                      background: "transparent",
                      border: `1px solid ${BRAND.accent}33`,
                      borderRadius: 4, padding: "3px 8px",
                      color: BRAND.accent,
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 9, letterSpacing: 1, cursor: "pointer",
                    }}
                    title="Edit modifiers for this item"
                  >
                    MODS
                  </button>
                  <button onClick={() => handleToggleActive(item)} style={S.iconBtn} title={item.active ? "Hide" : "Show"}>
                    {item.active ? "👁" : "🚫"}
                  </button>
                  <button onClick={() => setEditingItem({ ...item })} style={S.iconBtn} title="Edit">✏️</button>
                  <button onClick={() => handleDeleteItem(item.id)} style={S.iconBtn} title="Delete">🗑</button>
                </div>
              </div>
            )
          ))}
          {/* Add item to this category */}
          <button
            onClick={() => setNewItem({ item_name: "", description: "", price_cents: 0, category: cat, sort_order: menu.filter((m) => m.category === cat).length + 1, station: "bar" })}
            style={S.addItemBtn}
          >
            + Add item to {cat}
          </button>
        </div>
      ))}
      {/* New item editor */}
      {newItem && (
        <div style={S.menuSection}>
          <ItemEditor
            item={newItem}
            categories={ordered.length > 0 ? ordered : [newItem.category]}
            onChange={setNewItem}
            onSave={() => handleSaveItem(newItem)}
            onCancel={() => setNewItem(null)}
            vs={vs}
            BRAND={BRAND}
          />
        </div>
      )}
    </div>
  );
}
// ============================================
// CATEGORY HEADER
// ============================================
function CategoryHeader({ cat, itemCount, onRename, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown, vs, BRAND }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cat);
  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== cat) {
      onRename(trimmed);
    } else {
      setDraft(cat);
    }
  };
  const cancel = () => {
    setEditing(false);
    setDraft(cat);
  };
  return (
    <div style={vs.categoryHeaderRow}>
      {editing ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          autoFocus
          style={vs.categoryHeaderInput}
        />
      ) : (
        <h3
          style={vs.categoryHeaderText}
          onClick={() => setEditing(true)}
          title="Click to rename"
        >
          {cat} <span style={S.categoryItemCount}>({itemCount})</span>
        </h3>
      )}
      <div style={S.categoryControls}>
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          style={vs.moveBtnEnabled(canMoveUp)}
          title="Move category up"
        >
          ↑
        </button>
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          style={vs.moveBtnEnabled(canMoveDown)}
          title="Move category down"
        >
          ↓
        </button>
        <button
          onClick={() => setEditing(true)}
          style={{ ...S.categoryCtrlBtn, color: "#888" }}
          title="Rename category"
        >
          ✏️
        </button>
        <button
          onClick={onDelete}
          style={{ ...S.categoryCtrlBtn, color: "#e74c3c", borderColor: "#e74c3c44" }}
          title="Delete category"
        >
          🗑
        </button>
      </div>
    </div>
  );
}
// ============================================
// ITEM EDITOR
// ============================================
function ItemEditor({ item, categories, onChange, onSave, onCancel, vs, BRAND }) {
  return (
    <div style={vs.editorCard}>
      <input
        type="text"
        placeholder="Item name"
        value={item.item_name}
        onChange={(e) => onChange({ ...item, item_name: e.target.value })}
        style={S.input}
      />
      <input
        type="text"
        placeholder="Description (optional)"
        value={item.description || ""}
        onChange={(e) => onChange({ ...item, description: e.target.value })}
        style={S.input}
      />
      <div style={S.editorRow}>
        <div style={S.editorField}>
          <label style={S.label}>Price ($)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={(item.price_cents / 100).toFixed(2)}
            onChange={(e) => onChange({ ...item, price_cents: Math.round(parseFloat(e.target.value || 0) * 100) })}
            style={S.input}
          />
        </div>
        <div style={S.editorField}>
          <label style={S.label}>Category</label>
          <select
            value={item.category}
            onChange={(e) => onChange({ ...item, category: e.target.value })}
            style={S.select}
          >
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={S.editorField}>
          <label style={S.label}>Order</label>
          <input
            type="number"
            value={item.sort_order}
            onChange={(e) => onChange({ ...item, sort_order: parseInt(e.target.value || 0) })}
            style={{ ...S.input, width: 60 }}
          />
        </div>
      </div>
      <div style={S.editorField}>
        <label style={S.label}>Station</label>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { value: "bar", label: "Bar (21+)", color: "#e91e8c" },
            { value: "non-alc", label: "Non-Alcoholic", color: "#d4a843" },
            { value: "kitchen", label: "Kitchen", color: "#2ecc71" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...item, station: opt.value })}
              style={{
                flex: 1,
                padding: "8px 6px",
                borderRadius: 8,
                border: `1px solid ${(item.station || "bar") === opt.value ? opt.color : "#333"}`,
                background: (item.station || "bar") === opt.value ? `${opt.color}22` : "transparent",
                color: (item.station || "bar") === opt.value ? opt.color : "#888",
                fontFamily: "'Oswald', sans-serif",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div style={S.editorActions}>
        <button onClick={onCancel} style={S.smallBtnDim}>CANCEL</button>
        <button onClick={onSave} style={vs.smallBtn} disabled={!item.item_name || !item.price_cents}>SAVE</button>
      </div>
    </div>
  );
}
// ============================================
// VENUE SETTINGS
// ============================================
function VenueSettings({ venue, setVenue, showSaved, BRAND, vs }) {
  const [form, setForm] = useState({
    name: venue.name || "",
    tagline: venue.tagline || "",
    bartender_pin: venue.bartender_pin || "0000",
    manager_pin: "",
    door_pin: "",
    service_fee_percent: venue.service_fee_percent || 5,
    patron_font: venue.patron_font || "Inter",
    primary: venue.brand_colors?.primary || "#1E4D8C",
    accent: venue.brand_colors?.accent || "#d4a843",
    background: venue.brand_colors?.background || "#0a0a0a",
  });

  // The PINs are not part of the public venue payload — they're owner-only,
  // fetched here against the signed-in admin session. Without this the fields
  // would silently reset and saving would overwrite the real PINs.
  const [pinLoaded, setPinLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await getVenueOwnerSettings(venue.id);
      if (cancelled || !settings) return;
      setForm((f) => ({
        ...f,
        bartender_pin: settings.bartender_pin || f.bartender_pin,
        // Blank means "unset" — the role falls back to the bartender PIN.
        manager_pin: settings.manager_pin || "",
        door_pin: settings.door_pin || "",
      }));
      setPinLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [venue.id]);
  const handleSave = async () => {
    const { error } = await supabase
      .from("venues")
      .update({
        name: form.name,
        tagline: form.tagline,
        // Omit the PINs until the owner-only fetch has confirmed the real
        // ones. The bartender field defaults to "0000" and the role fields
        // to blank, so saving before they land would silently reset the
        // PINs and lock staff out.
        // A blank role PIN is written as NULL, not "", so verify_staff_pin
        // treats it as unset and falls back to the bartender PIN.
        ...(pinLoaded ? {
          bartender_pin: form.bartender_pin,
          manager_pin: form.manager_pin || null,
          door_pin: form.door_pin || null,
        } : {}),
        service_fee_percent: form.service_fee_percent,
        patron_font: form.patron_font,
        brand_colors: {
          primary: form.primary,
          accent: form.accent,
          background: form.background,
        },
      })
      .eq("id", venue.id);
    if (!error) {
     setVenue((prev) => ({
        ...prev,
        name: form.name,
        tagline: form.tagline,
        bartender_pin: form.bartender_pin,
        service_fee_percent: form.service_fee_percent,
        patron_font: form.patron_font,
        brand_colors: { primary: form.primary, accent: form.accent, background: form.background },
      }));
      showSaved("Settings saved");
    }
  };
  return (
    <div style={S.settingsGrid}>
      <div style={S.settingsField}>
        <label style={S.label}>Venue Name</label>
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={S.input} />
      </div>
      <div style={S.settingsField}>
        <label style={S.label}>Tagline</label>
        <input type="text" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} style={S.input} placeholder="e.g., Baltimore's Premium Mobile Bar" />
      </div>
      <div style={S.settingsRow}>
        <div style={S.settingsField}>
          <label style={S.label}>Bartender PIN</label>
          <input type="text" maxLength={4} value={form.bartender_pin} onChange={(e) => setForm({ ...form, bartender_pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={S.input} />
        </div>
        <div style={S.settingsField}>
          <label style={S.label}>Service Fee %</label>
          <input type="number" step="0.5" min="0" max="30" value={form.service_fee_percent} onChange={(e) => setForm({ ...form, service_fee_percent: parseFloat(e.target.value || 0) })} style={S.input} />
        </div>
      </div>
      {/* Optional per-role PINs. Blank = that screen keeps using the
          bartender PIN above, which is why nothing breaks on upgrade. */}
      <div style={S.settingsRow}>
        <div style={S.settingsField}>
          <label style={S.label}>Manager PIN</label>
          <input type="text" maxLength={4} value={form.manager_pin} onChange={(e) => setForm({ ...form, manager_pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={S.input} placeholder="Optional" />
        </div>
        <div style={S.settingsField}>
          <label style={S.label}>Door PIN</label>
          <input type="text" maxLength={4} value={form.door_pin} onChange={(e) => setForm({ ...form, door_pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={S.input} placeholder="Optional" />
        </div>
      </div>
      <p style={S.settingsHint}>
        Manager PIN opens the order queue, Door PIN opens the ticket scanner.
        Leave either blank to keep using the bartender PIN for that screen.
        Once you set one, the bartender PIN no longer opens it.
      </p>
     <div style={S.settingsField}>
        <label style={S.label}>Patron Menu Font</label>
        <select
          value={form.patron_font || "Inter"}
          onChange={(e) => setForm({ ...form, patron_font: e.target.value })}
          style={S.select}
        >
          <optgroup label="Clean & Modern">
            <option value="Inter">Inter — Universally legible (default)</option>
            <option value="Space Grotesk">Space Grotesk — Modern with character</option>
            <option value="Montserrat">Montserrat — Friendly geometric</option>
          </optgroup>
          <optgroup label="Bold Display">
            <option value="Oswald">Oswald — Bold condensed</option>
            <option value="Bebas Neue">Bebas Neue — All-caps display</option>
            <option value="Bungee">Bungee — Chunky street signage</option>
          </optgroup>
          <optgroup label="Vintage & Handcrafted">
            <option value="Rye">Rye — Western saloon</option>
            <option value="Special Elite">Special Elite — Vintage typewriter</option>
            <option value="Caveat">Caveat — Handwritten</option>
          </optgroup>
          <optgroup label="Elegant & Refined">
            <option value="Playfair Display">Playfair Display — Editorial serif</option>
            <option value="Cinzel">Cinzel — Roman inscription</option>
          </optgroup>
          <optgroup label="Futuristic">
            <option value="Audiowide">Audiowide — Retro-futurism</option>
          </optgroup>
        </select>
        <p style={{ fontSize: 11, color: "#666", margin: "6px 0 0", lineHeight: 1.5 }}>
          Used for your venue name + section headers on patron-facing pages (menu, ticket buy, confirmation). Item names and prices stay readable regardless of choice.
        </p>
      </div>
      <div style={S.settingsField}>
        <label style={S.label}>Brand Colors</label>
        <div style={S.colorRow}>
          <div style={S.colorField}>
            <label style={S.colorLabel}>Primary</label>
            <div style={S.colorInputWrap}>
              <input type="color" value={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.value })} style={S.colorInput} />
              <input type="text" value={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.value })} style={S.colorText} />
            </div>
          </div>
          <div style={S.colorField}>
            <label style={S.colorLabel}>Accent</label>
            <div style={S.colorInputWrap}>
              <input type="color" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} style={S.colorInput} />
              <input type="text" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} style={S.colorText} />
            </div>
          </div>
          <div style={S.colorField}>
            <label style={S.colorLabel}>Background</label>
            <div style={S.colorInputWrap}>
              <input type="color" value={form.background} onChange={(e) => setForm({ ...form, background: e.target.value })} style={S.colorInput} />
              <input type="text" value={form.background} onChange={(e) => setForm({ ...form, background: e.target.value })} style={S.colorText} />
            </div>
          </div>
        </div>
      </div>
      {/* Preview swatch — uses current form values (live preview) */}
      <div style={{ padding: 20, borderRadius: 14, background: form.background, border: "1px solid #333", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 4, background: `linear-gradient(135deg, ${form.primary}, ${form.accent})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{form.name?.toUpperCase() || "PREVIEW"}</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 2 }}>{form.tagline?.toUpperCase() || "YOUR TAGLINE"}</span>
      </div>
      <button onClick={handleSave} style={vs.saveBtn}>SAVE SETTINGS</button>
    </div>
  );
}
// ============================================
// SQUARE SETTINGS
// ============================================
function SquareSettings({ venue, setVenue, showSaved, BRAND, vs }) {
  const [form, setForm] = useState({
    square_app_id: venue.square_app_id || "",
    square_access_token: venue.square_access_token || "",
    square_location_id: venue.square_location_id || "",
    square_environment: venue.square_environment || "sandbox",
  });
  const [showManual, setShowManual] = useState(false);
  // Square credentials are owner-only and no longer arrive on the public
  // venue payload, so load them against the signed-in admin session.
  const [ownerSettings, setOwnerSettings] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await getVenueOwnerSettings(venue.id);
      if (cancelled || !settings) return;
      setOwnerSettings(settings);
      setForm((f) => ({
        ...f,
        square_app_id: settings.square_app_id || f.square_app_id,
        square_access_token: settings.square_access_token || "",
        square_location_id: settings.square_location_id || f.square_location_id,
        square_environment: settings.square_environment || f.square_environment,
      }));
    })();
    return () => { cancelled = true; };
  }, [venue.id]);

  // Check for OAuth callback result
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("square") === "connected") {
      showSaved("Square connected successfully!");
      async function reload() {
        const { data } = await supabase
          .from("venues")
          .select("*")
          .eq("id", venue.id)
          .single();
        if (data) {
          setVenue(data);
          setForm({
            square_app_id: data.square_app_id || "",
            square_access_token: data.square_access_token || "",
            square_location_id: data.square_location_id || "",
            square_environment: data.square_environment || "sandbox",
          });
        }
      }
      reload();
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (urlParams.get("error")) {
      alert("Square connection failed: " + urlParams.get("error"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const handleOAuthConnect = () => {
    const appId = "sq0idp-U-HGTJSyL66_0cvWAb1OkQ";
    const redirectUri = encodeURIComponent(`${window.location.origin}/.netlify/functions/square-oauth-callback`);
    const scope = encodeURIComponent("MERCHANT_PROFILE_READ PAYMENTS_WRITE PAYMENTS_READ ORDERS_WRITE ORDERS_READ ITEMS_READ ITEMS_WRITE");
    const state = venue.id;
    const authUrl = `https://connect.squareup.com/oauth2/authorize?client_id=${appId}&scope=${scope}&session=false&state=${state}&redirect_uri=${redirectUri}`;
    window.location.href = authUrl;
  };
  const handleDisconnect = async () => {
    if (!confirm("Disconnect Square? This will disable live payments and switch to demo mode.")) return;
    const { error } = await supabase
      .from("venues")
      .update({
        square_app_id: null,
        square_access_token: null,
        square_location_id: null,
        square_environment: "sandbox",
      })
      .eq("id", venue.id);
    if (!error) {
      setForm({ square_app_id: "", square_access_token: "", square_location_id: "", square_environment: "sandbox" });
      setVenue((prev) => ({ ...prev, square_app_id: null, square_access_token: null, square_location_id: null, square_environment: "sandbox" }));
      showSaved("Square disconnected");
    }
  };
  const handleManualSave = async () => {
    const patch = {
      square_app_id: form.square_app_id,
      square_location_id: form.square_location_id,
      square_environment: form.square_environment,
    };
    // Only write the token when one was actually typed. The field starts
    // empty until the owner-only fetch lands, so blindly sending it would
    // let a quick save blank out a working Square connection.
    if (form.square_access_token) {
      patch.square_access_token = form.square_access_token;
    }

    const { error } = await supabase
      .from("venues")
      .update(patch)
      .eq("id", venue.id);
    if (!error) {
      setVenue((prev) => ({ ...prev, ...form }));
      showSaved("Payment settings saved");
    }
  };
  // Derived from the owner-only fetch rather than the public venue payload,
  // which no longer carries the access token.
  const isConfigured = Boolean(
    (ownerSettings?.square_app_id || venue.square_app_id) &&
    ownerSettings?.square_access_token &&
    (ownerSettings?.square_location_id || venue.square_location_id)
  );
  return (
    <div style={S.settingsGrid}>
      {/* Status badge — green/gold status colors stay unchanged */}
      <div style={{ padding: "16px", borderRadius: 10, background: isConfigured ? "#2ecc7115" : "#d4a84315", border: `1px solid ${isConfigured ? "#2ecc7133" : "#d4a84333"}`, marginBottom: 8 }}>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: isConfigured ? "#2ecc71" : "#d4a843", letterSpacing: 2 }}>
          {isConfigured ? "✓ SQUARE CONNECTED — LIVE PAYMENTS ACTIVE" : "⚠ SQUARE NOT CONFIGURED — RUNNING IN DEMO MODE"}
        </span>
      </div>
      {isConfigured ? (
        /* Connected state */
        <>
          <div style={{ padding: "20px", background: "#141414", borderRadius: 12, border: "1px solid #222", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 600, letterSpacing: 1 }}>Square Payments</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#2ecc71", letterSpacing: 1, marginTop: 4 }}>CONNECTED · {venue.square_environment?.toUpperCase()}</div>
              </div>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: "#2ecc7122", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✓</div>
            </div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#666" }}>
              Location: {venue.square_location_id}
            </div>
          </div>
          <button onClick={handleDisconnect} style={{ ...S.smallBtnDim, alignSelf: "flex-start" }}>
            DISCONNECT SQUARE
          </button>
        </>
      ) : (
        /* Not connected state */
        <>
          {/* OAuth button — venue colors */}
          <div style={{ padding: "24px", background: "#141414", borderRadius: 14, border: "1px solid #222", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 36 }}>💳</div>
            <h3 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 600, letterSpacing: 2, margin: 0 }}>Connect Square</h3>
            <p style={{ fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.6, margin: 0 }}>
              Click below to securely connect your Square account. You'll be redirected to Square to authorize Waitless, then sent right back.
            </p>
            <button onClick={handleOAuthConnect} style={vs.saveBtn}>
              🔗 CONNECT SQUARE ACCOUNT
            </button>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 1, margin: 0 }}>
              YOUR CREDENTIALS STAY SECURE · PAYMENTS GO DIRECTLY TO YOUR BANK
            </p>
          </div>
          {/* Manual entry fallback */}
          <button onClick={() => setShowManual(!showManual)} style={{ ...S.smallBtnDim, alignSelf: "center", marginTop: 8 }}>
            {showManual ? "HIDE MANUAL SETUP" : "OR ENTER CREDENTIALS MANUALLY"}
          </button>
          {showManual && (
            <div style={{ padding: "20px", background: "#0a0a0a", borderRadius: 12, border: "1px solid #1a1a1a", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={S.settingsField}>
                <label style={S.label}>Square Application ID</label>
                <input type="text" value={form.square_app_id} onChange={(e) => setForm({ ...form, square_app_id: e.target.value })} style={S.input} placeholder="sq0idp-..." />
              </div>
              <div style={S.settingsField}>
                <label style={S.label}>Square Access Token</label>
                <input type="password" value={form.square_access_token} onChange={(e) => setForm({ ...form, square_access_token: e.target.value })} style={S.input} placeholder="EAAAl..." />
              </div>
              <div style={S.settingsField}>
                <label style={S.label}>Square Location ID</label>
                <input type="text" value={form.square_location_id} onChange={(e) => setForm({ ...form, square_location_id: e.target.value })} style={S.input} placeholder="L..." />
              </div>
              <div style={S.settingsField}>
                <label style={S.label}>Environment</label>
                <select value={form.square_environment} onChange={(e) => setForm({ ...form, square_environment: e.target.value })} style={S.select}>
                  <option value="sandbox">Sandbox (Testing)</option>
                  <option value="production">Production (Live)</option>
                </select>
              </div>
              <p style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                Find your credentials at <a href="https://developer.squareup.com" target="_blank" rel="noopener noreferrer" style={{ color: BRAND.accent }}>developer.squareup.com</a>
              </p>
              <button onClick={handleManualSave} style={vs.saveBtn}>SAVE PAYMENT SETTINGS</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
// ============================================
// EVENTS TAB
// ============================================
function EventsTab({ venue, BRAND }) {
  const [editingEventId, setEditingEventId] = useState(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const handleCreate = () => setEditingEventId("new");
  const handleEdit = (eventId) => setEditingEventId(eventId);
  const handleClose = () => {
    setEditingEventId(null);
    setListRefreshKey((k) => k + 1);
  };
  if (editingEventId !== null) {
    return (
      <EventEditorView
        venue={venue}
        BRAND={BRAND}
        eventId={editingEventId === "new" ? null : editingEventId}
        onClose={handleClose}
      />
    );
  }
  return (
    <EventsListView
      key={listRefreshKey}
      venue={venue}
      BRAND={BRAND}
      onCreateEvent={handleCreate}
      onEditEvent={handleEdit}
    />
  );
}
// ============================================
// STATIC STYLES (S)
// ============================================
// These don't depend on the venue's brand colors. Anything that DID get
// venue-themed lives in buildVenueStyles(BRAND) at the top of this file.
//
// Pre-login auth elements (S.authLogo, S.authButton, S.authTabActive,
// S.spinner) intentionally keep Waitless brand colors — see "Shopify model"
// note in file header.
const S = {
  centered: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f5", padding: 24,
  },
  spinner: {
    width: 40, height: 40, borderRadius: "50%", border: "3px solid #222",
    borderTopColor: "#1E4D8C", animation: "spin 1s linear infinite",
  },
  // Auth — Waitless-branded (Shopify model)
  authCard: {
    background: "#141414", borderRadius: 20, padding: "36px 28px", maxWidth: 360, width: "100%",
    display: "flex", flexDirection: "column", gap: 16, border: "1px solid #222",
  },
  authLogo: {
    fontFamily: "'Oswald', sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: 4,
    textAlign: "center", margin: 0,
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  authSub: {
    fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", textAlign: "center",
    letterSpacing: 2, margin: 0, textTransform: "uppercase",
  },
  authTabs: { display: "flex", gap: 8 },
  authTab: {
    flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #333", background: "transparent",
    color: "#888", fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600,
    letterSpacing: 2, cursor: "pointer",
  },
  authTabActive: { background: "#1E4D8C22", borderColor: "#1E4D8C", color: "#1E4D8C" },
  authButton: {
    padding: "14px", borderRadius: 10, border: "none",
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
    letterSpacing: 3, cursor: "pointer",
  },
  // Layout
  container: { maxWidth: 720, margin: "0 auto", padding: "0 20px 80px", minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f5" },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "20px 0", borderBottom: "1px solid #222",
  },
  headerSub: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 2, margin: "2px 0 0", textTransform: "uppercase" },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  savedBadge: {
    fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#2ecc71", letterSpacing: 2,
    padding: "4px 10px", background: "#2ecc7115", borderRadius: 6, border: "1px solid #2ecc7133",
  },
  logoutBtn: {
    background: "transparent", border: "1px solid #333", borderRadius: 8, padding: "6px 14px",
    color: "#666", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer",
  },
  // Tabs — base style (active state via vs.tabActive)
  tabBar: {
    display: "flex",
    gap: 8,
    padding: "16px 0",
    borderBottom: "1px solid #222",
    overflowX: "auto",
    overflowY: "hidden",
    flexWrap: "nowrap",
    WebkitOverflowScrolling: "touch",
    scrollbarWidth: "thin",
  },
  tab: {
    padding: "10px 20px", borderRadius: 10, border: "1px solid #333", background: "transparent",
    color: "#888", fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500,
    letterSpacing: 2, cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  content: { padding: "20px 0" },
  // Menu builder
  menuSection: { marginBottom: 28 },
  categoryItemCount: {
    fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#666",
    letterSpacing: 1, marginLeft: 6, textTransform: "none",
  },
  categoryControls: { display: "flex", gap: 4 },
  categoryCtrlBtn: {
    background: "transparent", border: "1px solid #333", borderRadius: 6,
    width: 28, height: 28, fontSize: 12, padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  menuRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 14px", background: "#1a1a1a", borderRadius: 10, border: "1px solid #222", marginBottom: 6,
  },
  menuRowLeft: { display: "flex", flexDirection: "column", gap: 2 },
  menuItemName: { fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 500, letterSpacing: 0.5 },
  menuItemDesc: { fontSize: 12, color: "#888" },
  menuRowRight: { display: "flex", alignItems: "center", gap: 10 },
  iconBtn: {
    background: "transparent", border: "none", fontSize: 14, cursor: "pointer", padding: 4,
    filter: "grayscale(0.5)", transition: "filter 0.2s",
  },
  addItemBtn: {
    width: "100%", padding: "10px", borderRadius: 8, border: "1px dashed #333",
    background: "transparent", color: "#666", fontFamily: "'Space Mono', monospace",
    fontSize: 11, letterSpacing: 1, cursor: "pointer", marginTop: 6,
  },
  // Item editor
  editorRow: { display: "flex", gap: 10 },
  editorField: { flex: 1, display: "flex", flexDirection: "column", gap: 4 },
  editorActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  // New category
  newCategoryRow: { display: "flex", gap: 10, alignItems: "center", marginTop: 12 },
  // Inputs
  input: {
    padding: "12px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 8,
    color: "#f5f5f5", fontFamily: "'Inter', sans-serif", fontSize: 14, outline: "none",
    width: "100%",
  },
  select: {
    padding: "12px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 8,
    color: "#f5f5f5", fontFamily: "'Inter', sans-serif", fontSize: 14, outline: "none",
    width: "100%",
  },
  label: { fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#888", letterSpacing: 1, textTransform: "uppercase" },
  error: { color: "#e74c3c", fontSize: 13, margin: 0, textAlign: "center" },
  // Settings
  settingsGrid: { display: "flex", flexDirection: "column", gap: 16 },
  settingsField: { display: "flex", flexDirection: "column", gap: 6 },
  settingsRow: { display: "flex", gap: 16 },
  settingsHint: { fontFamily: "'Inter', sans-serif", fontSize: 12, lineHeight: 1.5, color: "#777", margin: "-6px 0 0" },
  // Colors
  colorRow: { display: "flex", gap: 12, flexWrap: "wrap" },
  colorField: { display: "flex", flexDirection: "column", gap: 4 },
  colorLabel: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 1 },
  colorInputWrap: { display: "flex", alignItems: "center", gap: 6 },
  colorInput: { width: 36, height: 36, border: "none", borderRadius: 6, cursor: "pointer", background: "transparent" },
  colorText: {
    padding: "8px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 6,
    color: "#f5f5f5", fontFamily: "'Space Mono', monospace", fontSize: 12, width: 80, outline: "none",
  },
  // Buttons — smallBtnDim is neutral, smallBtn is in vs.smallBtn (venue-themed)
  smallBtnDim: {
    padding: "8px 16px", borderRadius: 8, border: "1px solid #333", background: "transparent",
    color: "#888", fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500,
    letterSpacing: 2, cursor: "pointer",
  },
  // Preview
  previewBar: {
    position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center",
    gap: 16, padding: "12px 20px", background: "#141414", borderTop: "1px solid #222",
  },
};
