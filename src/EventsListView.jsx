/**
 * ============================================
 * WAITLESS — Events List (Admin)
 * ============================================
 *
 * FILE: src/EventsListView.jsx
 *
 * The "Events" tab inside per-venue AdminView. Shows all events for the
 * current venue with status, dates, ticket sales summary, and quick actions.
 *
 * Props:
 *   - venue: the current venue object (from AdminView)
 *   - BRAND: the theming object (from AdminView)
 *   - onCreateEvent: () => void — called when the user clicks "Create Event"
 *   - onEditEvent: (eventId) => void — called when the user clicks an event card
 *
 * Loads from Supabase:
 *   - events for this venue
 *   - ticket_types joined to each event (for sold/total counts)
 *   - aggregated ticket_orders revenue per event
 *
 * Data flow:
 *   - Single combined query via Supabase, no realtime (events change rarely)
 *   - Refresh on mount and when the parent tells it to (via key prop)
 * ============================================
 */

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/barOrderService";

// ============================================================================
// CONFIG
// ============================================================================

const FILTERS = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "drafts", label: "Drafts" },
];

const STATUS_CONFIG = {
  draft:       { label: "DRAFT",      color: "#888",    bg: "#88888822" },
  published:   { label: "ON SALE",    color: "#2ecc71", bg: "#2ecc7122" },
  sold_out:    { label: "SOLD OUT",   color: "#d4a843", bg: "#d4a84322" },
  ended:       { label: "ENDED",      color: "#666",    bg: "#66666622" },
  canceled:    { label: "CANCELED",   color: "#e74c3c", bg: "#e74c3c22" },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function EventsListView({ venue, BRAND, onCreateEvent, onEditEvent }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Pull events with their ticket_types nested
        const { data: eventRows, error: eventsErr } = await supabase
          .from("events")
          .select(`
            id, slug, name, description, status, starts_at, ends_at, doors_at,
            location_name, location_address, hero_image_url, capacity, created_at,
            ticket_types ( id, name, price_cents, quantity_total, quantity_sold, active )
          `)
          .eq("venue_id", venue.id)
          .order("starts_at", { ascending: false });

        if (eventsErr) throw eventsErr;

        // Pull paid revenue totals per event (aggregated)
        const { data: revenueRows } = await supabase
          .from("ticket_orders")
          .select("event_id, total_cents, fee_cents, status")
          .eq("venue_id", venue.id)
          .eq("status", "paid");

        // Compute per-event face-value revenue (subtotal, which is net of processing fee)
        const revenueByEvent = {};
        for (const r of revenueRows || []) {
          if (!revenueByEvent[r.event_id]) {
            revenueByEvent[r.event_id] = { gross_cents: 0, face_cents: 0, orders: 0 };
          }
          revenueByEvent[r.event_id].gross_cents += r.total_cents || 0;
          revenueByEvent[r.event_id].face_cents += (r.total_cents || 0) - (r.fee_cents || 0);
          revenueByEvent[r.event_id].orders += 1;
        }

        const merged = (eventRows || []).map((ev) => ({
          ...ev,
          _revenue: revenueByEvent[ev.id] || { gross_cents: 0, face_cents: 0, orders: 0 },
        }));

        if (!cancelled) {
          setEvents(merged);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load events");
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [venue.id]);

  // Apply filter
  const filteredEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((ev) => {
      if (filter === "drafts") return ev.status === "draft";
      if (filter === "upcoming") {
        const startTime = new Date(ev.starts_at).getTime();
        return startTime > now && ev.status !== "canceled" && ev.status !== "draft";
      }
      if (filter === "past") {
        const endTime = new Date(ev.ends_at).getTime();
        return endTime <= now || ev.status === "ended";
      }
      return true;
    });
  }, [events, filter]);

  // Filter counts (for the badge on each tab)
  const counts = useMemo(() => {
    const now = Date.now();
    return {
      all: events.length,
      drafts: events.filter((e) => e.status === "draft").length,
      upcoming: events.filter((e) => {
        const startTime = new Date(e.starts_at).getTime();
        return startTime > now && e.status !== "canceled" && e.status !== "draft";
      }).length,
      past: events.filter((e) => {
        const endTime = new Date(e.ends_at).getTime();
        return endTime <= now || e.status === "ended";
      }).length,
    };
  }, [events]);

  return (
    <div style={{ padding: "20px 16px 80px", maxWidth: 900, margin: "0 auto" }}>
      {/* Header row */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        marginBottom: 20,
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            color: BRAND.dimText,
            letterSpacing: 3,
            textTransform: "uppercase",
            marginBottom: 4,
          }}>
            {venue.name}
          </div>
          <h1 style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 2,
            margin: 0,
            color: BRAND.white,
          }}>
            EVENTS
          </h1>
        </div>
        <button
          onClick={onCreateEvent}
          style={{
            padding: "12px 22px",
            background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
            border: "none",
            borderRadius: 12,
            color: BRAND.white,
            fontFamily: "'Oswald', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 2,
            cursor: "pointer",
            boxShadow: `0 4px 20px ${BRAND.primaryGlow}`,
          }}
        >
          + CREATE EVENT
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        marginBottom: 20,
        paddingBottom: 16,
        borderBottom: "1px solid #1a1a1a",
      }}>
        {FILTERS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              padding: "7px 14px",
              borderRadius: 20,
              border: filter === tab.key ? `1px solid ${BRAND.primary}` : "1px solid #333",
              background: filter === tab.key ? BRAND.primary + "22" : "transparent",
              color: filter === tab.key ? BRAND.primary : BRAND.gray,
              fontFamily: "'Oswald', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {tab.label}
            <span style={{
              background: filter === tab.key ? BRAND.primary : "#333",
              color: filter === tab.key ? BRAND.white : BRAND.gray,
              width: 20,
              height: 20,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontFamily: "'Space Mono', monospace",
            }}>
              {counts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Loading / error / empty / list */}
      {loading ? (
        <LoadingState BRAND={BRAND} />
      ) : error ? (
        <ErrorState BRAND={BRAND} message={error} />
      ) : filteredEvents.length === 0 ? (
        <EmptyState BRAND={BRAND} filter={filter} onCreateEvent={onCreateEvent} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredEvents.map((ev) => (
            <EventCard
              key={ev.id}
              event={ev}
              BRAND={BRAND}
              onClick={() => onEditEvent(ev.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CARD
// ============================================================================

function EventCard({ event, BRAND, onClick }) {
  const status = STATUS_CONFIG[event.status] || STATUS_CONFIG.draft;

  // Aggregate ticket type stats
  const totalCapacity = (event.ticket_types || []).reduce(
    (sum, tt) => sum + (tt.quantity_total ?? 0),
    0
  );
  const totalSold = (event.ticket_types || []).reduce(
    (sum, tt) => sum + (tt.quantity_sold || 0),
    0
  );
  const hasUnlimitedTiers = (event.ticket_types || []).some((tt) => tt.quantity_total == null);

  const startDate = new Date(event.starts_at);
  const dateLine = startDate.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeLine = startDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        background: BRAND.cardBg,
        border: "1px solid #222",
        borderRadius: 14,
        padding: "16px 18px",
        cursor: "pointer",
        textAlign: "left",
        color: BRAND.white,
        fontFamily: "'Inter', sans-serif",
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = BRAND.accentMuted;
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#222";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 12,
        marginBottom: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: 1,
            margin: 0,
            color: BRAND.white,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {event.name}
          </h3>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 11,
            color: BRAND.dimText,
            marginTop: 2,
            letterSpacing: 1,
          }}>
            /{event.slug}
          </div>
        </div>
        <div style={{
          padding: "4px 10px",
          borderRadius: 12,
          background: status.bg,
          border: `1px solid ${status.color}44`,
          fontFamily: "'Space Mono', monospace",
          fontSize: 9,
          fontWeight: 700,
          color: status.color,
          letterSpacing: 2,
          whiteSpace: "nowrap",
        }}>
          {status.label}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 12,
        fontSize: 13,
        color: BRAND.gray,
      }}>
        {/* When */}
        <div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 9,
            color: BRAND.dimText,
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 2,
          }}>
            When
          </div>
          <div style={{ color: BRAND.white }}>{dateLine}</div>
          <div style={{ fontSize: 12, color: BRAND.gray }}>{timeLine}</div>
        </div>

        {/* Where */}
        {event.location_name && (
          <div>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 9,
              color: BRAND.dimText,
              letterSpacing: 2,
              textTransform: "uppercase",
              marginBottom: 2,
            }}>
              Where
            </div>
            <div style={{
              color: BRAND.white,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {event.location_name}
            </div>
          </div>
        )}

        {/* Sales */}
        <div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 9,
            color: BRAND.dimText,
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 2,
          }}>
            Tickets Sold
          </div>
          <div style={{ color: BRAND.white, fontFamily: "'Space Mono', monospace" }}>
            {totalSold}{hasUnlimitedTiers ? "" : ` / ${totalCapacity}`}
          </div>
        </div>

        {/* Revenue */}
        <div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 9,
            color: BRAND.dimText,
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 2,
          }}>
            Revenue
          </div>
          <div style={{ color: BRAND.accent, fontFamily: "'Space Mono', monospace" }}>
            ${(event._revenue.face_cents / 100).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Ticket type chips */}
      {event.ticket_types && event.ticket_types.length > 0 && (
        <div style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid #1a1a1a",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}>
          {event.ticket_types.map((tt) => (
            <div key={tt.id} style={{
              padding: "3px 8px",
              borderRadius: 6,
              background: tt.active ? "#222" : "transparent",
              border: tt.active ? "1px solid #333" : "1px dashed #333",
              fontFamily: "'Space Mono', monospace",
              fontSize: 10,
              color: tt.active ? BRAND.gray : BRAND.dimText,
              letterSpacing: 0.5,
            }}>
              {tt.name} · ${(tt.price_cents / 100).toFixed(2)}
              {tt.quantity_total != null && ` · ${tt.quantity_sold || 0}/${tt.quantity_total}`}
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

// ============================================================================
// STATES
// ============================================================================

function LoadingState({ BRAND }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "80px 20px",
      gap: 16,
    }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: "3px solid #222",
        borderTopColor: BRAND.accent,
        animation: "spin 1s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{
        fontFamily: "'Space Mono', monospace",
        fontSize: 11,
        color: BRAND.dimText,
        letterSpacing: 2,
      }}>
        LOADING EVENTS...
      </div>
    </div>
  );
}

function ErrorState({ BRAND, message }) {
  return (
    <div style={{
      padding: "32px 20px",
      textAlign: "center",
      background: "#e74c3c11",
      border: "1px solid #e74c3c44",
      borderRadius: 12,
    }}>
      <div style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 14,
        fontWeight: 600,
        color: "#e74c3c",
        letterSpacing: 2,
        marginBottom: 8,
      }}>
        COULDN'T LOAD EVENTS
      </div>
      <div style={{ fontSize: 13, color: BRAND.gray }}>{message}</div>
    </div>
  );
}

