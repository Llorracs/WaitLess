/**
 * ============================================
 * WAITLESS — Event Editor (Admin)
 * ============================================
 *
 * FILE: src/EventEditorView.jsx
 *
 * Single component for both creating and editing events. Determined by
 * whether `eventId` prop is null (create) or a UUID (edit).
 *
 * Props:
 *   - venue: current venue (from AdminView)
 *   - BRAND: theming object
 *   - eventId: UUID of event to edit, or null to create a new one
 *   - onClose: () => void — called when user clicks back/cancel/done
 *
 * Manages:
 *   - Event fields (name, slug, description, dates, location, status, etc.)
 *   - Nested ticket_types array (add, edit, remove, reorder)
 *   - Validation before save (slug uniqueness, date sanity, etc.)
 *   - Lock rules: certain fields lock once tickets are sold to that tier
 *
 * Persistence:
 *   - Single "Save" action: upserts event row, then upserts ticket_types
 *   - Uses service-role bypass via Supabase RPC... actually no, just uses
 *     the standard anon client. RLS on events allows full CRUD for staff
 *     of this venue (configured in the ticketing schema migration).
 * ============================================
 */

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/barOrderService";

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Convert "TRFQ in the City" → "trfq-in-the-city"
 * Lowercase, alphanumeric + dashes only.
 */
