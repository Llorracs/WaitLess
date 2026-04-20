/**
 * ============================================
 * WAITLESS — Reset Venue Data Component
 * ============================================
 * 
 * FILE: src/ResetVenueData.jsx
 * 
 * Used by both:
 *   - AdminView.jsx (venue owner resets their own data)
 *   - MasterAdmin.jsx (master admin resets any venue's data)
 * 
 * PROPS:
 *   venue      — the venue object (must include id, slug, name,
 *                subscription_status, bartender_pin)
 *   BRAND      — the brand colors object (primary, accent, background)
 *   isMaster   — boolean, true when called from MasterAdmin
 *                (enables the "allow active venue" override)
 *   onReset    — optional callback fired after successful reset,
 *                useful for the parent to refresh its data
 * ============================================
 */

import { useState } from "react";
import { supabase } from "./lib/barOrderService";

export default function ResetVenueData({ venue, BRAND, isMaster = false, onReset }) {
  const [isOpen, setIsOpen] = useState(false);
  const [wipeOrders, setWipeOrders] = useState(true);
  const [wipeMenu, setWipeMenu] = useState(false);
  const [wipeStaff, setWipeStaff] = useState(false);
  const [nameConfirm, setNameConfirm] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const accent = BRAND?.accent || "#D4A843";
  const danger = "#E74C3C";

  const anythingSelected = wipeOrders || wipeMenu || wipeStaff;
  const nameMatches = nameConfirm.trim().toLowerCase() === venue.name.trim().toLowerCase();
  const pinFilled = pinConfirm.length >= 4;
  const canSubmit = anythingSelected && nameMatches && pinFilled && !submitting;

  const reset = () => {
    setWipeOrders(true);
    setWipeMenu(false);
    setWipeStaff(false);
    setNameConfirm("");
    setPinConfirm("");
    setResult(null);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    setIsOpen(false);
    reset();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: rpcError } = await supabase.rpc("reset_venue_data", {
        p_venue_slug: venue.slug,
        p_pin: pinConfirm,
        p_wipe_orders: wipeOrders,
        p_wipe_menu: wipeMenu,
        p_wipe_staff: wipeStaff,
        p_allow_active_venue: isMaster,
      });

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      if (!data?.success) {
        setError(data?.error || "Reset failed.");
        return;
      }

      setResult(data);
      if (onReset) onReset(data);
    } catch (e) {
      setError(e.message || "Unexpected error.");
    } finally {
      setSubmitting(false);
    }
  };

  // ========================================
  // Collapsed state — just the danger-zone button
  // ========================================
  if (!isOpen) {
    return (
      <div style={styles.dangerZone(danger)}>
        <div style={styles.dangerHeader}>
          <span style={styles.dangerLabel}>DANGER ZONE</span>
          <span style={styles.dangerSubLabel}>IRREVERSIBLE</span>
        </div>
        <div style={styles.dangerBody}>
          <div>
            <div style={styles.dangerTitle}>Reset Venue Data</div>
            <div style={styles.dangerDescription}>
              Permanently deletes selected data for this venue. Use to clear test
              orders, old menu items, or staff records before going live.
            </div>
          </div>
          <button
            onClick={() => setIsOpen(true)}
            style={styles.openButton(danger)}
          >
            OPEN RESET PANEL
          </button>
        </div>
      </div>
    );
  }

  // ========================================
  // Success state
  // ========================================
  if (result) {
    return (
      <div style={styles.dangerZone("#2ECC71")}>
        <div style={styles.dangerHeader}>
          <span style={{ ...styles.dangerLabel, color: "#2ECC71" }}>RESET COMPLETE</span>
        </div>
        <div style={styles.successBody}>
          <div style={styles.successStat}>
            <span style={styles.successNum}>{result.deleted.orders}</span>
            <span style={styles.successLabel}>ORDERS</span>
          </div>
          <div style={styles.successStat}>
            <span style={styles.successNum}>{result.deleted.menu_items}</span>
            <span style={styles.successLabel}>MENU ITEMS</span>
          </div>
          <div style={styles.successStat}>
            <span style={styles.successNum}>{result.deleted.staff}</span>
            <span style={styles.successLabel}>STAFF</span>
          </div>
          <div style={styles.successStat}>
            <span style={styles.successNum}>{result.deleted.modifier_options}</span>
            <span style={styles.successLabel}>MODIFIERS</span>
          </div>
        </div>
        <button onClick={handleClose} style={styles.openButton(accent)}>
          CLOSE
        </button>
      </div>
    );
  }

  // ========================================
  // Open panel — checkboxes + confirmations
  // ========================================
  return (
    <div style={styles.dangerZone(danger)}>
      <div style={styles.dangerHeader}>
        <span style={styles.dangerLabel}>RESET VENUE DATA</span>
        <button onClick={handleClose} style={styles.closeButton}>×</button>
      </div>

      <div style={styles.panelBody}>
        {/* Venue context */}
        <div style={styles.venueContext}>
          <span style={styles.venueContextLabel}>TARGET VENUE</span>
          <span style={styles.venueContextName}>{venue.name}</span>
          <span style={styles.venueContextSlug}>/{venue.slug}</span>
          {venue.subscription_status === "active" && (
            <span style={styles.activeWarning}>
              ⚠ ACTIVE SUBSCRIPTION
              {isMaster
                ? " — master override enabled"
                : " — cannot reset from venue admin"}
            </span>
          )}
        </div>

        {/* Checkboxes */}
        <div style={styles.checkboxGroup}>
          <Checkbox
            checked={wipeOrders}
            onChange={setWipeOrders}
            label="Orders"
            sublabel="All past orders and transaction history"
            accent={accent}
          />
          <Checkbox
            checked={wipeMenu}
            onChange={setWipeMenu}
            label="Menu"
            sublabel="Menu items, modifiers, and modifier options"
            accent={accent}
          />
          <Checkbox
            checked={wipeStaff}
            onChange={setWipeStaff}
            label="Staff"
            sublabel="Staff records (bartender PIN is preserved on the venue)"
            accent={accent}
          />
        </div>

        {/* Confirmation inputs */}
        <div style={styles.confirmSection}>
          <label style={styles.confirmLabel}>
            TYPE VENUE NAME TO CONFIRM
            <input
              type="text"
              value={nameConfirm}
              onChange={(e) => setNameConfirm(e.target.value)}
              placeholder={venue.name}
              style={{
                ...styles.input,
                borderColor: nameMatches ? "#2ECC71" : "#333",
              }}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
          </label>

          <label style={styles.confirmLabel}>
            BARTENDER PIN
            <input
              type="password"
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              maxLength={8}
              inputMode="numeric"
              style={{
                ...styles.input,
                borderColor: pinFilled ? "#2ECC71" : "#333",
                letterSpacing: 8,
                textAlign: "center",
              }}
              autoComplete="off"
            />
          </label>
        </div>

        {/* Error display */}
        {error && (
          <div style={styles.errorBox}>
            <span style={styles.errorLabel}>ERROR</span>
            <span style={styles.errorMessage}>{error}</span>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            ...styles.submitButton(danger),
            opacity: canSubmit ? 1 : 0.3,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "WIPING..." : "PERMANENTLY DELETE SELECTED DATA"}
        </button>
      </div>
    </div>
  );
}

