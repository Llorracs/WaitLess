/**
 * ============================================
 * WAITLESS — Ticket Orders View (Chunk 10A)
 * ============================================
 *
 * FILE: src/TicketOrdersView.jsx
 *
 * Top-level view rendered inside the "Ticket Orders" tab of AdminView.
 *
 * Chunk 10A scope (this file):
 *   - List of ticket_orders for this venue
 *   - Filters: search (email/name), date range, event, status
 *   - Click a row → drill into TicketOrderDetail (placeholder for 10B)
 *   - Hides 'pending' orders by default (toggleable via status filter)
 *   - Client-side filter, server-side fetch capped at 500 rows
 *
 * Chunk 10B will fill in TicketOrderDetail (refund flow).
 * Chunk 10C will polish empty/loading states, partial refund display,
 * and mobile-responsive tuning.
 * ============================================
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/barOrderService";

const FETCH_LIMIT = 500;

// Status filter options. 'all' includes pending; default excludes it.
const STATUS_FILTERS = [
  { key: "default",        label: "Active",            matches: (o) => o.status === "paid" || o.status === "refunded" },
  { key: "paid",           label: "Paid",              matches: (o) => o.status === "paid" && (o.refund_amount_cents || 0) === 0 },
  { key: "partial_refund", label: "Partially Refunded", matches: (o) => o.status === "paid" && (o.refund_amount_cents || 0) > 0 },
  { key: "refunded",       label: "Fully Refunded",    matches: (o) => o.status === "refunded" },
  { key: "pending",        label: "Pending",           matches: (o) => o.status === "pending" },
  { key: "all",            label: "All",               matches: () => true },
];

export default function TicketOrdersView({ venue, BRAND }) {
  // Drill-in state: null = list view, uuid = order detail view
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // Data
  const [orders, setOrders] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [eventFilter, setEventFilter] = useState("all"); // 'all' | event_id
  const [statusFilter, setStatusFilter] = useState("default");
  const [dateFrom, setDateFrom] = useState(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState("");

  // Sort
  const [sortBy, setSortBy] = useState("newest"); // 'newest' | 'oldest' | 'highest'

  // ============================================================
  // FETCH ORDERS + EVENTS
  // ============================================================
  useEffect(() => {
    if (!venue?.id) return;
    loadData();
  }, [venue?.id]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      // Fetch orders for this venue, newest first, with event name joined
      const ordersPromise = supabase
        .from("ticket_orders")
        .select(`
          id,
          venue_id,
          event_id,
          status,
          total_cents,
          refund_amount_cents,
          buyer_name,
          buyer_email,
          square_payment_id,
          square_refund_id,
          created_at,
          refunded_at,
          events ( id, name, starts_at )
        `)
        .eq("venue_id", venue.id)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);

      // Fetch events for the event-filter dropdown
      const eventsPromise = supabase
        .from("events")
        .select("id, name, starts_at")
        .eq("venue_id", venue.id)
        .order("starts_at", { ascending: false });

      const [ordersRes, eventsRes] = await Promise.all([ordersPromise, eventsPromise]);

      if (ordersRes.error) throw ordersRes.error;
      if (eventsRes.error) throw eventsRes.error;

      setOrders(ordersRes.data || []);
      setEvents(eventsRes.data || []);
    } catch (e) {
      console.error("TicketOrdersView load failed:", e);
      setError(e.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // CLIENT-SIDE FILTER + SORT
  // ============================================================
  const filtered = useMemo(() => {
    const statusMatcher = STATUS_FILTERS.find((s) => s.key === statusFilter)?.matches || (() => true);
    const q = searchQuery.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom + "T00:00:00").getTime() : null;
    const toMs   = dateTo   ? new Date(dateTo   + "T23:59:59").getTime() : null;

    let result = orders.filter((o) => {
      if (!statusMatcher(o)) return false;

      if (eventFilter !== "all" && o.event_id !== eventFilter) return false;

      if (fromMs || toMs) {
        const createdMs = new Date(o.created_at).getTime();
        if (fromMs && createdMs < fromMs) return false;
        if (toMs && createdMs > toMs) return false;
      }

      if (q) {
        const haystack = `${o.buyer_name || ""} ${o.buyer_email || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    // Sort
    if (sortBy === "newest") {
      result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortBy === "oldest") {
      result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (sortBy === "highest") {
      result.sort((a, b) => (b.total_cents || 0) - (a.total_cents || 0));
    }

    return result;
  }, [orders, statusFilter, eventFilter, searchQuery, dateFrom, dateTo, sortBy]);

  // ============================================================
  // SUMMARY STATS (for the filtered set)
  // ============================================================
  const summary = useMemo(() => {
    const totalRevenue = filtered.reduce((sum, o) => sum + (o.total_cents || 0), 0);
    const totalRefunded = filtered.reduce((sum, o) => sum + (o.refund_amount_cents || 0), 0);
    const netRevenue = totalRevenue - totalRefunded;
    return {
      count: filtered.length,
      grossCents: totalRevenue,
      refundedCents: totalRefunded,
      netCents: netRevenue,
    };
  }, [filtered]);

  // ============================================================
  // DRILL-IN: order detail (Chunk 10B placeholder)
  // ============================================================
  if (selectedOrderId !== null) {
    return (
      <TicketOrderDetailPlaceholder
        orderId={selectedOrderId}
        onBack={() => {
          setSelectedOrderId(null);
          loadData(); // refresh in case a refund was issued
        }}
      />
    );
  }

  // ============================================================
  // RENDER — LIST VIEW
  // ============================================================
  return (
    <div>
      {/* Summary header */}
      <div style={S.summaryBar}>
        <div style={S.summaryItem}>
          <div style={S.summaryLabel}>Orders</div>
          <div style={S.summaryValue}>{summary.count}</div>
        </div>
        <div style={S.summaryItem}>
          <div style={S.summaryLabel}>Gross</div>
          <div style={S.summaryValue}>${(summary.grossCents / 100).toFixed(2)}</div>
        </div>
        <div style={S.summaryItem}>
          <div style={S.summaryLabel}>Refunded</div>
          <div style={{ ...S.summaryValue, color: summary.refundedCents > 0 ? "#e74c3c" : "#f5f5f5" }}>
            ${(summary.refundedCents / 100).toFixed(2)}
          </div>
        </div>
        <div style={S.summaryItem}>
          <div style={S.summaryLabel}>Net</div>
          <div style={{ ...S.summaryValue, color: "#2ecc71" }}>${(summary.netCents / 100).toFixed(2)}</div>
        </div>
      </div>

      {/* Search */}
      <div style={S.searchRow}>
        <input
          type="text"
          placeholder="Search buyer name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={S.searchInput}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")} style={S.clearBtn} title="Clear search">×</button>
        )}
      </div>

      {/* Filter row 1: status pills */}
      <div style={S.pillRow}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            style={{ ...S.pill, ...(statusFilter === f.key ? S.pillActive : {}) }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Filter row 2: event + date range + sort */}
      <div style={S.filterGrid}>
        <div style={S.filterField}>
          <label style={S.filterLabel}>Event</label>
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            style={S.select}
          >
            <option value="all">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div style={S.filterField}>
          <label style={S.filterLabel}>From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={S.dateInput}
          />
        </div>
        <div style={S.filterField}>
          <label style={S.filterLabel}>To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={S.dateInput}
          />
        </div>
        <div style={S.filterField}>
          <label style={S.filterLabel}>Sort</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={S.select}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="highest">Highest value</option>
          </select>
        </div>
      </div>

      {/* Clear all filters */}
      {(searchQuery || eventFilter !== "all" || dateFrom || dateTo || statusFilter !== "default") && (
        <button
          onClick={() => {
            setSearchQuery("");
            setEventFilter("all");
            setDateFrom("");
            setDateTo("");
            setStatusFilter("default");
          }}
          style={S.clearFiltersBtn}
        >
          ✕ CLEAR ALL FILTERS
        </button>
      )}

      {/* Results count */}
      <div style={S.resultsBar}>
        <span style={S.resultsCount}>
          {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "order" : "orders"}`}
        </span>
        {orders.length >= FETCH_LIMIT && (
          <span style={S.limitWarning}>
            Showing latest {FETCH_LIMIT}. Use filters to narrow down.
          </span>
        )}
      </div>

      {/* List */}
      {error && (
        <div style={S.errorBox}>
          <strong>Couldn't load orders:</strong> {error}
          <button onClick={loadData} style={{ ...S.smallBtn, marginLeft: 12 }}>RETRY</button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={S.emptyState}>
          {orders.length === 0
            ? "No ticket orders yet. When buyers purchase tickets, they'll show up here."
            : "No orders match your filters."}
        </div>
      )}

      {!loading && filtered.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          onClick={() => setSelectedOrderId(order.id)}
        />
      ))}
    </div>
  );
}

// ============================================================
// ORDER ROW
// ============================================================
function OrderRow({ order, onClick }) {
  const refundCents = order.refund_amount_cents || 0;
  const totalCents = order.total_cents || 0;
  const isFullyRefunded = order.status === "refunded";
  const isPartiallyRefunded = order.status === "paid" && refundCents > 0;
  const isPending = order.status === "pending";

  const statusBadge = isFullyRefunded
    ? { label: "REFUNDED",   color: "#e74c3c", bg: "#e74c3c15" }
    : isPartiallyRefunded
    ? { label: "PARTIAL",    color: "#d4a843", bg: "#d4a84315" }
    : isPending
    ? { label: "PENDING",    color: "#888",    bg: "#88888815" }
    : { label: "PAID",       color: "#2ecc71", bg: "#2ecc7115" };

  const createdDate = new Date(order.created_at);
  const dateStr = createdDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeStr = createdDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div onClick={onClick} style={S.orderRow}>
      <div style={S.orderRowMain}>
        <div style={S.orderRowLeft}>
          <div style={S.buyerName}>{order.buyer_name || "—"}</div>
          <div style={S.buyerEmail}>{order.buyer_email}</div>
          <div style={S.eventLine}>
            {order.events?.name || <em style={{ color: "#666" }}>Event deleted</em>}
          </div>
        </div>
        <div style={S.orderRowRight}>
          <div style={{ ...S.statusBadge, color: statusBadge.color, background: statusBadge.bg, borderColor: `${statusBadge.color}44` }}>
            {statusBadge.label}
          </div>
          <div style={S.orderTotal}>
            ${((totalCents - refundCents) / 100).toFixed(2)}
            {refundCents > 0 && (
              <span style={S.totalCrossed}>
                {" "}of ${(totalCents / 100).toFixed(2)}
              </span>
            )}
          </div>
          <div style={S.orderDate}>
            {dateStr} · {timeStr}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PLACEHOLDER — Chunk 10B will replace this
// ============================================================
function TicketOrderDetailPlaceholder({ orderId, onBack }) {
  return (
    <div>
      <button onClick={onBack} style={S.backBtn}>← BACK TO ORDERS</button>
      <div style={S.placeholderBox}>
        <div style={S.placeholderLabel}>Order Detail</div>
        <div style={S.placeholderId}>{orderId}</div>
        <div style={S.placeholderNote}>
          Coming in Chunk 10B — tickets list, refund flow, payment info.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================
const S = {
  // Summary bar
  summaryBar: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 8,
    marginBottom: 20,
    padding: "16px",
    background: "#141414",
    borderRadius: 12,
    border: "1px solid #222",
  },
  summaryItem: { display: "flex", flexDirection: "column", gap: 4 },
  summaryLabel: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 9,
    color: "#666",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  summaryValue: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 1,
    color: "#f5f5f5",
  },

  // Search
  searchRow: { position: "relative", marginBottom: 12 },
  searchInput: {
    padding: "12px 40px 12px 14px",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 10,
    color: "#f5f5f5",
    fontFamily: "'Inter', sans-serif",
    fontSize: 14,
    outline: "none",
    width: "100%",
  },
  clearBtn: {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: "translateY(-50%)",
    width: 28,
    height: 28,
    borderRadius: 6,
    border: "none",
    background: "#222",
    color: "#888",
    fontSize: 18,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  // Filter pills
  pillRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  pill: {
    padding: "6px 14px",
    borderRadius: 999,
    border: "1px solid #333",
    background: "transparent",
    color: "#888",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 2,
    cursor: "pointer",
    textTransform: "uppercase",
  },
  pillActive: {
    background: "#1E4D8C22",
    borderColor: "#1E4D8C",
    color: "#1E4D8C",
  },

  // Filter grid
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr 1fr",
    gap: 10,
    marginBottom: 14,
  },
  filterField: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  filterLabel: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 9,
    color: "#666",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  select: {
    padding: "10px",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#f5f5f5",
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    outline: "none",
    width: "100%",
  },
  dateInput: {
    padding: "10px",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#f5f5f5",
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    outline: "none",
    width: "100%",
    colorScheme: "dark",
  },
  clearFiltersBtn: {
    padding: "8px 14px",
    background: "transparent",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#888",
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    letterSpacing: 2,
    cursor: "pointer",
    marginBottom: 12,
  },

  // Results bar
  resultsBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    marginBottom: 8,
    borderBottom: "1px solid #222",
  },
  resultsCount: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 11,
    color: "#888",
    letterSpacing: 1,
  },
  limitWarning: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    color: "#d4a843",
    letterSpacing: 1,
  },

  // Error / empty / loading
  errorBox: {
    padding: 16,
    background: "#e74c3c15",
    border: "1px solid #e74c3c44",
    borderRadius: 10,
    color: "#e74c3c",
    fontSize: 13,
    marginBottom: 12,
  },
  emptyState: {
    padding: "40px 20px",
    textAlign: "center",
    color: "#666",
    fontSize: 14,
    fontStyle: "italic",
  },

  // Order row
  orderRow: {
    padding: "14px 16px",
    background: "#141414",
    border: "1px solid #1a1a1a",
    borderRadius: 10,
    marginBottom: 8,
    cursor: "pointer",
    transition: "border-color 0.15s",
  },
  orderRowMain: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  orderRowLeft: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 },
  buyerName: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 15,
    fontWeight: 500,
    color: "#f5f5f5",
    letterSpacing: 0.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  buyerEmail: {
    fontSize: 12,
    color: "#888",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  eventLine: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    color: "#666",
    letterSpacing: 1,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  orderRowRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
    flexShrink: 0,
  },
  statusBadge: {
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid",
    fontFamily: "'Space Mono', monospace",
    fontSize: 9,
    letterSpacing: 1.5,
  },
  orderTotal: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 14,
    color: "#d4a843",
    fontWeight: 600,
  },
  totalCrossed: {
    fontSize: 10,
    color: "#666",
    textDecoration: "line-through",
  },
  orderDate: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    color: "#666",
    letterSpacing: 1,
  },

  // Placeholder
  backBtn: {
    padding: "8px 16px",
    background: "transparent",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#888",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: 2,
    cursor: "pointer",
    marginBottom: 20,
  },
  placeholderBox: {
    padding: 40,
    background: "#141414",
    border: "1px dashed #333",
    borderRadius: 12,
    textAlign: "center",
  },
  placeholderLabel: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 14,
    color: "#d4a843",
    letterSpacing: 2,
    marginBottom: 8,
  },
  placeholderId: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 12,
    color: "#888",
    marginBottom: 16,
  },
  placeholderNote: {
    fontSize: 13,
    color: "#666",
    fontStyle: "italic",
  },

  // Small btn
  smallBtn: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    background: "#1E4D8C",
    color: "#fff",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 1,
    cursor: "pointer",
  },
};
