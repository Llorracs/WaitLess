/**
 * ============================================
 * WAITLESS — Revenue & Analytics Dashboard
 * ============================================
 * 
 * FILE: src/AnalyticsView.jsx
 * 
 * Embedded inside the admin dashboard as a tab.
 * Shows venue owners their sales data.
 * ============================================
 */

import { useState, useEffect } from "react";
import { supabase } from "./lib/barOrderService";

const TIME_RANGES = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "7 Days", days: 7 },
  { key: "30d", label: "30 Days", days: 30 },
  { key: "90d", label: "90 Days", days: 90 },
];

export default function AnalyticsView({ venue, BRAND }) {
  const [range, setRange] = useState("7d");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrders();
  }, [range, venue.id]);

  async function loadOrders() {
    setLoading(true);

    const selectedRange = TIME_RANGES.find((r) => r.key === range);
    let startDate;

    if (selectedRange.days === 0) {
      // Today
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - selectedRange.days);
    }

    const { data, error } = await supabase
      .from("bar_orders")
      .select("*")
      .eq("venue_id", venue.id)
      .gte("ordered_at", startDate.toISOString())
      .order("ordered_at", { ascending: false });

    if (!error) setOrders(data || []);
    setLoading(false);
  }

  // ---- CALCULATIONS ----
  const completedOrders = orders.filter((o) => o.status === "picked_up");
  const expiredOrders = orders.filter((o) => o.status === "expired");
  const activeOrders = orders.filter((o) => ["pending", "in_progress", "ready"].includes(o.status));

  // Revenue
  const totalRevenueCents = completedOrders.reduce((sum, o) => sum + (o.total_cents || 0), 0);
  const totalFeeCents = completedOrders.reduce((sum, o) => sum + (o.fee_cents || 0), 0);
  const subtotalCents = completedOrders.reduce((sum, o) => sum + (o.subtotal_cents || 0), 0);

  // Average times
  const makeTimes = completedOrders
    .filter((o) => o.ready_at && o.ordered_at)
    .map((o) => (new Date(o.ready_at) - new Date(o.ordered_at)) / 60000);
  const avgMakeTime = makeTimes.length > 0 ? (makeTimes.reduce((a, b) => a + b, 0) / makeTimes.length).toFixed(1) : "--";

  const pickupTimes = completedOrders
    .filter((o) => o.picked_up_at && o.ready_at)
    .map((o) => (new Date(o.picked_up_at) - new Date(o.ready_at)) / 60000);
  const avgPickupTime = pickupTimes.length > 0 ? (pickupTimes.reduce((a, b) => a + b, 0) / pickupTimes.length).toFixed(1) : "--";

  // Popular items
  const itemCounts = {};
  completedOrders.forEach((o) => {
    (o.items || []).forEach((item) => {
      const name = item.name || item.item_name;
      if (!itemCounts[name]) itemCounts[name] = { name, qty: 0, revenue: 0 };
      itemCounts[name].qty += item.qty || 1;
      itemCounts[name].revenue += (item.price || 0) * (item.qty || 1) * 100;
    });
  });
  const popularItems = Object.values(itemCounts).sort((a, b) => b.qty - a.qty).slice(0, 10);

  // Peak hours
  const hourCounts = {};
  completedOrders.forEach((o) => {
    const hour = new Date(o.ordered_at).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });
  const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];

  // Daily breakdown
  const dailyData = {};
  completedOrders.forEach((o) => {
    const date = new Date(o.ordered_at).toLocaleDateString();
    if (!dailyData[date]) dailyData[date] = { date, orders: 0, revenue: 0 };
    dailyData[date].orders += 1;
    dailyData[date].revenue += o.total_cents || 0;
  });
  const dailyBreakdown = Object.values(dailyData).sort((a, b) => new Date(b.date) - new Date(a.date));

  // Max for bar chart scaling
  const maxDailyRevenue = Math.max(...dailyBreakdown.map((d) => d.revenue), 1);

  return (
    <div style={S.container}>
      {/* Time range selector */}
      <div style={S.rangeBar}>
        {TIME_RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{ ...S.rangeBtn, ...(range === r.key ? S.rangeBtnActive : {}) }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={S.loading}>
          <div style={S.spinner} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div style={S.kpiGrid}>
            <KPICard
              label="TOTAL REVENUE"
              value={`$${(totalRevenueCents / 100).toFixed(2)}`}
              sub={`${completedOrders.length} completed orders`}
              color="#2ecc71"
            />
            <KPICard
              label="SERVICE FEES"
              value={`$${(totalFeeCents / 100).toFixed(2)}`}
              sub={`${venue.service_fee_percent}% of $${(subtotalCents / 100).toFixed(2)}`}
              color="#d4a843"
            />
            <KPICard
              label="AVG MAKE TIME"
              value={`${avgMakeTime} min`}
              sub="Order to ready"
              color="#3498db"
            />
            <KPICard
              label="AVG PICKUP TIME"
              value={`${avgPickupTime} min`}
              sub="Ready to picked up"
              color="#9b59b6"
            />
          </div>

          {/* Order status summary */}
          <div style={S.statusRow}>
            <StatusPill label="Active" count={activeOrders.length} color="#e91e8c" />
            <StatusPill label="Completed" count={completedOrders.length} color="#2ecc71" />
            <StatusPill label="Expired" count={expiredOrders.length} color="#e74c3c" />
          </div>

          {/* Daily revenue chart */}
          {dailyBreakdown.length > 0 && (
            <div style={S.section}>
              <h3 style={S.sectionTitle}>Daily Revenue</h3>
              <div style={S.chartContainer}>
                {dailyBreakdown.slice(0, 14).reverse().map((day) => (
                  <div key={day.date} style={S.chartCol}>
                    <div style={S.barWrapper}>
                      <div style={{
                        ...S.bar,
                        height: `${Math.max(4, (day.revenue / maxDailyRevenue) * 100)}%`,
                        background: `linear-gradient(180deg, #e91e8c, #d4a843)`,
                      }} />
                    </div>
                    <span style={S.chartLabel}>
                      {new Date(day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                    <span style={S.chartValue}>${(day.revenue / 100).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Popular items */}
          {popularItems.length > 0 && (
            <div style={S.section}>
              <h3 style={S.sectionTitle}>Top Sellers</h3>
              <div style={S.itemList}>
                {popularItems.map((item, i) => (
                  <div key={item.name} style={S.itemRow}>
                    <span style={S.itemRank}>#{i + 1}</span>
                    <span style={S.itemName}>{item.name}</span>
                    <span style={S.itemQty}>{item.qty} sold</span>
                    <span style={S.itemRevenue}>${(item.revenue / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Peak hours */}
          {Object.keys(hourCounts).length > 0 && (
            <div style={S.section}>
              <h3 style={S.sectionTitle}>Order Volume by Hour</h3>
              <div style={S.hourGrid}>
                {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                  const count = hourCounts[hour] || 0;
                  const maxCount = Math.max(...Object.values(hourCounts), 1);
                  const intensity = count / maxCount;
                  return (
                    <div key={hour} style={S.hourCell}>
                      <div style={{
                        ...S.hourBlock,
                        background: count > 0
                          ? `rgba(233, 30, 140, ${0.15 + intensity * 0.85})`
                          : "#1a1a1a",
                        border: count > 0 ? `1px solid rgba(233, 30, 140, ${0.3 + intensity * 0.5})` : "1px solid #222",
                      }}>
                        {count > 0 && <span style={S.hourCount}>{count}</span>}
                      </div>
                      <span style={S.hourLabel}>
                        {hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`}
                      </span>
                    </div>
                  );
                })}
              </div>
              {peakHour && (
                <p style={S.peakNote}>
                  Peak hour: {parseInt(peakHour[0]) === 0 ? "12:00 AM" : parseInt(peakHour[0]) < 12 ? `${peakHour[0]}:00 AM` : parseInt(peakHour[0]) === 12 ? "12:00 PM" : `${parseInt(peakHour[0]) - 12}:00 PM`} ({peakHour[1]} orders)
                </p>
              )}
            </div>
          )}

          {/* Recent orders */}
          <div style={S.section}>
            <h3 style={S.sectionTitle}>Recent Orders</h3>
            <div style={S.recentList}>
              {orders.slice(0, 20).map((order) => (
                <div key={order.id} style={S.recentRow}>
                  <div style={{
                    ...S.recentBadge,
                    backgroundColor: order.confirm_hex,
                  }}>
                    <span style={S.recentLetter}>{order.confirm_letter}</span>
                  </div>
                  <div style={S.recentInfo}>
                    <span style={S.recentColor}>{order.confirm_color} {order.confirm_letter}</span>
                    <span style={S.recentTime}>
                      {new Date(order.ordered_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  <span style={S.recentAmount}>${((order.total_cents || 0) / 100).toFixed(2)}</span>
                  <span style={{
                    ...S.recentStatus,
                    color: order.status === "picked_up" ? "#2ecc71" : order.status === "expired" ? "#e74c3c" : "#d4a843",
                  }}>
                    {order.status === "picked_up" ? "✓" : order.status === "expired" ? "✗" : "●"}
                  </span>
                </div>
              ))}
              {orders.length === 0 && (
                <p style={S.empty}>No orders in this time range</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================
function KPICard({ label, value, sub, color }) {
  return (
    <div style={S.kpiCard}>
      <span style={{ ...S.kpiLabel, color }}>{label}</span>
      <span style={S.kpiValue}>{value}</span>
      <span style={S.kpiSub}>{sub}</span>
    </div>
  );
}

function StatusPill({ label, count, color }) {
  return (
    <div style={{ ...S.statusPill, borderColor: color + "44", background: color + "11" }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      <span style={{ color, fontSize: 12, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>{count}</span>
      <span style={{ color: "#888", fontSize: 11 }}>{label}</span>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const S = {
  container: { display: "flex", flexDirection: "column", gap: 20 },

  // Range selector
  rangeBar: { display: "flex", gap: 8, flexWrap: "wrap" },
  rangeBtn: {
    padding: "8px 16px", borderRadius: 8, border: "1px solid #333", background: "transparent",
    color: "#888", fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500,
    letterSpacing: 1, cursor: "pointer",
  },
  rangeBtnActive: { background: "#e91e8c22", borderColor: "#e91e8c", color: "#e91e8c" },

  loading: { display: "flex", justifyContent: "center", padding: 60 },
  spinner: { width: 36, height: 36, borderRadius: "50%", border: "3px solid #222", borderTopColor: "#e91e8c", animation: "spin 1s linear infinite" },

  // KPI cards
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 },
  kpiCard: {
    padding: "16px", background: "#141414", borderRadius: 12, border: "1px solid #222",
    display: "flex", flexDirection: "column", gap: 4,
  },
  kpiLabel: { fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 2 },
  kpiValue: { fontFamily: "'Oswald', sans-serif", fontSize: 28, fontWeight: 700 },
  kpiSub: { fontSize: 11, color: "#666" },

  // Status row
  statusRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  statusPill: {
    display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
    borderRadius: 8, border: "1px solid",
  },

  // Sections
  section: { marginTop: 8 },
  sectionTitle: {
    fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600,
    letterSpacing: 3, color: "#d4a843", textTransform: "uppercase",
    marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #d4a8431a",
  },

  // Chart
  chartContainer: {
    display: "flex", gap: 4, alignItems: "flex-end", height: 160,
    padding: "0 4px", overflowX: "auto",
  },
  chartCol: { flex: 1, minWidth: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  barWrapper: { width: "100%", height: 120, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  bar: { width: "70%", borderRadius: "4px 4px 0 0", minHeight: 4, transition: "height 0.5s ease" },
  chartLabel: { fontFamily: "'Space Mono', monospace", fontSize: 8, color: "#666", whiteSpace: "nowrap" },
  chartValue: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#888" },

  // Popular items
  itemList: { display: "flex", flexDirection: "column", gap: 4 },
  itemRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
    background: "#141414", borderRadius: 8, border: "1px solid #222",
  },
  itemRank: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#e91e8c", width: 24 },
  itemName: { flex: 1, fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, letterSpacing: 0.5 },
  itemQty: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#888" },
  itemRevenue: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#d4a843" },

  // Peak hours
  hourGrid: {
    display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 4,
  },
  hourCell: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  hourBlock: {
    width: "100%", aspectRatio: "1", borderRadius: 6,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  hourCount: { fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#fff", fontWeight: 700 },
  hourLabel: { fontFamily: "'Space Mono', monospace", fontSize: 7, color: "#666" },
  peakNote: {
    fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#888",
    letterSpacing: 1, marginTop: 8, textAlign: "center",
  },

  // Recent orders
  recentList: { display: "flex", flexDirection: "column", gap: 4 },
  recentRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
    background: "#141414", borderRadius: 8, border: "1px solid #222",
  },
  recentBadge: {
    width: 32, height: 32, borderRadius: 6, display: "flex",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  recentLetter: { fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700, color: "#fff" },
  recentInfo: { flex: 1, display: "flex", flexDirection: "column" },
  recentColor: { fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 500, letterSpacing: 0.5 },
  recentTime: { fontSize: 10, color: "#666" },
  recentAmount: { fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#d4a843" },
  recentStatus: { fontSize: 14, width: 20, textAlign: "center" },
  empty: { textAlign: "center", color: "#666", padding: 40, fontSize: 13 },
};
