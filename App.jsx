/**
 * ============================================
 * WAITLESS — Dynamic Venue App
 * ============================================
 * 
 * FILE: src/App.jsx
 * 
 * The single entry point for all venues.
 * URL structure:
 *   waitless.app/{slug}            → Patron ordering view
 *   waitless.app/{slug}/bartender  → Bartender queue view
 * 
 * On load:
 * 1. Parses venue slug from URL
 * 2. Fetches venue config from Supabase (branding, Square config, menu)
 * 3. Renders the appropriate view with that venue's theme
 * ============================================
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getVenueBySlug,
  getVenueMenu,
  verifyBartenderPin,
  generateUniqueConfirmation,
  createBarOrder,
  subscribeToOrder,
  subscribeToBartenderQueue,
  fetchActiveOrders,
  startMakingOrder,
  markOrderReady,
  markOrderPickedUp,
  COLORS,
  LETTERS,
} from './lib/barOrderService';

// ============================================
// URL PARSING
// ============================================
function getRouteFromUrl() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const parts = path.split('/');
  const slug = parts[0] || null;
  const isBartender = parts[1] === 'bartender';
  return { slug, isBartender };
}

// ============================================
// MAIN APP
// ============================================
export default function App() {
  const [venue, setVenue] = useState(null);
  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { slug, isBartender } = getRouteFromUrl();

  useEffect(() => {
    if (!slug) {
      setError('No venue specified. Use: waitless.app/your-venue-slug');
      setLoading(false);
      return;
    }

    async function loadVenue() {
      try {
        const venueData = await getVenueBySlug(slug);
        setVenue(venueData);

        const menuData = await getVenueMenu(venueData.id);
        setMenu(menuData);
      } catch (err) {
        console.error('Failed to load venue:', err);
        setError(`Venue "${slug}" not found. Check the URL and try again.`);
      } finally {
        setLoading(false);
      }
    }

    loadVenue();
  }, [slug]);

  // Build CSS variables from venue branding
  const themeStyles = venue ? {
    '--brand-primary': venue.brand_colors?.primary || '#000000',
    '--brand-accent': venue.brand_colors?.accent || '#FFD700',
    '--brand-bg': venue.brand_colors?.background || '#111111',
  } : {};

  if (loading) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.loadingSpinner} />
        <p style={styles.loadingText}>Loading venue...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorScreen}>
        <h1 style={styles.errorTitle}>WAITLESS</h1>
        <p style={styles.errorMessage}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ ...styles.appContainer, ...themeStyles }}>
      {isBartender ? (
        <BartenderApp venue={venue} />
      ) : (
        <PatronApp venue={venue} menu={menu} />
      )}
    </div>
  );
}

// ============================================
// PATRON APP
// ============================================
function PatronApp({ venue, menu }) {
  const [screen, setScreen] = useState('menu');     // menu | cart | payment | processing | confirmation
  const [cart, setCart] = useState([]);
  const [order, setOrder] = useState(null);

  // Group menu items by category
  const menuByCategory = menu.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const categories = Object.keys(menuByCategory);
  const [activeCategory, setActiveCategory] = useState(categories[0] || '');

  // Cart helpers
  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      }
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (itemId) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === itemId);
      if (existing && existing.qty > 1) {
        return prev.map((c) => c.id === itemId ? { ...c, qty: c.qty - 1 } : c);
      }
      return prev.filter((c) => c.id !== itemId);
    });
  };

  const subtotalCents = cart.reduce((sum, item) => sum + (item.price_cents * item.qty), 0);
  const feeCents = Math.round(subtotalCents * (venue.service_fee_percent / 100));
  const totalCents = subtotalCents + feeCents;

  const handlePaymentSuccess = async (paymentResult) => {
    setScreen('processing');

    try {
      const { letter, color } = await generateUniqueConfirmation(venue.id);

      const newOrder = await createBarOrder({
        venueId: venue.id,
        letter,
        color,
        items: cart.map((item) => ({
          id: item.id,
          name: item.item_name,
          qty: item.qty,
          price: item.price_cents / 100,
        })),
        subtotalCents,
        feeCents,
        totalCents,
        squarePaymentId: paymentResult.paymentId,
        squareOrderId: paymentResult.orderId,
      });

      setOrder(newOrder);
      setCart([]);
      setScreen('confirmation');
    } catch (err) {
      console.error('Order creation failed:', err);
      setScreen('cart');
      alert('Something went wrong creating your order. Your payment was processed — please see a bartender.');
    }
  };

  // ---- MENU SCREEN ----
  if (screen === 'menu') {
    return (
      <div style={styles.patronContainer}>
        {/* Header */}
        <div style={styles.patronHeader}>
          {venue.logo_url && <img src={venue.logo_url} alt={venue.name} style={styles.venueLogo} />}
          <h1 style={{ ...styles.venueName, color: 'var(--brand-accent)' }}>{venue.name}</h1>
          {venue.tagline && <p style={styles.venueTagline}>{venue.tagline}</p>}
        </div>

        {/* Category tabs */}
        <div style={styles.categoryTabs}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                ...styles.categoryTab,
                ...(activeCategory === cat ? {
                  backgroundColor: 'var(--brand-accent)',
                  color: 'var(--brand-bg)',
                } : {}),
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Menu items */}
        <div style={styles.menuList}>
          {(menuByCategory[activeCategory] || []).map((item) => {
            const inCart = cart.find((c) => c.id === item.id);
            return (
              <div key={item.id} style={styles.menuItem}>
                <div style={styles.menuItemInfo}>
                  <span style={styles.menuItemName}>{item.item_name}</span>
                  {item.description && <span style={styles.menuItemDesc}>{item.description}</span>}
                </div>
                <div style={styles.menuItemRight}>
                  <span style={styles.menuItemPrice}>${(item.price_cents / 100).toFixed(2)}</span>
                  {inCart ? (
                    <div style={styles.qtyControls}>
                      <button style={styles.qtyBtn} onClick={() => removeFromCart(item.id)}>−</button>
                      <span style={styles.qtyCount}>{inCart.qty}</span>
                      <button style={styles.qtyBtn} onClick={() => addToCart(item)}>+</button>
                    </div>
                  ) : (
                    <button
                      style={{ ...styles.addBtn, backgroundColor: 'var(--brand-accent)', color: 'var(--brand-bg)' }}
                      onClick={() => addToCart(item)}
                    >
                      ADD
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Cart footer */}
        {cart.length > 0 && (
          <div style={styles.cartFooter} onClick={() => setScreen('cart')}>
            <span style={styles.cartFooterText}>
              View Cart ({cart.reduce((sum, c) => sum + c.qty, 0)} items)
            </span>
            <span style={styles.cartFooterTotal}>
              ${(totalCents / 100).toFixed(2)}
            </span>
          </div>
        )}
      </div>
    );
  }

  // ---- CART SCREEN ----
  if (screen === 'cart') {
    return (
      <div style={styles.patronContainer}>
        <div style={styles.screenHeader}>
          <button style={styles.backBtn} onClick={() => setScreen('menu')}>← Back</button>
          <h2 style={styles.screenTitle}>Your Order</h2>
        </div>

        <div style={styles.cartList}>
          {cart.map((item) => (
            <div key={item.id} style={styles.cartItem}>
              <div style={styles.cartItemInfo}>
                <span style={styles.cartItemName}>{item.item_name}</span>
                <span style={styles.cartItemPrice}>${(item.price_cents / 100).toFixed(2)} each</span>
              </div>
              <div style={styles.qtyControls}>
                <button style={styles.qtyBtn} onClick={() => removeFromCart(item.id)}>−</button>
                <span style={styles.qtyCount}>{item.qty}</span>
                <button style={styles.qtyBtn} onClick={() => addToCart(item)}>+</button>
              </div>
            </div>
          ))}
        </div>

        <div style={styles.cartTotals}>
          <div style={styles.totalRow}>
            <span>Subtotal</span>
            <span>${(subtotalCents / 100).toFixed(2)}</span>
          </div>
          <div style={styles.totalRow}>
            <span>Service Fee ({venue.service_fee_percent}%)</span>
            <span>${(feeCents / 100).toFixed(2)}</span>
          </div>
          <div style={{ ...styles.totalRow, ...styles.totalRowFinal }}>
            <span>Total</span>
            <span>${(totalCents / 100).toFixed(2)}</span>
          </div>
        </div>

        <button
          style={{ ...styles.payBtn, backgroundColor: 'var(--brand-accent)', color: 'var(--brand-bg)' }}
          onClick={() => setScreen('payment')}
        >
          Proceed to Payment
        </button>
      </div>
    );
  }

  // ---- PAYMENT SCREEN ----
  if (screen === 'payment') {
    return (
      <PaymentScreen
        venue={venue}
        totalCents={totalCents}
        items={cart}
        onSuccess={handlePaymentSuccess}
        onBack={() => setScreen('cart')}
      />
    );
  }

  // ---- PROCESSING SCREEN ----
  if (screen === 'processing') {
    return (
      <div style={styles.centeredScreen}>
        <div style={styles.loadingSpinner} />
        <p style={styles.processingText}>Sending your order to the bar...</p>
      </div>
    );
  }

  // ---- CONFIRMATION SCREEN ----
  if (screen === 'confirmation' && order) {
    return (
      <ConfirmationScreen
        order={order}
        venue={venue}
        onNewOrder={() => {
          setOrder(null);
          setScreen('menu');
        }}
      />
    );
  }

  return null;
}

// ============================================
// PAYMENT SCREEN
// ============================================
function PaymentScreen({ venue, totalCents, items, onSuccess, onBack }) {
  const cardContainerRef = useRef(null);
  const cardRef = useRef(null);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState(null);

  useEffect(() => {
    let card;

    async function initSquare() {
      if (!window.Square) {
        console.error('Square SDK not loaded');
        return;
      }

      const payments = window.Square.payments(venue.square_app_id, venue.square_location_id);
      card = await payments.card();
      await card.attach('#card-container');
      cardRef.current = card;
    }

    initSquare();

    return () => {
      if (card) card.destroy();
    };
  }, [venue]);

  const handlePay = async () => {
    if (!cardRef.current || paying) return;

    setPaying(true);
    setPaymentError(null);

    try {
      const result = await cardRef.current.tokenize();

      if (result.status !== 'OK') {
        throw new Error(result.errors?.[0]?.message || 'Card tokenization failed');
      }

      // Call our serverless function with venue ID
      const response = await fetch('/.netlify/functions/process-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          sourceId: result.token,
          amountCents: totalCents,
          items: items.map((i) => ({
            name: i.item_name,
            qty: i.qty,
            price: i.price_cents / 100,
          })),
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Payment failed');
      }

      onSuccess(data);
    } catch (err) {
      console.error('Payment error:', err);
      setPaymentError(err.message || 'Payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div style={styles.patronContainer}>
      <div style={styles.screenHeader}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <h2 style={styles.screenTitle}>Payment</h2>
      </div>

      <div style={styles.paymentAmount}>
        <span style={styles.paymentLabel}>Total</span>
        <span style={styles.paymentTotal}>${(totalCents / 100).toFixed(2)}</span>
      </div>

      <div id="card-container" ref={cardContainerRef} style={styles.cardContainer} />

      {paymentError && (
        <div style={styles.paymentErrorBox}>
          <p style={styles.paymentErrorText}>{paymentError}</p>
        </div>
      )}

      <button
        style={{
          ...styles.payBtn,
          backgroundColor: paying ? '#666' : 'var(--brand-accent)',
          color: 'var(--brand-bg)',
        }}
        onClick={handlePay}
        disabled={paying}
      >
        {paying ? 'Processing...' : `Pay $${(totalCents / 100).toFixed(2)}`}
      </button>
    </div>
  );
}

// ============================================
// CONFIRMATION SCREEN
// ============================================
function ConfirmationScreen({ order, venue, onNewOrder }) {
  const [status, setStatus] = useState(order.status);
  const [secondsLeft, setSecondsLeft] = useState(600);
  const isReady = status === 'ready';

  // Subscribe to order status changes
  useEffect(() => {
    const unsub = subscribeToOrder(order.id, (newStatus) => {
      setStatus(newStatus);
    });
    return unsub;
  }, [order.id]);

  // Countdown timer
  useEffect(() => {
    if (isReady) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(order.expires_at) - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [order.expires_at, isReady]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div style={{
      ...styles.centeredScreen,
      backgroundColor: isReady ? '#065f46' : 'var(--brand-bg)',
    }}>
      {isReady ? (
        <>
          <h1 style={styles.readyTitle}>YOUR DRINK IS READY!</h1>
          <p style={styles.readySubtext}>Show this screen to the bartender</p>
        </>
      ) : (
        <p style={styles.confirmSubtext}>Show this screen to pick up your drink</p>
      )}

      {/* Pulsing badge */}
      <div style={{
        ...styles.confirmBadge,
        backgroundColor: order.confirm_hex,
        animation: isReady ? 'pulse 0.5s ease-in-out infinite alternate' : 'pulse 1.5s ease-in-out infinite alternate',
      }}>
        <span style={styles.confirmLetter}>{order.confirm_letter}</span>
      </div>

      <p style={styles.confirmColorName}>{order.confirm_color} {order.confirm_letter}</p>

      {!isReady && (
        <p style={styles.confirmTimer}>
          Pickup window: {minutes}:{String(seconds).padStart(2, '0')}
        </p>
      )}

      <style>{`
        @keyframes pulse {
          from { transform: scale(1); box-shadow: 0 0 20px ${order.confirm_hex}40; }
          to { transform: scale(1.05); box-shadow: 0 0 40px ${order.confirm_hex}80; }
        }
      `}</style>
    </div>
  );
}

// ============================================
// BARTENDER APP
// ============================================
function BartenderApp({ venue }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Long-press on logo to show PIN pad (keeps it hidden from patrons)
  const longPressTimer = useRef(null);

  const handleLogoDown = () => {
    longPressTimer.current = setTimeout(() => {
      setAuthenticated(false);
      setPin('');
    }, 1500);
  };

  const handleLogoUp = () => {
    clearTimeout(longPressTimer.current);
  };

  // PIN entry
  const handlePinSubmit = async () => {
    const valid = await verifyBartenderPin(venue.id, pin);
    if (valid) {
      setAuthenticated(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPin('');
    }
  };

  // Subscribe to order queue
  useEffect(() => {
    if (!authenticated) return;

    const unsub = subscribeToBartenderQueue(venue.id, (updatedOrders) => {
      setOrders(updatedOrders);
    });

    return unsub;
  }, [authenticated, venue.id]);

  // ---- PIN SCREEN ----
  if (!authenticated) {
    return (
      <div style={styles.centeredScreen}>
        <h1 style={{ ...styles.venueName, color: 'var(--brand-accent)' }}>{venue.name}</h1>
        <p style={styles.pinLabel}>Enter Bartender PIN</p>

        <div style={styles.pinDots}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                ...styles.pinDot,
                backgroundColor: pin.length > i ? 'var(--brand-accent)' : '#333',
              }}
            />
          ))}
        </div>

        {pinError && <p style={styles.pinErrorText}>Invalid PIN</p>}

        <div style={styles.numpad}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'DEL'].map((key, i) => (
            <button
              key={i}
              style={styles.numpadBtn}
              onClick={() => {
                if (key === null) return;
                if (key === 'DEL') {
                  setPin((p) => p.slice(0, -1));
                  return;
                }
                const newPin = pin + String(key);
                setPin(newPin);
                if (newPin.length === 4) {
                  setTimeout(() => {
                    setPin(newPin);
                    handlePinSubmit();
                  }, 100);
                }
              }}
              disabled={key === null}
            >
              {key ?? ''}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- QUEUE SCREEN ----
  const filteredOrders = filter === 'all'
    ? orders
    : orders.filter((o) => o.status === filter);

  const getWaitColor = (orderedAt) => {
    const mins = (Date.now() - new Date(orderedAt)) / 60000;
    if (mins > 5) return '#ef4444';
    if (mins > 3) return '#eab308';
    return '#22c55e';
  };

  return (
    <div style={styles.bartenderContainer}>
      {/* Header */}
      <div style={styles.bartenderHeader}>
        <h1
          style={{ ...styles.venueName, color: 'var(--brand-accent)', cursor: 'pointer' }}
          onMouseDown={handleLogoDown}
          onMouseUp={handleLogoUp}
          onTouchStart={handleLogoDown}
          onTouchEnd={handleLogoUp}
        >
          {venue.name}
        </h1>
        <span style={styles.queueCount}>{orders.length} active</span>
      </div>

      {/* Filter tabs */}
      <div style={styles.filterTabs}>
        {['all', 'pending', 'in_progress', 'ready'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...styles.filterTab,
              ...(filter === f ? {
                backgroundColor: 'var(--brand-accent)',
                color: 'var(--brand-bg)',
              } : {}),
            }}
          >
            {f === 'all' ? 'All' : f === 'in_progress' ? 'Making' : f.charAt(0).toUpperCase() + f.slice(1)}
            {' '}({f === 'all' ? orders.length : orders.filter((o) => o.status === f).length})
          </button>
        ))}
      </div>

      {/* Order cards */}
      <div style={styles.orderList}>
        {filteredOrders.map((order) => (
          <div
            key={order.id}
            style={styles.orderCard}
            onClick={() => setSelectedOrder(order)}
          >
            <div style={{
              ...styles.orderBadge,
              backgroundColor: order.confirm_hex,
            }}>
              <span style={styles.orderBadgeLetter}>{order.confirm_letter}</span>
            </div>

            <div style={styles.orderInfo}>
              <span style={styles.orderColorLabel}>
                {order.confirm_color} {order.confirm_letter}
              </span>
              <span style={styles.orderItems}>
                {order.items?.map((i) => `${i.name} x${i.qty}`).join(', ')}
              </span>
            </div>

            <div style={styles.orderMeta}>
              <span style={{
                ...styles.orderWait,
                color: getWaitColor(order.ordered_at),
              }}>
                {Math.floor((Date.now() - new Date(order.ordered_at)) / 60000)}m
              </span>

              {order.status === 'pending' && (
                <button
                  style={{ ...styles.actionBtn, backgroundColor: '#3b82f6' }}
                  onClick={(e) => { e.stopPropagation(); startMakingOrder(order.id); }}
                >
                  START
                </button>
              )}
              {order.status === 'in_progress' && (
                <button
                  style={{ ...styles.actionBtn, backgroundColor: '#22c55e' }}
                  onClick={(e) => { e.stopPropagation(); markOrderReady(order.id); }}
                >
                  READY
                </button>
              )}
              {order.status === 'ready' && (
                <button
                  style={{ ...styles.actionBtn, backgroundColor: '#a855f7' }}
                  onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}
                >
                  VERIFY
                </button>
              )}
            </div>
          </div>
        ))}

        {filteredOrders.length === 0 && (
          <p style={styles.emptyQueue}>No orders in queue</p>
        )}
      </div>

      {/* Verification modal */}
      {selectedOrder && selectedOrder.status === 'ready' && (
        <div style={styles.modalOverlay} onClick={() => setSelectedOrder(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Verify & Hand Off</h2>

            <div style={{
              ...styles.modalBadge,
              backgroundColor: selectedOrder.confirm_hex,
            }}>
              <span style={styles.modalBadgeLetter}>{selectedOrder.confirm_letter}</span>
            </div>
            <p style={styles.modalColorName}>
              {selectedOrder.confirm_color} {selectedOrder.confirm_letter}
            </p>

            <p style={styles.modalHint}>
              Match this to the patron's screen, then hand off the drink.
            </p>

            <div style={styles.modalTimestamps}>
              <span>Ordered: {new Date(selectedOrder.ordered_at).toLocaleTimeString()}</span>
              {selectedOrder.ready_at && <span>Ready: {new Date(selectedOrder.ready_at).toLocaleTimeString()}</span>}
            </div>

            <button
              style={{ ...styles.handoffBtn, backgroundColor: 'var(--brand-accent)', color: 'var(--brand-bg)' }}
              onClick={() => {
                markOrderPickedUp(selectedOrder.id);
                setSelectedOrder(null);
              }}
            >
              VERIFY & HAND OFF
            </button>

            <button style={styles.modalClose} onClick={() => setSelectedOrder(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Lock button */}
      <button
        style={styles.lockBtn}
        onClick={() => {
          setAuthenticated(false);
          setPin('');
        }}
      >
        🔒 LOCK
      </button>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const styles = {
  // -- Global --
  appContainer: {
    minHeight: '100vh',
    backgroundColor: 'var(--brand-bg, #111)',
    color: '#fff',
    fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
  },

  // -- Loading & Error --
  loadingScreen: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', backgroundColor: '#111', color: '#fff',
  },
  loadingSpinner: {
    width: 40, height: 40, border: '3px solid #333', borderTopColor: '#fff',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },
  loadingText: { marginTop: 16, color: '#999', fontSize: 14 },
  errorScreen: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', backgroundColor: '#111', color: '#fff', padding: 24, textAlign: 'center',
  },
  errorTitle: { fontSize: 28, fontWeight: 800, letterSpacing: 4, marginBottom: 16 },
  errorMessage: { color: '#999', fontSize: 16, maxWidth: 400 },

  // -- Patron --
  patronContainer: {
    maxWidth: 480, margin: '0 auto', padding: '0 16px', paddingBottom: 100,
  },
  patronHeader: {
    textAlign: 'center', padding: '32px 0 16px',
  },
  venueLogo: { width: 80, height: 80, borderRadius: 12, objectFit: 'cover', marginBottom: 12 },
  venueName: { fontSize: 28, fontWeight: 800, letterSpacing: 3, margin: 0 },
  venueTagline: { color: '#999', fontSize: 13, marginTop: 4 },

  // -- Categories --
  categoryTabs: {
    display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 0',
    WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
  },
  categoryTab: {
    padding: '8px 16px', borderRadius: 20, border: '1px solid #333',
    backgroundColor: 'transparent', color: '#ccc', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s',
  },

  // -- Menu --
  menuList: { display: 'flex', flexDirection: 'column', gap: 2 },
  menuItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 0', borderBottom: '1px solid #222',
  },
  menuItemInfo: { display: 'flex', flexDirection: 'column', flex: 1 },
  menuItemName: { fontSize: 15, fontWeight: 600 },
  menuItemDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  menuItemRight: { display: 'flex', alignItems: 'center', gap: 12 },
  menuItemPrice: { fontSize: 15, fontWeight: 600, color: '#ccc' },
  addBtn: {
    padding: '6px 16px', borderRadius: 6, border: 'none', fontSize: 12,
    fontWeight: 800, cursor: 'pointer', letterSpacing: 1,
  },

  // -- Qty controls --
  qtyControls: { display: 'flex', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 28, height: 28, borderRadius: 6, border: '1px solid #444',
    backgroundColor: 'transparent', color: '#fff', fontSize: 16,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  qtyCount: { fontSize: 15, fontWeight: 600, minWidth: 16, textAlign: 'center' },

  // -- Cart footer --
  cartFooter: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 24px', backgroundColor: 'var(--brand-accent, #FFD700)',
    color: 'var(--brand-bg, #111)', cursor: 'pointer',
  },
  cartFooterText: { fontWeight: 700, fontSize: 15 },
  cartFooterTotal: { fontWeight: 800, fontSize: 17 },

  // -- Cart screen --
  screenHeader: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '24px 0 16px',
  },
  backBtn: {
    background: 'none', border: 'none', color: '#999', fontSize: 15, cursor: 'pointer',
  },
  screenTitle: { fontSize: 20, fontWeight: 700, margin: 0 },
  cartList: { display: 'flex', flexDirection: 'column' },
  cartItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 0', borderBottom: '1px solid #222',
  },
  cartItemInfo: { display: 'flex', flexDirection: 'column' },
  cartItemName: { fontSize: 15, fontWeight: 600 },
  cartItemPrice: { fontSize: 12, color: '#888' },

  // -- Totals --
  cartTotals: { padding: '20px 0', borderTop: '1px solid #333' },
  totalRow: {
    display: 'flex', justifyContent: 'space-between', padding: '6px 0',
    fontSize: 14, color: '#ccc',
  },
  totalRowFinal: { fontWeight: 800, fontSize: 18, color: '#fff', paddingTop: 12, borderTop: '1px solid #333' },
  payBtn: {
    width: '100%', padding: '16px', borderRadius: 10, border: 'none',
    fontSize: 16, fontWeight: 800, cursor: 'pointer', letterSpacing: 1, marginTop: 16,
  },

  // -- Payment --
  paymentAmount: {
    textAlign: 'center', padding: '32px 0',
  },
  paymentLabel: { fontSize: 14, color: '#999' },
  paymentTotal: { display: 'block', fontSize: 40, fontWeight: 800, marginTop: 4 },
  cardContainer: {
    padding: 16, backgroundColor: '#1a1a1a', borderRadius: 10,
    border: '1px solid #333', marginBottom: 16, minHeight: 50,
  },
  paymentErrorBox: {
    padding: 12, backgroundColor: '#7f1d1d', borderRadius: 8, marginBottom: 16,
  },
  paymentErrorText: { color: '#fca5a5', fontSize: 14, margin: 0 },

  // -- Confirmation --
  centeredScreen: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', padding: 24, textAlign: 'center', backgroundColor: 'var(--brand-bg, #111)',
  },
  processingText: { color: '#999', fontSize: 16 },
  confirmSubtext: { color: '#999', fontSize: 14, marginBottom: 24 },
  confirmBadge: {
    width: 160, height: 160, borderRadius: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  confirmLetter: { fontSize: 80, fontWeight: 900, color: '#fff' },
  confirmColorName: { fontSize: 24, fontWeight: 700, marginBottom: 8 },
  confirmTimer: { color: '#999', fontSize: 16, fontVariantNumeric: 'tabular-nums' },
  readyTitle: { fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 8 },
  readySubtext: { color: '#a7f3d0', fontSize: 16, marginBottom: 24 },

  // -- Bartender --
  bartenderContainer: {
    maxWidth: 900, margin: '0 auto', padding: '0 16px', paddingBottom: 80,
  },
  bartenderHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '24px 0',
  },
  queueCount: { color: '#999', fontSize: 14 },

  // -- PIN --
  pinLabel: { color: '#999', fontSize: 14, marginBottom: 24 },
  pinDots: { display: 'flex', gap: 12, marginBottom: 24 },
  pinDot: { width: 16, height: 16, borderRadius: 8, transition: 'background-color 0.15s' },
  pinErrorText: { color: '#ef4444', fontSize: 13, marginBottom: 16 },
  numpad: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 12,
    justifyContent: 'center',
  },
  numpadBtn: {
    width: 72, height: 56, borderRadius: 10, border: '1px solid #333',
    backgroundColor: '#1a1a1a', color: '#fff', fontSize: 22, fontWeight: 600,
    cursor: 'pointer',
  },

  // -- Filters --
  filterTabs: { display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' },
  filterTab: {
    padding: '8px 14px', borderRadius: 8, border: '1px solid #333',
    backgroundColor: 'transparent', color: '#ccc', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },

  // -- Order cards --
  orderList: { display: 'flex', flexDirection: 'column', gap: 8 },
  orderCard: {
    display: 'flex', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: '#1a1a1a', borderRadius: 10, cursor: 'pointer',
    border: '1px solid #222',
  },
  orderBadge: {
    width: 48, height: 48, borderRadius: 10, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  orderBadgeLetter: { fontSize: 24, fontWeight: 900, color: '#fff' },
  orderInfo: { flex: 1, display: 'flex', flexDirection: 'column' },
  orderColorLabel: { fontSize: 15, fontWeight: 700 },
  orderItems: { fontSize: 12, color: '#888', marginTop: 2 },
  orderMeta: { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 },
  orderWait: { fontSize: 15, fontWeight: 700 },
  actionBtn: {
    padding: '8px 16px', borderRadius: 8, border: 'none', color: '#fff',
    fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: 1,
  },
  emptyQueue: { textAlign: 'center', color: '#666', padding: 40 },

  // -- Verification modal --
  modalOverlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modalContent: {
    backgroundColor: '#1a1a1a', borderRadius: 16, padding: 32,
    textAlign: 'center', maxWidth: 360, width: '90%',
  },
  modalTitle: { fontSize: 18, fontWeight: 700, marginBottom: 20 },
  modalBadge: {
    width: 120, height: 120, borderRadius: 20, margin: '0 auto 12px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modalBadgeLetter: { fontSize: 56, fontWeight: 900, color: '#fff' },
  modalColorName: { fontSize: 20, fontWeight: 700, marginBottom: 8 },
  modalHint: { color: '#999', fontSize: 13, marginBottom: 16 },
  modalTimestamps: {
    display: 'flex', flexDirection: 'column', gap: 4,
    fontSize: 12, color: '#666', marginBottom: 20,
  },
  handoffBtn: {
    width: '100%', padding: '14px', borderRadius: 10, border: 'none',
    fontSize: 15, fontWeight: 800, cursor: 'pointer', letterSpacing: 1, marginBottom: 12,
  },
  modalClose: {
    background: 'none', border: 'none', color: '#666', fontSize: 14, cursor: 'pointer',
  },

  // -- Lock --
  lockBtn: {
    position: 'fixed', bottom: 16, right: 16, padding: '10px 20px',
    borderRadius: 8, border: '1px solid #333', backgroundColor: '#1a1a1a',
    color: '#999', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
};
