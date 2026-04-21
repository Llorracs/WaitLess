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
 * 
 * Menu builder includes full category management:
 * rename, delete, reorder, create empty, plus
 * per-item modifier groups and station tagging.
 * ============================================
 */

import { useState, useEffect } from "react";
import { supabase } from "./lib/barOrderService";
import QRGenerator from "./QRGenerator";
import AnalyticsView from "./AnalyticsView";
import BillingView from "./BillingView";

// Hardcode your admin email — only this email can access master admin
const MASTER_ADMIN_EMAIL = "atimelssconcept@gmail.com";

// ============================================
// CATEGORY HEADER — inline-editable with reorder/delete controls
// ============================================
function CategoryHeader({ cat, itemCount, onRename, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
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
    <div style={MS.categoryHeaderRow}>
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
          style={MS.categoryHeaderInput}
        />
      ) : (
        <h4
          style={MS.categoryHeaderText}
          onClick={() => setEditing(true)}
          title="Click to rename"
        >
          {cat} <span style={MS.categoryItemCount}>({itemCount})</span>
        </h4>
      )}
      <div style={MS.categoryControls}>
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          style={{ ...MS.categoryCtrlBtn, color: canMoveUp ? "#d4a843" : "#333", cursor: canMoveUp ? "pointer" : "not-allowed" }}
          title="Move up"
        >
          ↑
        </button>
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          style={{ ...MS.categoryCtrlBtn, color: canMoveDown ? "#d4a843" : "#333", cursor: canMoveDown ? "pointer" : "not-allowed" }}
          title="Move down"
        >
          ↓
        </button>
        <button
          onClick={() => setEditing(true)}
          style={{ ...MS.categoryCtrlBtn, color: "#888" }}
          title="Rename"
        >
          ✏️
        </button>
        <button
          onClick={onDelete}
          style={{ ...MS.categoryCtrlBtn, color: "#e74c3c", borderColor: "#e74c3c44" }}
          title="Delete category"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ============================================