function EmptyState({ BRAND, filter, onCreateEvent }) {
  const messages = {
    all: { title: "No events yet", sub: "Create your first event to start selling tickets." },
    upcoming: { title: "No upcoming events", sub: "Create an event or check the Drafts tab." },
    past: { title: "No past events", sub: "Events that have ended will appear here." },
    drafts: { title: "No drafts", sub: "Events you're still putting together will appear here." },
  };
  const { title, sub } = messages[filter] || messages.all;

  return (
    <div style={{
      padding: "60px 20px",
      textAlign: "center",
      background: BRAND.cardBg,
      border: "1px dashed #333",
      borderRadius: 16,
    }}>
      <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }}>🎟️</div>
      <div style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 18,
        fontWeight: 600,
        color: BRAND.white,
        letterSpacing: 1,
        marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{
        fontSize: 13,
        color: BRAND.gray,
        marginBottom: 20,
        maxWidth: 320,
        margin: "0 auto 20px",
      }}>
        {sub}
      </div>
      {filter !== "past" && (
        <button
          onClick={onCreateEvent}
          style={{
            padding: "12px 24px",
            background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`,
            border: "none",
            borderRadius: 10,
            color: BRAND.white,
            fontFamily: "'Oswald', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 2,
            cursor: "pointer",
          }}
        >
          + CREATE EVENT
        </button>
      )}
    </div>
  );
}
