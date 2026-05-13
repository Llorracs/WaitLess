/**
 * ============================================
 * WAITLESS — Ticket Orders View (Chunk 10B)
 * ============================================
 *
 * FILE: src/TicketOrdersView.jsx
 *
 * Top-level view rendered inside the "Ticket Orders" tab of AdminView.
 *
 * Chunk 10B scope (this file):
 *   - LIST: search, filters, pills, summary (from 10A)
 *   - DETAIL: full order info, ticket list with checkboxes, smart refund button
 *   - REFUND MODAL: reason picker, confirm, error handling
 *   - After refund: refresh order in place, show toast, stay on detail
 *
 * Chunk 10C will polish: empty/loading states, partial refund display,
 * mobile responsive tuning.
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

// Standard refund reasons. Must match backend STANDARD_REASONS keys exactly.
const REFUND_REASONS = [
  { key: "customer_cancellation", label: "Customer requested cancellation" },
  { key: "buyer_no_show",         label: "Buyer unable to attend" },
  { key: "event_cancelled",       label: "Event cancelled" },
  { key: "duplicate_purchase",    label: "Duplicate purchase" },
  { key: "order_error",           label: "Order error" },
  { key: "other",                 label: "Other" },
];

export default function TicketOrdersView({ venue, BRAND }) {
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  const [orders, setOrders] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("default");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  useEffect(() => {
    if (!venue?.id) return;
    loadData();
  }, [venue?.id]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
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

    if (sortBy === "newest") {
      result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortBy === "oldest") {
      result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (sortBy === "highest") {
      result.sort((a, b) => (b.total_cents || 0) - (a.total_cents || 0));
    }

    return result;
  }, [orders, statusFilter, eventFilter, searchQuery, dateFrom, dateTo, sortBy]);

  const summary = useMemo(() => {
    const totalRevenue = filtered.reduce((sum, o) => sum + (o.total_cents || 0), 0);
    const totalRefunded = filtered.reduce((sum, o) => sum + (o.refund_amount_cents || 0), 0);
    return {
      count: filtered.length,
      grossCents: totalRevenue,
      refundedCents: totalRefunded,
      netCents: totalRevenue - totalRefunded,
    };
  }, [filtered]);

  if (selectedOrderId !== null) {
    return (
      <TicketOrderDetail
        orderId={selectedOrderId}
        venue={venue}
        onBack={() => {
          setSelectedOrderId(null);
          loadData();
        }}
      />
    );
  }

  return (
    <div>
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

      <div style={S.filterGrid}>
        <div style={S.filterField}>
          <label style={S.filterLabel}>Event</label>
          <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} style={S.select}>
            <option value="all">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div style={S.filterField}>
          <label style={S.filterLabel}>From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={S.dateInput} />
        </div>
        <div style={S.filterField}>
          <label style={S.filterLabel}>To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={S.dateInput} />
        </div>
        <div style={S.filterField}>
          <label style={S.filterLabel}>Sort</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={S.select}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="highest">Highest value</option>
          </select>
        </div>
      </div>

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

      <div style={S.resultsBar}>
        <span style={S.resultsCount}>
          {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "order" : "orders"}`}
        </span>
        {orders.length >= FETCH_LIMIT && (
          <span style={S.limitWarning}>Showing latest {FETCH_LIMIT}. Use filters to narrow down.</span>
        )}
      </div>

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
        <OrderRow key={order.id} order={order} onClick={() => setSelectedOrderId(order.id)} />
      ))}
    </div>
  );
}

// ============================================================
// ORDER ROW (list view)
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
              <span style={S.totalCrossed}> of ${(totalCents / 100).toFixed(2)}</span>
            )}
          </div>
          <div style={S.orderDate}>{dateStr} · {timeStr}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ORDER DETAIL — drill-in view
// ============================================================
function TicketOrderDetail({ orderId, venue, onBack }) {
  const [order, setOrder] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [ticketTypes, setTicketTypes] = useState({});
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Per-ticket selection for partial refunds
  const [selected, setSelected] = useState(new Set());

  // Refund modal
  const [showRefundModal, setShowRefundModal] = useState(false);

  // Toast
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  async function loadOrder() {
    setLoading(true);
    setError(null);
    try {
      const { data: o, error: oErr } = await supabase
        .from("ticket_orders")
        .select("*")
        .eq("id", orderId)
        .single();
      if (oErr) throw oErr;

      const { data: tks, error: tErr } = await supabase
        .from("tickets")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (tErr) throw tErr;

      const ttIds = [...new Set((tks || []).map((t) => t.ticket_type_id).filter(Boolean))];
      let ttMap = {};
      if (ttIds.length > 0) {
        const { data: tts } = await supabase
          .from("ticket_types")
          .select("id, name, price_cents")
          .in("id", ttIds);
        ttMap = Object.fromEntries((tts || []).map((tt) => [tt.id, tt]));
      }

      let eventRow = null;
      if (o.event_id) {
        const { data: ev } = await supabase
          .from("events")
          .select("id, name, starts_at, ends_at")
          .eq("id", o.event_id)
          .single();
        eventRow = ev || null;
      }

      setOrder(o);
      setTickets(tks || []);
      setTicketTypes(ttMap);
      setEvent(eventRow);
      setSelected(new Set());
    } catch (e) {
      console.error("Order detail load failed:", e);
      setError(e.message || "Failed to load order");
    } finally {
      setLoading(false);
    }
  }

  const flashToast = (msg, kind = "success") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };

  // ===========================================================
  // Refund logic
  // ===========================================================
  const refundableTickets = useMemo(() => tickets.filter((t) => t.status === "valid"), [tickets]);
  const checkedInTickets  = useMemo(() => tickets.filter((t) => t.status === "checked_in"), [tickets]);

  const canRefundAnything = order?.status === "paid" && refundableTickets.length > 0;
  const canFullRefund     = canRefundAnything && checkedInTickets.length === 0;

  const toggleSelected = (ticketId, ticketStatus) => {
    if (ticketStatus !== "valid") return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const refundMode = selected.size > 0 ? "tickets" : "full";

  const refundButtonLabel = (() => {
    if (!canRefundAnything) return "NOTHING TO REFUND";
    if (selected.size > 0) {
      return `REFUND ${selected.size} SELECTED TICKET${selected.size === 1 ? "" : "S"}`;
    }
    if (!canFullRefund) {
      return `CAN'T REFUND FULL — ${checkedInTickets.length} CHECKED IN`;
    }
    return "REFUND FULL ORDER";
  })();

  const refundButtonDisabled =
    !canRefundAnything ||
    (selected.size === 0 && !canFullRefund);

  const refundAmountPreview = useMemo(() => {
    if (selected.size === 0) {
      return (order?.total_cents || 0) - (order?.refund_amount_cents || 0);
    }
    return tickets
      .filter((t) => selected.has(t.id))
      .reduce((sum, t) => {
        const price = t.price_paid_cents ?? ticketTypes[t.ticket_type_id]?.price_cents ?? 0;
        return sum + price;
      }, 0);
  }, [selected, tickets, order, ticketTypes]);

  // ===========================================================
  // Submission
  // ===========================================================
  async function handleRefundSubmit({ reasonKey, otherText }) {
    setShowRefundModal(false);

    const reason = reasonKey === "other"
      ? `other:${otherText.trim()}`
      : reasonKey;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      flashToast("Auth session expired. Please log in again.", "error");
      return;
    }

    const payload = {
      orderId: order.id,
      mode: refundMode,
      reason,
    };
    if (refundMode === "tickets") {
      payload.ticketIds = Array.from(selected);
    }

    try {
      const resp = await fetch("/.netlify/functions/process-refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();

      if (!resp.ok || !data.success) {
        let msg = data.error || "Refund failed";
        if (data.details) msg += ` — ${data.details}`;
        if (data.squareErrors && Array.isArray(data.squareErrors)) {
          const squareMsg = data.squareErrors.map((e) => e.detail || e.code).join("; ");
          if (squareMsg) msg += ` (Square: ${squareMsg})`;
        }
        flashToast(msg, "error");
        return;
      }

      const dollars = (data.refundAmountCents / 100).toFixed(2);
      const ticketWord = data.refundedTicketCount === 1 ? "ticket" : "tickets";
      flashToast(`Refunded $${dollars} (${data.refundedTicketCount} ${ticketWord})`, "success");

      await loadOrder();
    } catch (e) {
      console.error("Refund request failed:", e);
      flashToast(`Network error: ${e.message}`, "error");
    }
  }

  // ===========================================================
  // Render
  // ===========================================================
  if (loading) {
    return (
      <div>
        <button onClick={onBack} style={S.backBtn}>← BACK TO ORDERS</button>
        <div style={S.loadingBox}>Loading order…</div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div>
        <button onClick={onBack} style={S.backBtn}>← BACK TO ORDERS</button>
        <div style={S.errorBox}>
          <strong>Couldn't load order:</strong> {error || "Not found"}
        </div>
      </div>
    );
  }

  const refundCents = order.refund_amount_cents || 0;
  const totalCents = order.total_cents || 0;
  const netCents = totalCents - refundCents;
  const isFullyRefunded = order.status === "refunded";
  const isPartiallyRefunded = order.status === "paid" && refundCents > 0;

  const eventDateStr = event?.starts_at
    ? new Date(event.starts_at).toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        year: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "—";

  const createdStr = new Date(order.created_at).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  return (
    <div>
      <button onClick={onBack} style={S.backBtn}>← BACK TO ORDERS</button>

      {toast && (
        <div style={{ ...S.toast, background: toast.kind === "error" ? "#e74c3c" : "#2ecc71" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={S.detailHeader}>
        <div>
          <div style={S.detailEventName}>{event?.name || "Event deleted"}</div>
          <div style={S.detailEventDate}>{eventDateStr}</div>
        </div>
        <div style={S.detailHeaderRight}>
          {isFullyRefunded && (
            <div style={{ ...S.statusBadge, color: "#e74c3c", background: "#e74c3c15", borderColor: "#e74c3c44" }}>
              FULLY REFUNDED
            </div>
          )}
          {isPartiallyRefunded && (
            <div style={{ ...S.statusBadge, color: "#d4a843", background: "#d4a84315", borderColor: "#d4a84344" }}>
              PARTIALLY REFUNDED
            </div>
          )}
          {!isFullyRefunded && !isPartiallyRefunded && order.status === "paid" && (
            <div style={{ ...S.statusBadge, color: "#2ecc71", background: "#2ecc7115", borderColor: "#2ecc7144" }}>
              PAID
            </div>
          )}
          {order.status === "pending" && (
            <div style={{ ...S.statusBadge, color: "#888", background: "#88888815", borderColor: "#88888844" }}>
              PENDING
            </div>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div style={S.infoGrid}>
        <div style={S.infoCard}>
          <div style={S.infoCardLabel}>Buyer</div>
          <div style={S.infoCardValue}>{order.buyer_name || "—"}</div>
          <div style={S.infoCardSub}>{order.buyer_email}</div>
          {order.buyer_phone && <div style={S.infoCardSub}>{order.buyer_phone}</div>}
        </div>
        <div style={S.infoCard}>
          <div style={S.infoCardLabel}>Order Total</div>
          <div style={S.infoCardValue}>${(totalCents / 100).toFixed(2)}</div>
          {refundCents > 0 && (
            <>
              <div style={{ ...S.infoCardSub, color: "#e74c3c" }}>
                −${(refundCents / 100).toFixed(2)} refunded
              </div>
              <div style={{ ...S.infoCardSub, color: "#2ecc71", fontWeight: 600 }}>
                ${(netCents / 100).toFixed(2)} net
              </div>
            </>
          )}
        </div>
        <div style={S.infoCard}>
          <div style={S.infoCardLabel}>Ordered</div>
          <div style={{ ...S.infoCardValue, fontSize: 14 }}>{createdStr}</div>
        </div>
        <div style={S.infoCard}>
          <div style={S.infoCardLabel}>Square Payment</div>
          <div style={{ ...S.infoCardSub, fontFamily: "'Space Mono', monospace", wordBreak: "break-all", color: "#888" }}>
            {order.square_payment_id || "—"}
          </div>
          {order.square_refund_id && (
            <div style={{ ...S.infoCardSub, fontFamily: "'Space Mono', monospace", wordBreak: "break-all", color: "#e74c3c", marginTop: 4 }}>
              Refund: {order.square_refund_id}
            </div>
          )}
        </div>
      </div>

      {/* Tickets section */}
      <div style={S.sectionHeader}>
        <span>TICKETS ({tickets.length})</span>
        {canRefundAnything && (
          <span style={S.sectionSubLabel}>
            Select tickets for partial refund, or leave unselected for full order refund
          </span>
        )}
      </div>

      {tickets.length === 0 && (
        <div style={S.emptyState}>No tickets in this order.</div>
      )}

      {tickets.map((t) => (
        <TicketRow
          key={t.id}
          ticket={t}
          ticketType={ticketTypes[t.ticket_type_id]}
          selected={selected.has(t.id)}
          onToggle={() => toggleSelected(t.id, t.status)}
          selectable={t.status === "valid" && order.status === "paid"}
        />
      ))}

      {/* Refund button */}
      {order.status === "paid" && (
        <div style={S.refundButtonRow}>
          <button
            onClick={() => setShowRefundModal(true)}
            disabled={refundButtonDisabled}
            style={{
              ...S.refundButton,
              ...(refundButtonDisabled ? S.refundButtonDisabled : {}),
            }}
          >
            <div>{refundButtonLabel}</div>
            {!refundButtonDisabled && refundAmountPreview > 0 && (
              <div style={S.refundAmountPreview}>
                ${(refundAmountPreview / 100).toFixed(2)}
              </div>
            )}
          </button>
          {checkedInTickets.length > 0 && selected.size === 0 && refundableTickets.length > 0 && (
            <p style={S.refundHelp}>
              Some tickets are already checked in. Select individual valid tickets above to refund them, or refund the remaining valid tickets only.
            </p>
          )}
        </div>
      )}

      {/* Refund history */}
      {refundCents > 0 && order.refund_reason && (
        <div style={S.refundHistory}>
          <div style={S.refundHistoryLabel}>Refund Reason</div>
          <div style={S.refundHistoryValue}>{formatReasonForDisplay(order.refund_reason)}</div>
          {order.refunded_at && (
            <div style={S.refundHistoryDate}>
              Last refund: {new Date(order.refunded_at).toLocaleString("en-US", {
                month: "short", day: "numeric", year: "numeric",
                hour: "numeric", minute: "2-digit",
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showRefundModal && (
        <RefundModal
          mode={refundMode}
          ticketCount={refundMode === "full" ? refundableTickets.length : selected.size}
          amountCents={refundAmountPreview}
          buyerEmail={order.buyer_email}
          onCancel={() => setShowRefundModal(false)}
          onConfirm={handleRefundSubmit}
        />
      )}
    </div>
  );
}

// ============================================================
// TICKET ROW (in detail view)
// ============================================================
function TicketRow({ ticket, ticketType, selected, onToggle, selectable }) {
  const status = ticket.status || "unknown";
  const typeName = ticketType?.name || "—";
  const pricePaid = ticket.price_paid_cents ?? ticketType?.price_cents ?? 0;

  let statusInfo;
  if (status === "valid") {
    statusInfo = { label: "VALID", color: "#2ecc71", bg: "#2ecc7115" };
  } else if (status === "checked_in") {
    statusInfo = { label: "CHECKED IN", color: "#1E4D8C", bg: "#1E4D8C22" };
  } else if (status === "refunded") {
    statusInfo = { label: "REFUNDED", color: "#e74c3c", bg: "#e74c3c15" };
  } else {
    statusInfo = { label: status.toUpperCase(), color: "#888", bg: "#88888815" };
  }

  return (
    <div
      onClick={selectable ? onToggle : undefined}
      style={{
        ...S.ticketRow,
        opacity: selectable ? 1 : 0.55,
        cursor: selectable ? "pointer" : "default",
        borderColor: selected ? "#1E4D8C" : "#222",
        background: selected ? "#1E4D8C11" : "#141414",
      }}
    >
      <div style={S.ticketRowLeft}>
        {selectable ? (
          <div style={{ ...S.checkbox, ...(selected ? S.checkboxChecked : {}) }}>
            {selected ? "✓" : ""}
          </div>
        ) : (
          <div style={{ ...S.checkbox, opacity: 0.3 }}>—</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <div style={S.ticketAttendee}>
            {ticket.attendee_name || <em style={{ color: "#666" }}>Unnamed</em>}
          </div>
          {ticket.attendee_email && (
            <div style={S.ticketAttendeeEmail}>{ticket.attendee_email}</div>
          )}
          <div style={S.ticketType}>{typeName}</div>
          {status === "checked_in" && ticket.checked_in_at && (
            <div style={S.ticketCheckedInAt}>
              Checked in {new Date(ticket.checked_in_at).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </div>
          )}
          {status === "refunded" && ticket.refunded_at && (
            <div style={{ ...S.ticketCheckedInAt, color: "#e74c3c" }}>
              Refunded {new Date(ticket.refunded_at).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </div>
          )}
        </div>
      </div>
      <div style={S.ticketRowRight}>
        <div style={{ ...S.statusBadge, color: statusInfo.color, background: statusInfo.bg, borderColor: `${statusInfo.color}44` }}>
          {statusInfo.label}
        </div>
        <div style={S.ticketPrice}>${(pricePaid / 100).toFixed(2)}</div>
      </div>
    </div>
  );
}

// ============================================================
// REFUND MODAL
// ============================================================
function RefundModal({ mode, ticketCount, amountCents, buyerEmail, onCancel, onConfirm }) {
  const [reasonKey, setReasonKey] = useState("");
  const [otherText, setOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    reasonKey !== "" &&
    !submitting &&
    (reasonKey !== "other" || otherText.trim().length >= 3);

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    await onConfirm({ reasonKey, otherText });
  };

  return (
    <div
      style={S.modalBackdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={S.modal}>
        <div style={S.modalHeader}>
          <h3 style={S.modalTitle}>Confirm Refund</h3>
          <button onClick={onCancel} style={S.modalCloseBtn}>×</button>
        </div>

        <div style={S.modalSummary}>
          <div style={S.modalSummaryRow}>
            <span style={S.modalSummaryLabel}>
              {mode === "full" ? "Refunding full order" : `Refunding ${ticketCount} ticket${ticketCount === 1 ? "" : "s"}`}
            </span>
            <span style={S.modalSummaryAmount}>${(amountCents / 100).toFixed(2)}</span>
          </div>
          <div style={S.modalSummarySub}>
            To {buyerEmail} via Square. Processing fees are not refunded.
          </div>
        </div>

        <div style={S.modalSection}>
          <div style={S.modalSectionLabel}>Reason</div>
          <div style={S.reasonList}>
            {REFUND_REASONS.map((r) => (
              <label
                key={r.key}
                style={{ ...S.reasonOption, ...(reasonKey === r.key ? S.reasonOptionActive : {}) }}
              >
                <input
                  type="radio"
                  name="refund_reason"
                  value={r.key}
                  checked={reasonKey === r.key}
                  onChange={() => setReasonKey(r.key)}
                  style={S.radio}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>

          {reasonKey === "other" && (
            <textarea
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="Specify a reason (min. 3 characters)"
              style={S.textarea}
              rows={3}
              autoFocus
            />
          )}
        </div>

        <div style={S.modalActions}>
          <button onClick={onCancel} style={S.modalCancelBtn} disabled={submitting}>
            CANCEL
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            style={{ ...S.modalConfirmBtn, ...(!canSubmit ? S.modalConfirmBtnDisabled : {}) }}
          >
            {submitting ? "PROCESSING…" : `REFUND $${(amountCents / 100).toFixed(2)}`}
          </button>
        </div>

        <p style={S.modalDisclaimer}>
          This action is irreversible. The refund will appear on the buyer's original payment method within 5–10 business days. They'll also receive a confirmation email.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// HELPERS
// ============================================================
function formatReasonForDisplay(rawReason) {
  if (!rawReason) return "";
  if (rawReason.startsWith("other:")) {
    return `Other — ${rawReason.slice(6).trim()}`;
  }
  const labelMap = {
    customer_cancellation: "Customer requested cancellation",
    buyer_no_show: "Buyer unable to attend",
    event_cancelled: "Event cancelled",
    duplicate_purchase: "Duplicate purchase",
    order_error: "Order error",
  };
  return labelMap[rawReason] || rawReason;
}

// ============================================================
// STYLES
// ============================================================
const S = {
  // Summary bar
  summaryBar: {
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
    gap: 8, marginBottom: 20, padding: "16px",
    background: "#141414", borderRadius: 12, border: "1px solid #222",
  },
  summaryItem: { display: "flex", flexDirection: "column", gap: 4 },
  summaryLabel: {
    fontFamily: "'Space Mono', monospace", fontSize: 9,
    color: "#666", letterSpacing: 2, textTransform: "uppercase",
  },
  summaryValue: {
    fontFamily: "'Oswald', sans-serif", fontSize: 18,
    fontWeight: 700, letterSpacing: 1, color: "#f5f5f5",
  },

  // Search
  searchRow: { position: "relative", marginBottom: 12 },
  searchInput: {
    padding: "12px 40px 12px 14px", background: "#1a1a1a",
    border: "1px solid #333", borderRadius: 10, color: "#f5f5f5",
    fontFamily: "'Inter', sans-serif", fontSize: 14,
    outline: "none", width: "100%",
  },
  clearBtn: {
    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
    width: 28, height: 28, borderRadius: 6, border: "none",
    background: "#222", color: "#888", fontSize: 18, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },

  // Pills
  pillRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 },
  pill: {
    padding: "6px 14px", borderRadius: 999, border: "1px solid #333",
    background: "transparent", color: "#888",
    fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 500,
    letterSpacing: 2, cursor: "pointer", textTransform: "uppercase",
  },
  pillActive: { background: "#1E4D8C22", borderColor: "#1E4D8C", color: "#1E4D8C" },

  // Filters
  filterGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
    gap: 10, marginBottom: 14,
  },
  filterField: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  filterLabel: {
    fontFamily: "'Space Mono', monospace", fontSize: 9,
    color: "#666", letterSpacing: 1, textTransform: "uppercase",
  },
  select: {
    padding: "10px", background: "#1a1a1a", border: "1px solid #333",
    borderRadius: 8, color: "#f5f5f5", fontFamily: "'Inter', sans-serif",
    fontSize: 13, outline: "none", width: "100%",
  },
  dateInput: {
    padding: "10px", background: "#1a1a1a", border: "1px solid #333",
    borderRadius: 8, color: "#f5f5f5", fontFamily: "'Inter', sans-serif",
    fontSize: 13, outline: "none", width: "100%", colorScheme: "dark",
  },
  clearFiltersBtn: {
    padding: "8px 14px", background: "transparent", border: "1px solid #333",
    borderRadius: 8, color: "#888",
    fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 2,
    cursor: "pointer", marginBottom: 12,
  },

  // Results bar
  resultsBar: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 0", marginBottom: 8, borderBottom: "1px solid #222",
  },
  resultsCount: {
    fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#888", letterSpacing: 1,
  },
  limitWarning: {
    fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#d4a843", letterSpacing: 1,
  },

  // Error/empty/loading
  errorBox: {
    padding: 16, background: "#e74c3c15", border: "1px solid #e74c3c44",
    borderRadius: 10, color: "#e74c3c", fontSize: 13, marginBottom: 12,
  },
  emptyState: {
    padding: "40px 20px", textAlign: "center",
    color: "#666", fontSize: 14, fontStyle: "italic",
  },
  loadingBox: {
    padding: "40px 20px", textAlign: "center", color: "#888",
    fontFamily: "'Space Mono', monospace", fontSize: 12, letterSpacing: 2,
  },

  // List row
  orderRow: {
    padding: "14px 16px", background: "#141414",
    border: "1px solid #1a1a1a", borderRadius: 10, marginBottom: 8,
    cursor: "pointer", transition: "border-color 0.15s",
  },
  orderRowMain: {
    display: "flex", justifyContent: "space-between",
    alignItems: "flex-start", gap: 12,
  },
  orderRowLeft: {
    display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1,
  },
  buyerName: {
    fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 500,
    color: "#f5f5f5", letterSpacing: 0.5,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  buyerEmail: {
    fontSize: 12, color: "#888",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  eventLine: {
    fontFamily: "'Space Mono', monospace", fontSize: 10,
    color: "#666", letterSpacing: 1, marginTop: 2,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  orderRowRight: {
    display: "flex", flexDirection: "column", alignItems: "flex-end",
    gap: 4, flexShrink: 0,
  },
  statusBadge: {
    padding: "2px 8px", borderRadius: 4, border: "1px solid",
    fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 1.5,
  },
  orderTotal: {
    fontFamily: "'Space Mono', monospace", fontSize: 14,
    color: "#d4a843", fontWeight: 600,
  },
  totalCrossed: { fontSize: 10, color: "#666", textDecoration: "line-through" },
  orderDate: {
    fontFamily: "'Space Mono', monospace", fontSize: 10,
    color: "#666", letterSpacing: 1,
  },

  // Back button
  backBtn: {
    padding: "8px 16px", background: "transparent",
    border: "1px solid #333", borderRadius: 8, color: "#888",
    fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500,
    letterSpacing: 2, cursor: "pointer", marginBottom: 20,
  },

  // Toast
  toast: {
    position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)",
    padding: "12px 24px", borderRadius: 8, color: "#fff",
    fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
    letterSpacing: 1, zIndex: 100, maxWidth: 480, textAlign: "center",
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
  },

  // Detail header
  detailHeader: {
    display: "flex", justifyContent: "space-between",
    alignItems: "flex-start", gap: 16,
    padding: "20px", background: "#141414",
    borderRadius: 12, border: "1px solid #222", marginBottom: 16,
  },
  detailEventName: {
    fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 600,
    letterSpacing: 1, color: "#f5f5f5", marginBottom: 4,
  },
  detailEventDate: {
    fontFamily: "'Space Mono', monospace", fontSize: 12,
    color: "#888", letterSpacing: 1,
  },
  detailHeaderRight: {
    display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6,
  },

  // Info grid
  infoGrid: {
    display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10, marginBottom: 20,
  },
  infoCard: {
    padding: "14px 16px", background: "#0a0a0a",
    borderRadius: 10, border: "1px solid #1a1a1a",
    display: "flex", flexDirection: "column", gap: 4,
  },
  infoCardLabel: {
    fontFamily: "'Space Mono', monospace", fontSize: 9,
    color: "#666", letterSpacing: 2, textTransform: "uppercase",
    marginBottom: 2,
  },
  infoCardValue: {
    fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 500,
    color: "#f5f5f5", letterSpacing: 0.5,
  },
  infoCardSub: { fontSize: 12, color: "#888" },

  // Section header
  sectionHeader: {
    display: "flex", justifyContent: "space-between",
    alignItems: "baseline", flexWrap: "wrap", gap: 8,
    padding: "8px 0", marginTop: 8, marginBottom: 10,
    fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600,
    color: "#d4a843", letterSpacing: 3, textTransform: "uppercase",
    borderBottom: "1px solid #d4a8434d",
  },
  sectionSubLabel: {
    fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 400,
    color: "#666", letterSpacing: 0, textTransform: "none",
  },

  // Ticket row
  ticketRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 14px", borderRadius: 10, border: "1px solid",
    marginBottom: 6, transition: "all 0.15s",
  },
  ticketRowLeft: {
    display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 5, border: "2px solid #444",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, color: "#fff", flexShrink: 0,
  },
  checkboxChecked: { background: "#1E4D8C", borderColor: "#1E4D8C" },
  ticketAttendee: {
    fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500,
    color: "#f5f5f5", letterSpacing: 0.5,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  ticketAttendeeEmail: {
    fontSize: 11, color: "#888",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  ticketType: {
    fontFamily: "'Space Mono', monospace", fontSize: 10,
    color: "#666", letterSpacing: 1,
  },
  ticketCheckedInAt: {
    fontFamily: "'Space Mono', monospace", fontSize: 10,
    color: "#1E4D8C", letterSpacing: 0.5, marginTop: 2,
  },
  ticketRowRight: {
    display: "flex", flexDirection: "column", alignItems: "flex-end",
    gap: 4, flexShrink: 0,
  },
  ticketPrice: {
    fontFamily: "'Space Mono', monospace", fontSize: 13,
    color: "#d4a843", fontWeight: 600,
  },

  // Refund button
  refundButtonRow: { marginTop: 20, marginBottom: 16 },
  refundButton: {
    width: "100%", padding: "16px", borderRadius: 12, border: "none",
    background: "linear-gradient(135deg, #e74c3c, #d4a843)",
    color: "#fff", fontFamily: "'Oswald', sans-serif",
    fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: "pointer",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
    transition: "filter 0.15s",
  },
  refundButtonDisabled: {
    background: "#1a1a1a", color: "#555",
    cursor: "not-allowed", border: "1px solid #222",
  },
  refundAmountPreview: {
    fontFamily: "'Space Mono', monospace", fontSize: 18,
    letterSpacing: 1, fontWeight: 700,
  },
  refundHelp: {
    fontSize: 11, color: "#888", textAlign: "center",
    marginTop: 10, fontStyle: "italic", lineHeight: 1.5,
  },

  // Refund history
  refundHistory: {
    padding: "14px 16px", background: "#0a0a0a",
    borderRadius: 10, border: "1px solid #e74c3c22",
    marginTop: 16,
  },
  refundHistoryLabel: {
    fontFamily: "'Space Mono', monospace", fontSize: 9,
    color: "#e74c3c", letterSpacing: 2, textTransform: "uppercase",
    marginBottom: 4,
  },
  refundHistoryValue: { fontSize: 13, color: "#f5f5f5", marginBottom: 4 },
  refundHistoryDate: {
    fontFamily: "'Space Mono', monospace", fontSize: 10,
    color: "#666", letterSpacing: 1,
  },

  // Modal
  modalBackdrop: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 20, zIndex: 200,
  },
  modal: {
    background: "#141414", borderRadius: 16, border: "1px solid #333",
    padding: 24, maxWidth: 480, width: "100%",
    maxHeight: "90vh", overflowY: "auto",
    display: "flex", flexDirection: "column", gap: 16,
  },
  modalHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  modalTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 700,
    letterSpacing: 2, color: "#f5f5f5", margin: 0,
  },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 8, border: "none",
    background: "transparent", color: "#888", fontSize: 24, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  modalSummary: {
    padding: 14, background: "#0a0a0a",
    borderRadius: 10, border: "1px solid #222",
    display: "flex", flexDirection: "column", gap: 4,
  },
  modalSummaryRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  modalSummaryLabel: {
    fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 500,
    color: "#f5f5f5", letterSpacing: 0.5,
  },
  modalSummaryAmount: {
    fontFamily: "'Space Mono', monospace", fontSize: 18,
    color: "#d4a843", fontWeight: 700,
  },
  modalSummarySub: { fontSize: 11, color: "#666", marginTop: 2 },
  modalSection: { display: "flex", flexDirection: "column", gap: 8 },
  modalSectionLabel: {
    fontFamily: "'Space Mono', monospace", fontSize: 10,
    color: "#888", letterSpacing: 2, textTransform: "uppercase",
  },
  reasonList: { display: "flex", flexDirection: "column", gap: 6 },
  reasonOption: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 12px", borderRadius: 8, border: "1px solid #222",
    background: "#0a0a0a", cursor: "pointer",
    fontSize: 13, color: "#ccc", transition: "all 0.15s",
  },
  reasonOptionActive: {
    background: "#1E4D8C22", borderColor: "#1E4D8C", color: "#f5f5f5",
  },
  radio: { accentColor: "#1E4D8C", cursor: "pointer" },
  textarea: {
    padding: "10px 12px", background: "#0a0a0a",
    border: "1px solid #1E4D8C", borderRadius: 8,
    color: "#f5f5f5", fontFamily: "'Inter', sans-serif", fontSize: 13,
    outline: "none", width: "100%", resize: "vertical",
    marginTop: 4,
  },
  modalActions: { display: "flex", gap: 10, marginTop: 4 },
  modalCancelBtn: {
    flex: 1, padding: "12px", borderRadius: 10,
    border: "1px solid #333", background: "transparent", color: "#888",
    fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600,
    letterSpacing: 2, cursor: "pointer",
  },
  modalConfirmBtn: {
    flex: 2, padding: "12px", borderRadius: 10, border: "none",
    background: "linear-gradient(135deg, #e74c3c, #d4a843)", color: "#fff",
    fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 700,
    letterSpacing: 2, cursor: "pointer",
  },
  modalConfirmBtnDisabled: {
    background: "#1a1a1a", color: "#555",
    cursor: "not-allowed", border: "1px solid #222",
  },
  modalDisclaimer: {
    fontSize: 10, color: "#666", lineHeight: 1.5,
    textAlign: "center", margin: "4px 0 0", fontStyle: "italic",
  },

  // smallBtn (error retry)
  smallBtn: {
    padding: "6px 12px", borderRadius: 6, border: "none",
    background: "#1E4D8C", color: "#fff",
    fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600,
    letterSpacing: 1, cursor: "pointer",
  },
};