// MASTER MENU BUILDER — with category management + modifier editing
// ============================================
function MasterMenuBuilder({ venue, setManagedVenue, onBack }) {
  const [menu, setMenu] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  // Modifier state
  const [modifierItemId, setModifierItemId] = useState(null);
  const [modGroups, setModGroups] = useState([]);
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingOption, setEditingOption] = useState(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [copyCandidates, setCopyCandidates] = useState([]);

  useEffect(() => { loadMenu(); }, [venue.id]);

  async function loadMenu() {
    const { data } = await supabase.from("menus").select("*").eq("venue_id", venue.id).order("category").order("sort_order");
    if (data) setMenu(data);
  }

  async function loadModifiers(menuItemId) {
    const { data: groups } = await supabase.from("menu_modifiers").select("*").eq("menu_item_id", menuItemId).order("sort_order");
    if (!groups || groups.length === 0) { setModGroups([]); return; }
    const groupIds = groups.map((g) => g.id);
    const { data: options } = await supabase.from("modifier_options").select("*").in("modifier_id", groupIds).order("sort_order");
    setModGroups(groups.map((g) => ({ ...g, options: (options || []).filter((o) => o.modifier_id === g.id) })));
  }

  const flash = (msg) => { setSaveMsg(msg); setTimeout(() => setSaveMsg(null), 2000); };

  // ============================
  // CATEGORY MANAGEMENT
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
      flash("Order save failed");
      return;
    }
    if (setManagedVenue) {
      setManagedVenue((prev) => ({ ...prev, category_order: newOrder }));
    }
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
    if (error) { flash("Rename failed"); return; }
    const current = orderedCategories();
    const updatedOrder = Array.from(new Set(current.map((c) => (c === oldName ? trimmed : c))));
    await persistCategoryOrder(updatedOrder);
    await loadMenu();
    flash(`Renamed to "${trimmed}"`);
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
      if (error) { flash("Delete failed"); return; }
    }
    const current = orderedCategories().filter((c) => c !== cat);
    await persistCategoryOrder(current);
    await loadMenu();
    flash(`Removed "${cat}"`);
  };

  const handleCreateEmptyCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    const current = orderedCategories();
    if (current.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      flash("Category already exists");
      setShowNewCategory(false);
      setNewCategory("");
      return;
    }
    const newOrder = [...current, trimmed];
    await persistCategoryOrder(newOrder);
    setShowNewCategory(false);
    setNewCategory("");
    flash(`Created "${trimmed}"`);
  };

  // ============================
  // ITEM MANAGEMENT (unchanged)
  // ============================
  const handleSave = async (item) => {
    if (item.id) {
      await supabase.from("menus").update({ item_name: item.item_name, description: item.description, price_cents: item.price_cents, category: item.category, sort_order: item.sort_order, active: item.active, station: item.station || "all" }).eq("id", item.id);
    } else {
      await supabase.from("menus").insert({ venue_id: venue.id, item_name: item.item_name, description: item.description || "", price_cents: item.price_cents, category: item.category, sort_order: item.sort_order || 0, active: true, station: item.station || "all" });
    }
    await loadMenu(); setEditingItem(null); setNewItem(null); flash("Saved");
  };

  const handleDelete = async (id) => { if (!confirm("Remove?")) return; await supabase.from("menus").delete().eq("id", id); await loadMenu(); flash("Removed"); };
  const handleToggle = async (item) => { await supabase.from("menus").update({ active: !item.active }).eq("id", item.id); await loadMenu(); flash(item.active ? "Hidden" : "Visible"); };

  // ============================
  // MODIFIER CRUD (unchanged)
  // ============================
  const addModGroup = async () => {
    if (!newGroupName.trim()) return;
    await supabase.from("menu_modifiers").insert({ menu_item_id: modifierItemId, group_name: newGroupName.trim(), required: false, max_selections: 1, sort_order: modGroups.length + 1 });
    setNewGroupName("");
    await loadModifiers(modifierItemId);
    flash("Group added");
  };

  const updateModGroup = async (group) => {
    await supabase.from("menu_modifiers").update({ group_name: group.group_name, required: group.required, max_selections: group.max_selections }).eq("id", group.id);
    await loadModifiers(modifierItemId);
    setEditingGroup(null);
    flash("Group updated");
  };

  const deleteModGroup = async (groupId) => {
    if (!confirm("Delete this modifier group and all its options?")) return;
    await supabase.from("modifier_options").delete().eq("modifier_id", groupId);
    await supabase.from("menu_modifiers").delete().eq("id", groupId);
    await loadModifiers(modifierItemId);
    flash("Group removed");
  };

  const addOption = async (groupId) => {
    await supabase.from("modifier_options").insert({ modifier_id: groupId, option_name: "New Option", price_cents: 0, is_default: false, sort_order: 99 });
    await loadModifiers(modifierItemId);
    flash("Option added");
  };

  const updateOption = async (opt) => {
    await supabase.from("modifier_options").update({ option_name: opt.option_name, price_cents: opt.price_cents, is_default: opt.is_default, sort_order: opt.sort_order }).eq("id", opt.id);
    await loadModifiers(modifierItemId);
    setEditingOption(null);
    flash("Option saved");
  };

  const deleteOption = async (optId) => {
    await supabase.from("modifier_options").delete().eq("id", optId);
    await loadModifiers(modifierItemId);
    flash("Option removed");
  };

  // Copy all modifier groups + options from a source item to the current item.
  // Uses "add" semantics — existing groups on the target are preserved, new ones appended.
  const copyModifiersFromItem = async (sourceItemId) => {
    const { data: sourceGroups, error: gErr } = await supabase
      .from("menu_modifiers")
      .select("*")
      .eq("menu_item_id", sourceItemId)
      .order("sort_order");
    if (gErr || !sourceGroups || sourceGroups.length === 0) {
      flash("Source has no modifiers");
      setShowCopyPicker(false);
      return;
    }

    const sourceGroupIds = sourceGroups.map((g) => g.id);
    const { data: sourceOptions, error: oErr } = await supabase
      .from("modifier_options")
      .select("*")
      .in("modifier_id", sourceGroupIds)
      .order("sort_order");
    if (oErr) { flash("Copy failed"); return; }

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
        flash("Copy failed mid-way");
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
          flash("Copied groups but options failed");
          await loadModifiers(modifierItemId);
          setShowCopyPicker(false);
          return;
        }
      }
    }

    await loadModifiers(modifierItemId);
    setShowCopyPicker(false);
    flash(`Copied ${sourceGroups.length} group${sourceGroups.length === 1 ? "" : "s"}`);
  };

  // Load copy candidates (other items in venue that have modifiers) when picker opens
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

  const ordered = orderedCategories();
  const modifierItem = menu.find((m) => m.id === modifierItemId);

  // ---- MODIFIER EDITING VIEW ----
  if (modifierItemId && modifierItem) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={() => { setModifierItemId(null); setModGroups([]); }} style={MS.backBtn}>← BACK TO MENU</button>
          {saveMsg && <span style={MS.flash}>{saveMsg}</span>}
        </div>
        <h3 style={MS.manageTitle}>Modifiers — {modifierItem.item_name}</h3>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>Add customization options customers can choose when ordering this item.</p>

        {/* Copy from another item — time saver for similar items */}
        {!showCopyPicker ? (
          <button
            onClick={() => setShowCopyPicker(true)}
            style={{
              padding: "8px 14px", borderRadius: 6, border: "1px dashed #1E4D8C66",
              background: "#1E4D8C11", color: "#1E4D8C",
              fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600,
              letterSpacing: 2, cursor: "pointer", width: "100%", marginBottom: 14,
            }}
          >
            📋 COPY MODIFIERS FROM ANOTHER ITEM
          </button>
        ) : (
          <div style={{
            padding: 12, background: "#0a0a0a", border: "1px solid #1E4D8C44",
            borderRadius: 8, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#1E4D8C" }}>
                COPY FROM WHICH ITEM?
              </span>
              <button onClick={() => setShowCopyPicker(false)} style={MS.dimBtn}>CANCEL</button>
            </div>
            {copyCandidates.length === 0 ? (
              <p style={{ fontSize: 11, color: "#888", margin: "4px 0" }}>
                No other items have modifiers yet. Create some first, then you can copy them.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {copyCandidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => copyModifiersFromItem(c.id)}
                    style={{
                      padding: "8px 10px", background: "#141414", border: "1px solid #222",
                      borderRadius: 6, textAlign: "left", cursor: "pointer",
                      fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#f5f5f5",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <span>{c.item_name}</span>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666" }}>
                      {c.category}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p style={{ fontSize: 10, color: "#666", margin: "4px 0 0", fontStyle: "italic" }}>
              Adds groups to current item without replacing existing ones.
            </p>
          </div>
        )}

        {modGroups.map((group) => (
          <div key={group.id} style={{ marginBottom: 20, padding: 14, background: "#0a0a0a", borderRadius: 10, border: "1px solid #1a1a1a" }}>
            {/* Group header */}
            {editingGroup?.id === group.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                <input value={editingGroup.group_name} onChange={(e) => setEditingGroup({ ...editingGroup, group_name: e.target.value })} style={MS.input} placeholder="Group name" />
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#aaa", cursor: "pointer" }}>
                    <input type="checkbox" checked={editingGroup.required} onChange={(e) => setEditingGroup({ ...editingGroup, required: e.target.checked })} /> Required
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#aaa" }}>
                    Max picks:
                    <input type="number" min="1" max="10" value={editingGroup.max_selections} onChange={(e) => setEditingGroup({ ...editingGroup, max_selections: parseInt(e.target.value || 1) })} style={{ ...MS.input, width: 50, padding: "4px 6px" }} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button onClick={() => setEditingGroup(null)} style={MS.dimBtn}>CANCEL</button>
                  <button onClick={() => updateModGroup(editingGroup)} style={MS.saveBtn}>SAVE</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: 1, color: "#d4a843" }}>{group.group_name}</span>
                  <span style={{ fontSize: 10, color: "#666", marginLeft: 8, fontFamily: "'Space Mono', monospace" }}>
                    {group.required ? "REQUIRED" : "OPTIONAL"} · {group.max_selections > 1 ? `Pick up to ${group.max_selections}` : "Pick 1"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setEditingGroup({ ...group })} style={MS.iconBtn}>✏️</button>
                  <button onClick={() => deleteModGroup(group.id)} style={MS.iconBtn}>🗑</button>
                </div>
              </div>
            )}

            {/* Options list */}
            {group.options.map((opt) =>
              editingOption?.id === opt.id ? (
                <div key={opt.id} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
                  <input value={editingOption.option_name} onChange={(e) => setEditingOption({ ...editingOption, option_name: e.target.value })} style={{ ...MS.input, flex: 1 }} placeholder="Option name" />
                  <input type="number" step="0.01" value={(editingOption.price_cents / 100).toFixed(2)} onChange={(e) => setEditingOption({ ...editingOption, price_cents: Math.round(parseFloat(e.target.value || 0) * 100) })} style={{ ...MS.input, width: 70 }} placeholder="+$" />
                  <label style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10, color: "#888", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={editingOption.is_default} onChange={(e) => setEditingOption({ ...editingOption, is_default: e.target.checked })} /> Default
                  </label>
                  <button onClick={() => updateOption(editingOption)} style={{ ...MS.saveBtn, padding: "4px 10px", fontSize: 10 }}>OK</button>
                  <button onClick={() => setEditingOption(null)} style={{ ...MS.dimBtn, padding: "4px 10px", fontSize: 10 }}>X</button>
                </div>
              ) : (
                <div key={opt.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2, borderRadius: 6, background: "#141414" }}>
                  <span style={{ flex: 1, fontSize: 13, color: "#ccc" }}>{opt.option_name}</span>
                  {opt.price_cents !== 0 && <span style={{ fontSize: 11, color: opt.price_cents > 0 ? "#d4a843" : "#2ecc71", fontFamily: "'Space Mono', monospace" }}>{opt.price_cents > 0 ? "+" : ""}${(opt.price_cents / 100).toFixed(2)}</span>}
                  {opt.is_default && <span style={{ fontSize: 8, color: "#1E4D8C", fontFamily: "'Space Mono', monospace", letterSpacing: 1, padding: "1px 5px", background: "#1E4D8C22", borderRadius: 4 }}>DEFAULT</span>}
                  <button onClick={() => setEditingOption({ ...opt })} style={MS.iconBtn}>✏️</button>
                  <button onClick={() => deleteOption(opt.id)} style={MS.iconBtn}>🗑</button>
                </div>
              )
            )}
            <button onClick={() => addOption(group.id)} style={{ ...MS.addBtn, marginTop: 6, fontSize: 9 }}>+ Add Option</button>
          </div>
        ))}

        {/* Add new modifier group */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input placeholder="New modifier group (e.g., Size, Style, Sauce)" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addModGroup()} style={{ ...MS.input, flex: 1 }} />
          <button onClick={addModGroup} style={MS.saveBtn}>ADD GROUP</button>
        </div>
      </div>
    );
  }

  // ---- MENU LIST VIEW ----
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={onBack} style={MS.backBtn}>← BACK TO VENUES</button>
        {saveMsg && <span style={MS.flash}>{saveMsg}</span>}
      </div>
      <h3 style={MS.manageTitle}>Menu — {venue.name}</h3>

      {/* NEW CATEGORY BUTTON — MOVED TO TOP */}
      {showNewCategory ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            placeholder="Category name (e.g., Signature Cocktails)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newCategory.trim()) handleCreateEmptyCategory(); }}
            autoFocus
            style={MS.input}
          />
          <button onClick={handleCreateEmptyCategory} style={MS.saveBtn}>CREATE</button>
          <button onClick={() => { setShowNewCategory(false); setNewCategory(""); }} style={MS.dimBtn}>CANCEL</button>
        </div>
      ) : (
        <button onClick={() => setShowNewCategory(true)} style={{ ...MS.addCategoryBtn, marginBottom: 20 }}>
          + New Category
        </button>
      )}

      {/* EXISTING CATEGORIES WITH MANAGEMENT CONTROLS */}
      {ordered.map((cat, catIdx) => (
        <div key={cat} style={{ marginBottom: 24 }}>
          <CategoryHeader
            cat={cat}
            itemCount={menu.filter((m) => m.category === cat).length}
            onRename={(newName) => renameCategory(cat, newName)}
            onDelete={() => deleteCategory(cat)}
            onMoveUp={() => moveCategory(cat, "up")}
            onMoveDown={() => moveCategory(cat, "down")}
            canMoveUp={catIdx > 0}
            canMoveDown={catIdx < ordered.length - 1}
          />

          {menu.filter((m) => m.category === cat).map((item) =>
            editingItem?.id === item.id ? (
              <div key={item.id} style={MS.editCard}>
                <input placeholder="Name" value={editingItem.item_name} onChange={(e) => setEditingItem({ ...editingItem, item_name: e.target.value })} style={MS.input} />
                <input placeholder="Description" value={editingItem.description || ""} onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })} style={MS.input} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" step="0.01" value={(editingItem.price_cents / 100).toFixed(2)} onChange={(e) => setEditingItem({ ...editingItem, price_cents: Math.round(parseFloat(e.target.value || 0) * 100) })} style={{ ...MS.input, flex: 1 }} />
                  <input type="number" value={editingItem.sort_order} onChange={(e) => setEditingItem({ ...editingItem, sort_order: parseInt(e.target.value || 0) })} style={{ ...MS.input, width: 60 }} />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ fontSize: 9, color: "#888", fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>STATION:</label>
                  <select value={editingItem.station || "non-alc"} onChange={(e) => setEditingItem({ ...editingItem, station: e.target.value })} style={{ ...MS.input, width: 110, padding: "6px 8px", fontSize: 12 }}>
                    <option value="bar">Bar (21+)</option>
                    <option value="non-alc">Non-Alcoholic</option>
                    <option value="kitchen">Kitchen</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ fontSize: 9, color: "#888", fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>CATEGORY:</label>
                  <select value={editingItem.category} onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })} style={{ ...MS.input, flex: 1, padding: "6px 8px", fontSize: 12 }}>
                    {ordered.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
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
                {item.station && item.station !== "non-alc" && (
                  <span style={{ fontSize: 8, fontFamily: "'Space Mono', monospace", letterSpacing: 1, padding: "2px 6px", borderRadius: 4, color: item.station === "bar" ? "#e91e8c" : "#2ecc71", background: item.station === "bar" ? "#e91e8c15" : "#2ecc7115", border: `1px solid ${item.station === "bar" ? "#e91e8c33" : "#2ecc7133"}` }}>{item.station === "bar" ? "BAR 21+" : "KITCHEN"}</span>
                )}
                <span style={MS.itemPrice}>${(item.price_cents / 100).toFixed(2)}</span>
                <button onClick={() => { setModifierItemId(item.id); loadModifiers(item.id); }} style={{ ...MS.iconBtn, fontSize: 9, fontFamily: "'Space Mono', monospace", color: "#d4a843", border: "1px solid #d4a84333", borderRadius: 4, padding: "2px 6px" }}>MODS</button>
                <button onClick={() => handleToggle(item)} style={MS.iconBtn}>{item.active ? "👁" : "🚫"}</button>
                <button onClick={() => setEditingItem({ ...item })} style={MS.iconBtn}>✏️</button>
                <button onClick={() => handleDelete(item.id)} style={MS.iconBtn}>🗑</button>
              </div>
            )
          )}
          <button onClick={() => setNewItem({ item_name: "", description: "", price_cents: 0, category: cat, sort_order: menu.filter((m) => m.category === cat).length + 1, station: "bar" })} style={MS.addBtn}>+ Add to {cat}</button>
        </div>
      ))}

      {newItem && (
        <div style={MS.editCard}>
          <input placeholder="Name" value={newItem.item_name} onChange={(e) => setNewItem({ ...newItem, item_name: e.target.value })} style={MS.input} />
          <input placeholder="Description" value={newItem.description || ""} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} style={MS.input} />
          <input type="number" step="0.01" placeholder="Price" value={newItem.price_cents ? (newItem.price_cents / 100).toFixed(2) : ""} onChange={(e) => setNewItem({ ...newItem, price_cents: Math.round(parseFloat(e.target.value || 0) * 100) })} style={MS.input} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 9, color: "#888", fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>STATION:</label>
            <select value={newItem.station || "bar"} onChange={(e) => setNewItem({ ...newItem, station: e.target.value })} style={{ ...MS.input, width: 140, padding: "6px 8px", fontSize: 12 }}>
              <option value="bar">Bar (21+)</option>
              <option value="non-alc">Non-Alcoholic</option>
              <option value="kitchen">Kitchen</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setNewItem(null)} style={MS.dimBtn}>CANCEL</button>
            <button onClick={() => handleSave(newItem)} style={MS.saveBtn}>SAVE</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline venue settings for master admin