// ========================================
// Custom checkbox (matches brand aesthetic)
// ========================================
function Checkbox({ checked, onChange, label, sublabel, accent }) {
  return (
    <label style={styles.checkboxRow}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          ...styles.checkbox,
          borderColor: checked ? accent : "#444",
          background: checked ? accent : "transparent",
        }}
      >
        {checked && <span style={styles.checkmark}>✓</span>}
      </div>
      <div style={styles.checkboxText}>
        <span style={styles.checkboxLabel}>{label}</span>
        <span style={styles.checkboxSublabel}>{sublabel}</span>
      </div>
    </label>
  );
}

// ========================================
// Styles — matches WaitLess black/gold aesthetic
// ========================================
const styles = {
  dangerZone: (color) => ({
    background: "#0A0A0A",
    border: `1px solid ${color}33`,
    borderRadius: 12,
    marginTop: 32,
    overflow: "hidden",
  }),
  dangerHeader: {
    padding: "14px 20px",
    background: "#111",
    borderBottom: "1px solid #222",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dangerLabel: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 3,
    color: "#E74C3C",
  },
  dangerSubLabel: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    letterSpacing: 2,
    color: "#666",
  },
  dangerBody: {
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  dangerTitle: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 18,
    fontWeight: 500,
    letterSpacing: 1,
    color: "#fff",
    marginBottom: 6,
  },
  dangerDescription: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    color: "#888",
    lineHeight: 1.6,
  },
  openButton: (color) => ({
    padding: "12px 24px",
    background: "transparent",
    border: `1px solid ${color}`,
    color: color,
    fontFamily: "'Space Mono', monospace",
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: 600,
    borderRadius: 8,
    cursor: "pointer",
    alignSelf: "flex-start",
  }),
  closeButton: {
    background: "transparent",
    border: "none",
    color: "#666",
    fontSize: 24,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
  },
  panelBody: {
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  venueContext: {
    padding: 14,
    background: "#141414",
    borderRadius: 8,
    border: "1px solid #222",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  venueContextLabel: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 9,
    letterSpacing: 2,
    color: "#666",
  },
  venueContextName: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 18,
    color: "#fff",
    fontWeight: 500,
  },
  venueContextSlug: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 11,
    color: "#888",
    letterSpacing: 1,
  },
  activeWarning: {
    marginTop: 8,
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    color: "#D4A843",
    letterSpacing: 1,
  },
  checkboxGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    background: "#141414",
    border: "1px solid #222",
    borderRadius: 8,
    cursor: "pointer",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    border: "2px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  checkmark: {
    color: "#000",
    fontSize: 14,
    fontWeight: 700,
  },
  checkboxText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  checkboxLabel: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 15,
    letterSpacing: 1,
    color: "#fff",
  },
  checkboxSublabel: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 12,
    color: "#888",
  },
  confirmSection: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    paddingTop: 8,
    borderTop: "1px dashed #222",
  },
  confirmLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    letterSpacing: 2,
    color: "#888",
  },
  input: {
    padding: "12px 14px",
    background: "#0A0A0A",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#fff",
    fontFamily: "'Space Mono', monospace",
    fontSize: 14,
    outline: "none",
  },
  errorBox: {
    padding: 12,
    background: "#E74C3C15",
    border: "1px solid #E74C3C33",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  errorLabel: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 9,
    letterSpacing: 2,
    color: "#E74C3C",
  },
  errorMessage: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    color: "#fff",
  },
  submitButton: (color) => ({
    padding: "14px 20px",
    background: color,
    border: "none",
    color: "#fff",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: 600,
    borderRadius: 8,
    transition: "opacity 0.2s",
  }),
  successBody: {
    padding: 20,
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 16,
  },
  successStat: {
    padding: 16,
    background: "#141414",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },
  successNum: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 32,
    color: "#2ECC71",
    fontWeight: 600,
  },
  successLabel: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    letterSpacing: 2,
    color: "#888",
  },
};