function slugify(input) {
  return (input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")  // Strip punctuation
    .replace(/\s+/g, "-")           // Spaces → dashes
    .replace(/-+/g, "-")            // Collapse multiple dashes
    .replace(/^-|-$/g, "");         // Trim leading/trailing dashes
}

/**
 * Convert ISO timestamp to local datetime-local input format.
 * datetime-local expects "YYYY-MM-DDTHH:MM" without timezone.
 */
function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert local datetime-local input → ISO string (UTC).
 */
function localInputToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Generate a temporary client-side ID for new ticket types
 * (used until they're saved and get a real UUID from the database).
 */
function tempId() {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

// Empty event template for create mode
function emptyEvent() {
  return {
    id: null,
    slug: "",
    name: "",
    description: "",
    location_name: "",
    location_address: "",
    starts_at: "",
    ends_at: "",
    doors_at: "",
    hero_image_url: "",
    status: "draft",
    capacity: null,
  };
}

// Empty ticket type template
function emptyTicketType() {
  return {
    id: tempId(),
    _new: true,
    name: "",
    description: "",
    price_cents: 0,
    quantity_total: null,
    quantity_sold: 0,
    sale_starts_at: null,
    sale_ends_at: null,
    sort_order: 0,
    active: true,
    requires_age_verification: false,
    minimum_age: 21,
  };
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function EventEditorView({ venue, BRAND, eventId, onClose }) {
  const isCreating = !eventId;

  const [event, setEvent] = useState(emptyEvent());
  const [ticketTypes, setTicketTypes] = useState([]);
  const [removedTicketTypeIds, setRemovedTicketTypeIds] = useState([]);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [loading, setLoading] = useState(!isCreating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [expandedTierId, setExpandedTierId] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ==========================================================================
  // Load existing event (edit mode)
  // ==========================================================================
  useEffect(() => {
    if (isCreating) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data: ev, error: evErr } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .single();
        if (evErr) throw evErr;

        const { data: tts, error: ttErr } = await supabase
          .from("ticket_types")
          .select("*")
          .eq("event_id", eventId)
          .order("sort_order");
        if (ttErr) throw ttErr;

        if (!cancelled) {
          setEvent({
            ...ev,
            starts_at: isoToLocalInput(ev.starts_at),
            ends_at: isoToLocalInput(ev.ends_at),
            doors_at: isoToLocalInput(ev.doors_at),
          });
          setTicketTypes((tts || []).map((tt) => ({ ...tt, _new: false })));
          setSlugManuallyEdited(true); // Don't auto-overwrite the existing slug
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load event");
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [eventId, isCreating]);

  // ==========================================================================
  // Auto-fill slug from name (until user manually edits)
  // ==========================================================================
  useEffect(() => {
    if (slugManuallyEdited) return;
    setEvent((prev) => ({ ...prev, slug: slugify(prev.name) }));
  }, [event.name, slugManuallyEdited]);

  // ==========================================================================
  // Lock-rule computation (memoized)
  // ==========================================================================
  const locks = useMemo(() => {
    const anyTicketsSold = ticketTypes.some((tt) => (tt.quantity_sold || 0) > 0);
    return {
      slug: !isCreating && anyTicketsSold,     // Slug locked once anyone has bought
      // Date/location are NOT locked — your "lenient" choice (auto-email cascade deferred)
      // Price-per-tier is locked individually below
    };
  }, [ticketTypes, isCreating]);

  function isPriceLocked(tt) {
    return !tt._new && (tt.quantity_sold || 0) > 0;
  }

  // ==========================================================================
  // Field updates
  // ==========================================================================
  function updateEvent(patch) {
    setEvent((prev) => ({ ...prev, ...patch }));
  }

  function updateTicketType(id, patch) {
    setTicketTypes((prev) => prev.map((tt) => (tt.id === id ? { ...tt, ...patch } : tt)));
  }

  function addTicketType() {
    const newTier = { ...emptyTicketType(), sort_order: ticketTypes.length };
    setTicketTypes((prev) => [...prev, newTier]);
    setExpandedTierId(newTier.id);
  }

  function removeTicketType(id) {
    const tt = ticketTypes.find((x) => x.id === id);
    if (!tt) return;
    if (!tt._new && (tt.quantity_sold || 0) > 0) {
      alert(`Can't delete a ticket type that has ${tt.quantity_sold} sale${tt.quantity_sold === 1 ? "" : "s"}. Uncheck "Active and on sale" above to stop new sales — existing tickets stay valid.`);
      return;
    }
    if (!tt._new) {
      // Track for deletion on save
      setRemovedTicketTypeIds((prev) => [...prev, id]);
    }
    setTicketTypes((prev) => prev.filter((x) => x.id !== id));
    if (expandedTierId === id) setExpandedTierId(null);
  }

  // ==========================================================================
  // Validation
  // ==========================================================================
  function validate() {
    const errors = {};

    if (!event.name?.trim()) errors.name = "Event name is required";
    if (!event.slug?.trim()) errors.slug = "Slug is required";
    if (!/^[a-z0-9-]+$/.test(event.slug)) errors.slug = "Slug can only contain lowercase letters, numbers, and dashes";

    if (!event.starts_at) errors.starts_at = "Start time is required";
    if (!event.ends_at) errors.ends_at = "End time is required";
    if (event.starts_at && event.ends_at && new Date(event.ends_at) <= new Date(event.starts_at)) {
      errors.ends_at = "End time must be after start time";
    }

    if (event.status === "published") {
      if (ticketTypes.length === 0) {
        errors.status = "Add at least one ticket type before publishing";
      } else if (!ticketTypes.some((tt) => tt.active)) {
        errors.status = "At least one ticket type must be active before publishing";
      }
      if (event.ends_at && new Date(event.ends_at) <= new Date()) {
        errors.status = "Cannot publish an event with an end time in the past";
      }
    }

    // Per-ticket validation
    const ttErrors = {};
    ticketTypes.forEach((tt, idx) => {
      const e = {};
      if (!tt.name?.trim()) e.name = "Name required";
      if (tt.price_cents == null || tt.price_cents < 0) e.price_cents = "Invalid price";
      if (tt.quantity_total != null && tt.quantity_total < (tt.quantity_sold || 0)) {
        e.quantity_total = `Can't reduce below ${tt.quantity_sold} sold`;
      }
      if (tt.requires_age_verification && (!tt.minimum_age || tt.minimum_age < 0)) {
        e.minimum_age = "Set a minimum age";
      }
      if (Object.keys(e).length) ttErrors[tt.id] = e;
    });
    if (Object.keys(ttErrors).length) errors._ticketTypes = ttErrors;

    return errors;
  }

  // ==========================================================================
  // Save (upsert event + ticket types)
  // ==========================================================================
  async function handleSave() {
    const errs = validate();
    setValidationErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Find first error and scroll there if possible
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // 1. Upsert event row
      const eventPayload = {
        venue_id: venue.id,
        slug: event.slug,
        name: event.name,
        description: event.description || null,
        location_name: event.location_name || null,
        location_address: event.location_address || null,
        starts_at: localInputToIso(event.starts_at),
        ends_at: localInputToIso(event.ends_at),
        doors_at: event.doors_at ? localInputToIso(event.doors_at) : null,
        hero_image_url: event.hero_image_url || null,
        status: event.status,
        capacity: event.capacity || null,
        updated_at: new Date().toISOString(),
      };

      let savedEventId = event.id;

      if (isCreating) {
        const { data, error: insertErr } = await supabase
          .from("events")
          .insert(eventPayload)
          .select()
          .single();
        if (insertErr) throw insertErr;
        savedEventId = data.id;
      } else {
        const { error: updateErr } = await supabase
          .from("events")
          .update(eventPayload)
          .eq("id", event.id);
        if (updateErr) throw updateErr;
      }

      // 2. Delete any removed ticket types
      if (removedTicketTypeIds.length > 0) {
        const realIds = removedTicketTypeIds.filter((id) => !String(id).startsWith("tmp-"));
        if (realIds.length > 0) {
          await supabase.from("ticket_types").delete().in("id", realIds);
        }
      }

      // 3. Upsert each ticket type
      for (let i = 0; i < ticketTypes.length; i++) {
        const tt = ticketTypes[i];
        const payload = {
          event_id: savedEventId,
          name: tt.name,
          description: tt.description || null,
          price_cents: tt.price_cents,
          quantity_total: tt.quantity_total ?? null,
          sale_starts_at: tt.sale_starts_at || null,
          sale_ends_at: tt.sale_ends_at || null,
          sort_order: i,
          active: tt.active,
          requires_age_verification: tt.requires_age_verification,
          minimum_age: tt.minimum_age || 21,
        };

        if (tt._new) {
          await supabase.from("ticket_types").insert(payload);
        } else {
          await supabase.from("ticket_types").update(payload).eq("id", tt.id);
        }
      }

      // Done
      setSaving(false);
      onClose();
    } catch (err) {
      console.error("Save error:", err);
      setError(err.message || "Failed to save");
      setSaving(false);
    }
  }

  // ==========================================================================
  // Cancel event (destructive)
  // ==========================================================================
  async function handleCancelEvent() {
    if (!event.id) return;
    if (!window.confirm("Cancel this event? Ticket holders will keep their tickets, but you'll need to manually issue refunds.")) return;

    setSaving(true);
    try {
      await supabase.from("events").update({ status: "canceled" }).eq("id", event.id);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to cancel event");
      setSaving(false);
    }
  }

  // ==========================================================================
  // Render
  // ==========================================================================
  if (loading) {
    return (
      <div style={{ padding: "80px 20px", textAlign: "center" }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          border: "3px solid #222", borderTopColor: BRAND.accent,
          animation: "spin 1s linear infinite", margin: "0 auto",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{
          fontFamily: "'Space Mono', monospace", fontSize: 11,
          color: BRAND.dimText, letterSpacing: 2, marginTop: 16,
        }}>
          LOADING EVENT...
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 16px 100px", maxWidth: 720, margin: "0 auto" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 24, flexWrap: "wrap", gap: 12,
      }}>
        <button onClick={onClose} style={{
          background: "transparent", border: `1px solid ${BRAND.dimText}`,
          borderRadius: 20, padding: "8px 16px", color: BRAND.gray,
          fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500,
          letterSpacing: 2, cursor: "pointer",
        }}>
          ← BACK TO EVENTS
        </button>
        <h1 style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700,
          letterSpacing: 2, margin: 0, color: BRAND.white,
        }}>
          {isCreating ? "NEW EVENT" : "EDIT EVENT"}
        </h1>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: "12px 16px", marginBottom: 20,
          background: "#e74c3c11", border: "1px solid #e74c3c44",
          borderRadius: 10, color: "#e74c3c", fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Section: Basic info */}
      <Section title="Event Details" BRAND={BRAND}>
        <Field label="Event Name *" error={validationErrors.name} BRAND={BRAND}>
          <input
            type="text"
            value={event.name}
            onChange={(e) => updateEvent({ name: e.target.value })}
            placeholder="e.g. TRFQ in the City — Pride Celebration"
            style={inputStyle(BRAND)}
          />
        </Field>

        <Field label="URL Slug *" error={validationErrors.slug} BRAND={BRAND} help={locks.slug ? "Locked — tickets have been sold" : "Used in the event URL"}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontFamily: "'Space Mono', monospace", fontSize: 12,
              color: BRAND.dimText, whiteSpace: "nowrap",
            }}>
              /{venue.slug}/buy/
            </span>
            <input
              type="text"
              value={event.slug}
              disabled={locks.slug}
              onChange={(e) => {
                setSlugManuallyEdited(true);
                updateEvent({ slug: slugify(e.target.value) });
              }}
              placeholder="event-slug"
              style={{
                ...inputStyle(BRAND),
                opacity: locks.slug ? 0.5 : 1,
                cursor: locks.slug ? "not-allowed" : "text",
              }}
            />
          </div>
        </Field>

        <Field label="Description" BRAND={BRAND} help="Short blurb shown on the buy page">
          <textarea
            value={event.description}
            onChange={(e) => updateEvent({ description: e.target.value })}
            placeholder="One Night. One Pride. Endless Memories..."
            rows={4}
            style={{ ...inputStyle(BRAND), resize: "vertical", minHeight: 80 }}
          />
        </Field>

        <Field label="Hero Image URL" BRAND={BRAND} help="Paste a public image URL (Squarespace, Imgur, etc.) — image upload coming later">
          <input
            type="url"
            value={event.hero_image_url}
            onChange={(e) => updateEvent({ hero_image_url: e.target.value })}
            placeholder="https://..."
            style={inputStyle(BRAND)}
          />
        </Field>
      </Section>

      {/* Section: When & Where */}
      <Section title="When & Where" BRAND={BRAND}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <Field label="Doors Open" BRAND={BRAND}>
            <input
              type="datetime-local"
              value={event.doors_at}
              onChange={(e) => updateEvent({ doors_at: e.target.value })}
              style={inputStyle(BRAND)}
            />
          </Field>
          <Field label="Event Starts *" error={validationErrors.starts_at} BRAND={BRAND}>
            <input
              type="datetime-local"
              value={event.starts_at}
              onChange={(e) => updateEvent({ starts_at: e.target.value })}
              style={inputStyle(BRAND)}
            />
          </Field>
          <Field label="Event Ends *" error={validationErrors.ends_at} BRAND={BRAND}>
            <input
              type="datetime-local"
              value={event.ends_at}
              onChange={(e) => updateEvent({ ends_at: e.target.value })}
              style={inputStyle(BRAND)}
            />
          </Field>
        </div>

        <Field label="Location Name" BRAND={BRAND}>
          <input
            type="text"
            value={event.location_name}
            onChange={(e) => updateEvent({ location_name: e.target.value })}
            placeholder="Baltimore Unity Hall"
            style={inputStyle(BRAND)}
          />
        </Field>

        <Field label="Location Address" BRAND={BRAND}>
          <input
            type="text"
            value={event.location_address}
            onChange={(e) => updateEvent({ location_address: e.target.value })}
            placeholder="123 Main St, Baltimore, MD"
            style={inputStyle(BRAND)}
          />
        </Field>

        <Field label="Capacity (optional)" BRAND={BRAND} help="Total attendees expected. Helps with door-count planning.">
          <input
            type="number"
            min="0"
            value={event.capacity || ""}
            onChange={(e) => updateEvent({ capacity: e.target.value ? Number(e.target.value) : null })}
            placeholder="e.g. 300"
            style={inputStyle(BRAND)}
          />
        </Field>
      </Section>

      {/* Section: Ticket types */}
      <Section title="Ticket Types" BRAND={BRAND}>
        {ticketTypes.length === 0 ? (
          <div style={{
            padding: "32px 20px", textAlign: "center",
            background: BRAND.cardBg, border: "1px dashed #333",
            borderRadius: 12, color: BRAND.gray, fontSize: 13,
          }}>
            No ticket types yet. Add at least one to publish this event.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ticketTypes.map((tt, idx) => (
              <TicketTypeCard
                key={tt.id}
                tt={tt}
                idx={idx}
                expanded={expandedTierId === tt.id}
                onToggle={() => setExpandedTierId(expandedTierId === tt.id ? null : tt.id)}
                onChange={(patch) => updateTicketType(tt.id, patch)}
                onRemove={() => removeTicketType(tt.id)}
                priceLocked={isPriceLocked(tt)}
                errors={validationErrors._ticketTypes?.[tt.id] || {}}
                BRAND={BRAND}
              />
            ))}
          </div>
        )}

        <button onClick={addTicketType} style={{
          marginTop: 12, padding: "12px 20px", width: "100%",
          background: "transparent", border: `1.5px dashed ${BRAND.accentMuted}`,
          borderRadius: 12, color: BRAND.accent,
          fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
          letterSpacing: 2, cursor: "pointer",
        }}>
          + ADD TICKET TYPE
        </button>
      </Section>

      {/* Section: Advanced (collapsed) */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => setShowAdvanced(!showAdvanced)} style={{
          background: "transparent", border: "none", color: BRAND.gray,
          fontFamily: "'Space Mono', monospace", fontSize: 11,
          letterSpacing: 2, cursor: "pointer", padding: "8px 0",
        }}>
          {showAdvanced ? "▼" : "▶"} ADVANCED OPTIONS
        </button>
        {showAdvanced && (
          <div style={{ marginTop: 8 }}>
            <Section title="" BRAND={BRAND}>
              <Field
                label="Custom Refund Policy (optional)"
                BRAND={BRAND}
                help="Leave blank to use the Waitless default refund policy. Add custom text to override per this event's venue."
              >
                <textarea
                  rows={5}
                  placeholder="e.g. No refunds within 48 hours of event start..."
                  defaultValue={venue.refund_policy_override || ""}
                  onBlur={async (e) => {
                    // Save venue-level override on blur (it lives on venues, not events)
                    await supabase
                      .from("venues")
                      .update({ refund_policy_override: e.target.value || null })
                      .eq("id", venue.id);
                  }}
                  style={{ ...inputStyle(BRAND), resize: "vertical", minHeight: 100 }}
                />
              </Field>
            </Section>
          </div>
        )}
      </div>

      {/* Section: Publish */}
      <Section title="Publish" BRAND={BRAND}>
        <Field label="Status" error={validationErrors.status} BRAND={BRAND}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["draft", "published"].map((status) => (
              <button
                key={status}
                onClick={() => updateEvent({ status })}
                style={{
                  padding: "10px 18px", borderRadius: 10,
                  border: event.status === status ? `1.5px solid ${BRAND.primary}` : "1px solid #333",
                  background: event.status === status ? BRAND.primary + "22" : "transparent",
                  color: event.status === status ? BRAND.primary : BRAND.gray,
                  fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600,
                  letterSpacing: 2, cursor: "pointer", textTransform: "uppercase",
                }}
              >
                {status === "draft" ? "📝 Draft" : "🎟️ Published"}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: BRAND.gray, marginTop: 10 }}>
            {event.status === "draft"
              ? "Draft events are not visible to buyers. Switch to Published when you're ready to sell tickets."
              : "Published events are live on /{venue}/buy/{slug}. Tickets can be purchased immediately."}
          </div>
        </Field>
      </Section>

      {/* Save / Cancel buttons */}
      <div style={{
        display: "flex", gap: 10, marginTop: 32,
        position: "sticky", bottom: 16, zIndex: 10,
      }}>
        <button
          onClick={onClose}
          disabled={saving}
          style={{
            flex: 1, padding: "16px", background: "transparent",
            border: `1px solid ${BRAND.dimText}`, borderRadius: 12,
            color: BRAND.gray, fontFamily: "'Oswald', sans-serif",
            fontSize: 14, fontWeight: 600, letterSpacing: 2, cursor: "pointer",
          }}
        >
          CANCEL
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 2, padding: "16px",
            background: saving ? "#444" : `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
            border: "none", borderRadius: 12, color: BRAND.white,
            fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700,
            letterSpacing: 2, cursor: saving ? "wait" : "pointer",
            boxShadow: `0 4px 24px ${BRAND.primaryGlow}`,
          }}
        >
          {saving ? "SAVING..." : isCreating ? "CREATE EVENT" : "SAVE CHANGES"}
        </button>
      </div>

      {/* Cancel event button (edit mode only, destructive, separate from cancel form) */}
      {!isCreating && event.status !== "canceled" && (
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid #1a1a1a", textAlign: "center" }}>
          <button onClick={handleCancelEvent} style={{
            background: "transparent", border: "1px solid #e74c3c44",
            borderRadius: 10, padding: "10px 20px", color: "#e74c3c",
            fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600,
            letterSpacing: 2, cursor: "pointer",
          }}>
            CANCEL THIS EVENT
          </button>
          <div style={{ fontSize: 11, color: BRAND.dimText, marginTop: 8 }}>
            Marks event as canceled. Refunds must be issued manually from the Orders tab.
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function Section({ title, children, BRAND }) {
  return (
    <div style={{
      marginBottom: 28,
      background: BRAND.cardBg,
      border: "1px solid #222",
      borderRadius: 14,
      padding: title ? "20px 18px" : "0",
    }}>
      {title && (
        <h2 style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
          letterSpacing: 4, color: BRAND.accent, textTransform: "uppercase",
          margin: "0 0 16px", paddingBottom: 10, borderBottom: `1px solid ${BRAND.accentMuted}`,
        }}>
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

function Field({ label, children, error, help, BRAND }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: "block", fontFamily: "'Oswald', sans-serif",
        fontSize: 11, fontWeight: 600, color: BRAND.gray,
        letterSpacing: 2, textTransform: "uppercase", marginBottom: 6,
      }}>
        {label}
      </label>
      {children}
      {help && !error && (
        <div style={{ fontSize: 11, color: BRAND.dimText, marginTop: 4 }}>{help}</div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: "#e74c3c", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function inputStyle(BRAND) {
  return {
    width: "100%",
    padding: "12px 14px",
    background: "#0a0a0a",
    border: "1px solid #333",
    borderRadius: 8,
    color: BRAND.white,
    fontFamily: "'Inter', sans-serif",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };
}

function TicketTypeCard({ tt, idx, expanded, onToggle, onChange, onRemove, priceLocked, errors, BRAND }) {
  return (
    <div style={{
      background: "#0a0a0a",
      border: `1px solid ${expanded ? BRAND.primary + "66" : "#222"}`,
      borderRadius: 12,
      overflow: "hidden",
      transition: "border-color 0.2s",
    }}>
      {/* Collapsed header */}
      <button onClick={onToggle} style={{
        width: "100%", padding: "14px 16px",
        background: "transparent", border: "none",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        cursor: "pointer", color: BRAND.white, textAlign: "left",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 600,
            letterSpacing: 1,
            color: tt.name ? BRAND.white : BRAND.dimText,
          }}>
            {tt.name || "Untitled tier"}
          </div>
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 11,
            color: BRAND.gray, marginTop: 2,
          }}>
            ${(tt.price_cents / 100).toFixed(2)}
            {tt.quantity_total != null && ` · ${tt.quantity_sold || 0} / ${tt.quantity_total} sold`}
            {tt.quantity_total == null && ` · unlimited`}
            {!tt.active && " · INACTIVE"}
            {tt.requires_age_verification && ` · ${tt.minimum_age}+`}
          </div>
        </div>
        <div style={{
          fontFamily: "'Space Mono', monospace", fontSize: 14,
          color: BRAND.gray, marginLeft: 12,
        }}>
          {expanded ? "▾" : "▸"}
        </div>
      </button>

      {/* Expanded editor */}
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1a1a1a" }}>
          <Field label="Name *" error={errors.name} BRAND={BRAND}>
            <input
              type="text"
              value={tt.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="General Admission / VIP / Early Bird"
              style={inputStyle(BRAND)}
            />
          </Field>

          <Field label="Description" BRAND={BRAND}>
            <input
              type="text"
              value={tt.description || ""}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="What this tier includes"
              style={inputStyle(BRAND)}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Field
              label="Price *"
              error={errors.price_cents}
              BRAND={BRAND}
              help={priceLocked ? "Locked — tickets sold" : "Buyer pays this + Square processing"}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: BRAND.accent, fontFamily: "'Space Mono', monospace" }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={priceLocked}
                  value={tt.price_cents == null ? "" : (tt.price_cents / 100).toFixed(2)}
                  onChange={(e) => {
                    const dollars = parseFloat(e.target.value);
                    onChange({ price_cents: isNaN(dollars) ? 0 : Math.round(dollars * 100) });
                  }}
                  placeholder="25.00"
                  style={{
                    ...inputStyle(BRAND),
                    opacity: priceLocked ? 0.5 : 1,
                    cursor: priceLocked ? "not-allowed" : "text",
                  }}
                />
              </div>
            </Field>

            <Field label="Quantity Available" error={errors.quantity_total} BRAND={BRAND} help="Blank = unlimited">
              <input
                type="number"
                min={tt.quantity_sold || 0}
                value={tt.quantity_total ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange({ quantity_total: val === "" ? null : Number(val) });
                }}
                placeholder="unlimited"
                style={inputStyle(BRAND)}
              />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label="Sales Start" BRAND={BRAND} help="Leave blank = on sale now">
              <input
                type="datetime-local"
                value={isoToLocalInput(tt.sale_starts_at)}
                onChange={(e) => onChange({ sale_starts_at: localInputToIso(e.target.value) })}
                style={inputStyle(BRAND)}
              />
            </Field>
            <Field label="Sales End" BRAND={BRAND} help="Leave blank = sells until event start">
              <input
                type="datetime-local"
                value={isoToLocalInput(tt.sale_ends_at)}
                onChange={(e) => onChange({ sale_ends_at: localInputToIso(e.target.value) })}
                style={inputStyle(BRAND)}
              />
            </Field>
          </div>

          {/* Age verification */}
          <div style={{
            marginTop: 16, padding: "12px 14px",
            background: tt.requires_age_verification ? BRAND.accent + "11" : "#141414",
            border: `1px solid ${tt.requires_age_verification ? BRAND.accentMuted : "#222"}`,
            borderRadius: 10,
          }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: 12 }}>
              <input
                type="checkbox"
                checked={tt.requires_age_verification}
                onChange={(e) => onChange({ requires_age_verification: e.target.checked })}
                style={{ width: 18, height: 18, cursor: "pointer", accentColor: BRAND.accent }}
              />
              <span style={{
                fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
                letterSpacing: 1, color: BRAND.white,
              }}>
                Require age verification at purchase
              </span>
            </label>
            {tt.requires_age_verification && (
              <div style={{ marginTop: 10, paddingLeft: 30 }}>
                <Field label="Minimum Age" error={errors.minimum_age} BRAND={BRAND}>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={tt.minimum_age}
                    onChange={(e) => onChange({ minimum_age: Number(e.target.value) })}
                    style={{ ...inputStyle(BRAND), maxWidth: 100 }}
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Active toggle */}
          <div style={{
            marginTop: 12, padding: "12px 14px",
            background: tt.active ? "#2ecc7111" : "#141414",
            border: `1px solid ${tt.active ? "#2ecc7144" : "#222"}`,
            borderRadius: 10,
          }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: 12 }}>
              <input
                type="checkbox"
                checked={tt.active}
                onChange={(e) => onChange({ active: e.target.checked })}
                style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#2ecc71" }}
              />
              <div>
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
                  letterSpacing: 1, color: BRAND.white,
                }}>
                  Active and on sale
                </div>
                <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 2 }}>
                  Deactivate to stop new sales without canceling existing tickets
                </div>
              </div>
            </label>
          </div>

         {/* Remove button — only show when there are no sales */}
          {(tt._new || (tt.quantity_sold || 0) === 0) ? (
            <button onClick={onRemove} style={{
              marginTop: 16, width: "100%", padding: "10px",
              background: "transparent", border: "1px solid #e74c3c44",
              borderRadius: 10, color: "#e74c3c",
              fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600,
              letterSpacing: 2, cursor: "pointer",
            }}>
              REMOVE TICKET TYPE
            </button>
          ) : (
            <div style={{
              marginTop: 16, padding: "10px 14px",
              background: "#0a0a0a", border: "1px solid #222",
              borderRadius: 10, color: "#666",
              fontFamily: "'Space Mono', monospace", fontSize: 10,
              letterSpacing: 1, textAlign: "center",
            }}>
              CAN'T DELETE — {tt.quantity_sold} TICKET{tt.quantity_sold === 1 ? "" : "S"} SOLD. REFUND TO ENABLE.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