function MasterVenueSettings({ venue, setManagedVenue, onBack }) {
  const [form, setForm] = useState({
    name: venue.name || "", tagline: venue.tagline || "", bartender_pin: venue.bartender_pin || "0000",
    service_fee_percent: venue.service_fee_percent || 5, primary: venue.brand_colors?.primary || "#1E4D8C",
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
  const [manageTab, setManageTab] = useState("analytics");

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

    const { data: venueData } = await supabase
      .from("venues")
      .select("*")
      .order("created_at", { ascending: false });

    if (venueData) setVenues(venueData);

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
        <div style={{ padding: "20px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, padding: "12px 16px", background: "#0a0a0a", borderRadius: 10, border: "1px solid #1E4D8C33" }}>
            <div>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>{managedVenue.name?.toUpperCase()}</span>
              <span style={{ display: "block", fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#d4a843", letterSpacing: 2 }}>MANAGING VENUE</span>
            </div>
            <button onClick={() => { setManagedVenue(null); loadPlatformData(); }} style={S.actionBtn}>← ALL VENUES</button>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
            {[
              { key: "analytics", label: "Analytics" },
              { key: "menu", label: "Menu" },
              { key: "settings", label: "Settings" },
              { key: "qr", label: "QR Code" },
            ].map((tab) => (
              <button key={tab.key} onClick={() => setManageTab(tab.key)} style={{
                padding: "8px 16px", borderRadius: 8, border: manageTab === tab.key ? "1px solid #1E4D8C" : "1px solid #222",
                background: manageTab === tab.key ? "#1E4D8C22" : "transparent",
                color: manageTab === tab.key ? "#1E4D8C" : "#888",
                fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500, letterSpacing: 1, cursor: "pointer",
              }}>{tab.label}</button>
            ))}
          </div>

          {manageTab === "analytics" && <AnalyticsView venue={managedVenue} BRAND={{ primary: managedVenue.brand_colors?.primary || "#1E4D8C", accent: managedVenue.brand_colors?.accent || "#d4a843" }} />}
          {manageTab === "menu" && <MasterMenuBuilder venue={managedVenue} setManagedVenue={setManagedVenue} onBack={() => setManageTab("analytics")} />}
          {manageTab === "settings" && <MasterVenueSettings venue={managedVenue} setManagedVenue={setManagedVenue} onBack={() => setManageTab("analytics")} />}
          {manageTab === "qr" && <QRGenerator venue={managedVenue} BRAND={{ primary: managedVenue.brand_colors?.primary || "#1E4D8C", accent: managedVenue.brand_colors?.accent || "#d4a843" }} embedded={true} />}
        </div>
      ) : (
        <>
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
                <span style={{ ...S.kpiLabel, color: "#1E4D8C" }}>TOTAL FEES</span>
                <span style={S.kpiValue}>${(platformStats.totalFees / 100).toFixed(2)}</span>
                <span style={S.kpiSub}>service fees collected (30d)</span>
              </div>
            </div>
          )}

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
    borderTopColor: "#1E4D8C", animation: "spin 1s linear infinite",
  },

  // Auth
  authCard: {
    background: "#0a0a0a", borderRadius: 20, padding: "36px 28px", maxWidth: 360, width: "100%",
    display: "flex", flexDirection: "column", gap: 16, border: "1px solid #1a1a1a",
  },
  logo: {
    fontFamily: "'Oswald', sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: 4,
    textAlign: "center", margin: 0,
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
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
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)",
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
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
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
  kpiLabel: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#1E4D8C", letterSpacing: 2 },
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
    padding: "6px 14px", borderRadius: 6, border: "1px solid #1E4D8C",
    background: "#1E4D8C22", color: "#1E4D8C", fontFamily: "'Space Mono', monospace",
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

  // NEW: category header with management controls
  categoryHeaderRow: {
    display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 6,
    borderBottom: "1px solid #d4a8431a",
  },
  categoryHeaderText: {
    flex: 1, margin: 0, fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600,
    letterSpacing: 3, color: "#d4a843", textTransform: "uppercase", cursor: "pointer",
  },
  categoryItemCount: {
    fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666",
    letterSpacing: 1, marginLeft: 4, textTransform: "none",
  },
  categoryHeaderInput: {
    flex: 1, padding: "4px 8px", background: "#141414", border: "1px solid #d4a843",
    borderRadius: 4, color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 12,
    letterSpacing: 3, textTransform: "uppercase", outline: "none",
  },
  categoryControls: { display: "flex", gap: 3 },
  categoryCtrlBtn: {
    background: "transparent", border: "1px solid #333", borderRadius: 4,
    width: 24, height: 24, fontSize: 11, padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  },

  catHeader: { fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 3, color: "#d4a843", textTransform: "uppercase", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #d4a8431a" },
  itemRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#0a0a0a", borderRadius: 8, border: "1px solid #1a1a1a", marginBottom: 4 },
  itemName: { fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, display: "block" },
  itemDesc: { fontSize: 11, color: "#888", display: "block" },
  itemPrice: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#d4a843" },
  iconBtn: { background: "transparent", border: "none", fontSize: 13, cursor: "pointer", padding: 4, filter: "grayscale(0.5)" },
  addBtn: { width: "100%", padding: "8px", borderRadius: 6, border: "1px dashed #333", background: "transparent", color: "#666", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer" },
  addCategoryBtn: { padding: "10px 16px", borderRadius: 8, border: "1px dashed #d4a84366", background: "#d4a84308", color: "#d4a843", fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500, letterSpacing: 2, cursor: "pointer", width: "100%" },
  editCard: { padding: 14, background: "#0a0a0a", borderRadius: 10, border: "1px solid #1E4D8C44", display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 },
  input: { padding: "10px", background: "#141414", border: "1px solid #222", borderRadius: 6, color: "#f5f5f5", fontFamily: "'Inter', sans-serif", fontSize: 13, outline: "none", width: "100%" },
  label: { display: "block", fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#888", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  saveBtn: { padding: "8px 16px", borderRadius: 6, border: "none", background: "#1E4D8C", color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 2, cursor: "pointer" },
  dimBtn: { padding: "8px 16px", borderRadius: 6, border: "1px solid #333", background: "transparent", color: "#888", fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500, letterSpacing: 2, cursor: "pointer" },
};
