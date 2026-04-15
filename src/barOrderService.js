/**
 * ============================================
 * WAITLESS — SUPABASE INTEGRATION LAYER
 * ============================================
 * 
 * Multi-tenant version. Every function is scoped by venue_id.
 * Both the patron app and bartender queue import from here.
 * 
 * FILE: src/lib/barOrderService.js
 * 
 * SETUP:
 * 1. npm install @supabase/supabase-js
 * 2. Set environment variables:
 *    - VITE_SUPABASE_URL
 *    - VITE_SUPABASE_ANON_KEY
 * 3. Run trfq-bar-orders-schema-fixed.sql in Supabase SQL Editor
 * 4. Run waitless-multi-tenant-schema.sql in Supabase SQL Editor
 * 5. Enable Realtime on bar_orders, venues, menus tables
 * ============================================
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ============================================
// COLORS & LETTERS — shared between both apps
// ============================================
export const COLORS = [
  { name: "Red", hex: "#e74c3c" },
  { name: "Blue", hex: "#3498db" },
  { name: "Green", hex: "#2ecc71" },
  { name: "Gold", hex: "#d4a843" },
  { name: "Purple", hex: "#9b59b6" },
  { name: "Orange", hex: "#e67e22" },
  { name: "Pink", hex: "#e91e8c" },
  { name: "Teal", hex: "#1abc9c" },
  { name: "White", hex: "#ecf0f1" },
  { name: "Coral", hex: "#ff6b6b" },
];

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// ============================================
// VENUE FUNCTIONS
// ============================================

/**
 * Load venue config by slug.
 * This is the entry point — called when patron hits waitless.app/{slug}
 * 
 * @param {string} slug - The venue's URL slug (e.g., "trfq")
 * @returns {Object} Venue config (id, name, branding, Square config, etc.)
 */
export async function getVenueBySlug(slug) {
  const { data, error } = await supabase
    .rpc('get_venue_by_slug', { venue_slug: slug });

  if (error) throw error;
  if (!data || data.length === 0) throw new Error(`Venue "${slug}" not found`);
  return data[0];
}

/**
 * Load the full menu for a venue.
 * 
 * @param {string} venueId - The venue UUID
 * @returns {Array} Menu items grouped by category
 */
export async function getVenueMenu(venueId) {
  const { data, error } = await supabase
    .rpc('get_venue_menu', { p_venue_id: venueId });

  if (error) throw error;
  return data || [];
}

/**
 * Verify bartender PIN for a venue.
 * 
 * @param {string} venueId - The venue UUID
 * @param {string} pin - The PIN entered
 * @returns {boolean} Whether the PIN matches
 */
export async function verifyBartenderPin(venueId, pin) {
  const { data, error } = await supabase
    .rpc('verify_bartender_pin', { p_venue_id: venueId, p_pin: pin });

  if (error) throw error;
  return data;
}

// ============================================
// PATRON-SIDE FUNCTIONS
// ============================================

/**
 * Generate a unique letter/color combo for a specific venue.
 * Scoped so "Red M" can exist at two different venues simultaneously.
 * 
 * @param {string} venueId - The venue UUID
 */
export async function generateUniqueConfirmation(venueId) {
  const { data: active } = await supabase
    .from('bar_orders')
    .select('confirm_letter, confirm_color')
    .eq('venue_id', venueId)
    .in('status', ['pending', 'in_progress', 'ready']);

  const usedCombos = new Set(
    (active || []).map((o) => `${o.confirm_letter}-${o.confirm_color}`)
  );

  let attempts = 0;
  let letter, color;

  do {
    letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    color = COLORS[Math.floor(Math.random() * COLORS.length)];
    attempts++;
  } while (usedCombos.has(`${letter}-${color.name}`) && attempts < 260);

  return { letter, color };
}

/**
 * Create a new bar order after payment is confirmed.
 * Now includes venue_id to scope the order.
 * 
 * @param {Object} params
 * @param {string} params.venueId - The venue UUID
 * @param {string} params.letter - Confirmation letter
 * @param {Object} params.color - { name, hex }
 * @param {Array} params.items - [{ id, name, qty, price }]
 * @param {number} params.subtotalCents - Subtotal in cents
 * @param {number} params.feeCents - Service fee in cents
 * @param {number} params.totalCents - Total in cents
 * @param {string} params.squarePaymentId - Square payment ID
 * @param {string} params.squareOrderId - Square order ID
 * @returns {Object} The created order
 */
export async function createBarOrder({
  venueId,
  letter,
  color,
  items,
  subtotalCents,
  feeCents,
  totalCents,
  squarePaymentId,
  squareOrderId,
}) {
  const { data, error } = await supabase
    .from('bar_orders')
    .insert({
      venue_id: venueId,
      confirm_letter: letter,
      confirm_color: color.name,
      confirm_hex: color.hex,
      items,
      subtotal_cents: subtotalCents,
      fee_cents: feeCents,
      total_cents: totalCents,
      square_payment_id: squarePaymentId,
      square_order_id: squareOrderId,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Subscribe to a specific order's status changes.
 * Used on the patron's confirmation screen to detect "ready" status.
 * (No venue scoping needed — we filter by order ID which is globally unique)
 * 
 * @param {string} orderId - The order UUID
 * @param {Function} onStatusChange - Callback with (newStatus, updatedOrder)
 * @returns {Function} Unsubscribe function
 */
export function subscribeToOrder(orderId, onStatusChange) {
  const channel = supabase
    .channel(`order-${orderId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'bar_orders',
        filter: `id=eq.${orderId}`,
      },
      (payload) => {
        onStatusChange(payload.new.status, payload.new);
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ============================================
// BARTENDER-SIDE FUNCTIONS
// ============================================

/**
 * Subscribe to all active bar orders for a specific venue.
 * Bartender only sees their venue's queue.
 * 
 * @param {string} venueId - The venue UUID
 * @param {Function} onUpdate - Called with full updated order list
 * @returns {Function} Unsubscribe function
 */
export function subscribeToBartenderQueue(venueId, onUpdate) {
  // Initial fetch
  fetchActiveOrders(venueId).then(onUpdate);

  const channel = supabase
    .channel(`bartender-queue-${venueId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bar_orders',
        filter: `venue_id=eq.${venueId}`,
      },
      () => {
        // Re-fetch full queue on any change
        fetchActiveOrders(venueId).then(onUpdate);
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/**
 * Fetch all active orders for a specific venue's bartender queue.
 * 
 * @param {string} venueId - The venue UUID
 */
export async function fetchActiveOrders(venueId) {
  const { data, error } = await supabase
    .from('bar_orders')
    .select('*')
    .eq('venue_id', venueId)
    .in('status', ['pending', 'in_progress', 'ready'])
    .order('ordered_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Update order status — bartender actions.
 * (Order ID is globally unique, so no venue scoping needed on updates)
 */
export async function startMakingOrder(orderId) {
  const { error } = await supabase
    .from('bar_orders')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (error) throw error;
}

export async function markOrderReady(orderId) {
  const { error } = await supabase
    .from('bar_orders')
    .update({
      status: 'ready',
      ready_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (error) throw error;
}

export async function markOrderPickedUp(orderId) {
  const { error } = await supabase
    .from('bar_orders')
    .update({
      status: 'picked_up',
      picked_up_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (error) throw error;
}

/**
 * Expire old orders across all venues.
 * Called from a cron job or edge function.
 */
export async function expireOldOrders() {
  const { error } = await supabase.rpc('expire_old_orders');
  if (error) throw error;
}
