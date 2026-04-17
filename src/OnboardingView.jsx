/**
 * ============================================
 * WAITLESS — Venue Onboarding / Signup
 * ============================================
 * 
 * FILE: src/OnboardingView.jsx
 * 
 * Route: waitless.app/admin/signup
 * 
 * Multi-step flow:
 * 1. Create account (email + password)
 * 2. Set up venue (name, slug, tagline)
 * 3. Add menu items
 * 4. Configure branding
 * 5. Go live
 * ============================================
 */

import { useState, useEffect } from "react";
import { supabase } from "./lib/barOrderService";

const STEPS = ["Account", "Venue", "Menu", "Branding", "Launch"];

export default function OnboardingView({ BRAND }) {
  const [step, setStep] = useState(0);
  const [user, setUser] = useState(null);
  const [venue, setVenue] = useState(null);
  const [error, setError] = useState(null);

  // Check for existing session (in case they refresh mid-flow)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setStep(1); // Skip account step
      }
    });
  }, []);

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={S.header}>
        <h1 style={S.logo}>WAITLESS</h1>
        <p style={S.tagline}>SET UP YOUR VENUE</p>
      </div>

      {/* Progress bar */}
      <div style={S.progressBar}>
        {STEPS.map((label, i) => (
          <div key={label} style={S.progressStep}>
            <div style={{
              ...S.progressDot,
              background: i < step ? "#2ecc71" : i === step ? "#1E4D8C" : "#333",
              borderColor: i < step ? "#2ecc71" : i === step ? "#1E4D8C" : "#333",
            }}>
              {i < step ? "✓" : i + 1}
            </div>
            <span style={{ ...S.progressLabel, color: i <= step ? "#f5f5f5" : "#666" }}>{label}</span>
            {i < STEPS.length - 1 && <div style={{ ...S.progressLine, background: i < step ? "#2ecc71" : "#333" }} />}
          </div>
        ))}
      </div>

      {/* Steps */}
      <div style={S.content}>
        {step === 0 && (
          <AccountStep
            onComplete={(u) => { setUser(u); setStep(1); }}
            error={error}
            setError={setError}
          />
        )}
        {step === 1 && (
          <VenueStep
            user={user}
            onComplete={(v) => { setVenue(v); setStep(2); }}
            error={error}
            setError={setError}
          />
        )}
        {step === 2 && venue && (
          <MenuStep
            venue={venue}
            onComplete={() => setStep(3)}
          />
        )}
        {step === 3 && venue && (
          <BrandingStep
            venue={venue}
            setVenue={setVenue}
            onComplete={() => setStep(4)}
          />
        )}
        {step === 4 && venue && (
          <LaunchStep venue={venue} />
        )}
      </div>
    </div>
  );
}

// ============================================
// STEP 1: ACCOUNT
// ============================================
function AccountStep({ onComplete, error, setError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!email || !password) { setError("Email and password required"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }

    setLoading(true);
    setError(null);

    const { data, error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // If email confirmation is disabled, user is immediately available
    if (data.user) {
      onComplete(data.user);
    } else {
      setError("Check your email to confirm your account, then refresh this page.");
    }
    setLoading(false);
  };

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) { setError(authError.message); setLoading(false); return; }
    if (data.user) onComplete(data.user);
    setLoading(false);
  };

  return (
    <div style={S.stepCard}>
      <h2 style={S.stepTitle}>Create Your Account</h2>
      <p style={S.stepDesc}>This will be your login to manage your venue.</p>

      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={S.input}
      />
      <input
        type="password"
        placeholder="Password (min 6 characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSignup()}
        style={S.input}
      />

      {error && <p style={S.error}>{error}</p>}

      <button onClick={handleSignup} disabled={loading} style={S.primaryBtn}>
        {loading ? "CREATING..." : "CREATE ACCOUNT"}
      </button>

      <p style={S.altAuth}>
        Already have an account?{" "}
        <button onClick={handleLogin} disabled={loading} style={S.linkBtn}>Log in</button>
      </p>
    </div>
  );
}

// ============================================
// STEP 2: VENUE SETUP
// ============================================
function VenueStep({ user, onComplete, error, setError }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [tagline, setTagline] = useState("");
  const [loading, setLoading] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState(null);

  // Auto-generate slug from name
  useEffect(() => {
    const generated = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 30);
    setSlug(generated);
  }, [name]);

  // Check slug availability
  useEffect(() => {
    if (!slug || slug.length < 2) { setSlugAvailable(null); return; }

    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("venues")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      setSlugAvailable(!data);
    }, 500);

    return () => clearTimeout(timer);
  }, [slug]);

  const handleCreate = async () => {
    if (!name.trim()) { setError("Venue name required"); return; }
    if (!slug || slug.length < 2) { setError("Slug must be at least 2 characters"); return; }
    if (!slugAvailable) { setError("That URL is already taken"); return; }

    setLoading(true);
    setError(null);

    const { data, error: insertError } = await supabase
      .from("venues")
      .insert({
        name: name.trim(),
        slug,
        tagline: tagline.trim() || null,
        owner_email: user.email,
        owner_id: user.id,
        bartender_pin: "1234",
        service_fee_percent: 5,
        brand_colors: { primary: "#1E4D8C", accent: "#d4a843", background: "#0a0a0a" },
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    onComplete(data);
    setLoading(false);
  };

  return (
    <div style={S.stepCard}>
      <h2 style={S.stepTitle}>Set Up Your Venue</h2>
      <p style={S.stepDesc}>Tell us about your business.</p>

      <div style={S.field}>
        <label style={S.label}>Venue Name</label>
        <input
          type="text"
          placeholder="e.g., Big Tony's Tacos"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={S.input}
        />
      </div>

      <div style={S.field}>
        <label style={S.label}>Your URL</label>
        <div style={S.slugRow}>
          <span style={S.slugPrefix}>waitless.app/</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            style={S.slugInput}
          />
        </div>
        {slug && slugAvailable !== null && (
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: slugAvailable ? "#2ecc71" : "#e74c3c", letterSpacing: 1, marginTop: 4 }}>
            {slugAvailable ? "✓ AVAILABLE" : "✗ TAKEN"}
          </span>
        )}
      </div>

      <div style={S.field}>
        <label style={S.label}>Tagline (optional)</label>
        <input
          type="text"
          placeholder="e.g., Street tacos done right"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          style={S.input}
        />
      </div>

      {error && <p style={S.error}>{error}</p>}

      <button onClick={handleCreate} disabled={loading || !slugAvailable} style={{ ...S.primaryBtn, opacity: !slugAvailable ? 0.5 : 1 }}>
        {loading ? "CREATING..." : "CREATE VENUE"}
      </button>
    </div>
  );
}

// ============================================
// STEP 3: MENU
// ============================================
function MenuStep({ venue, onComplete }) {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState("");
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAddItem = async () => {
    if (!category.trim() || !itemName.trim() || !price) return;

    setSaving(true);
    const priceCents = Math.round(parseFloat(price) * 100);
    const sortOrder = items.filter((i) => i.category === category.trim()).length + 1;

    const { data, error } = await supabase
      .from("menus")
      .insert({
        venue_id: venue.id,
        category: category.trim(),
        item_name: itemName.trim(),
        description: description.trim() || null,
        price_cents: priceCents,
        sort_order: sortOrder,
        active: true,
      })
      .select()
      .single();

    if (!error && data) {
      setItems((prev) => [...prev, data]);
      setItemName("");
      setDescription("");
      setPrice("");
    }
    setSaving(false);
  };

  const handleRemoveItem = async (id) => {
    await supabase.from("menus").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div style={S.stepCard}>
      <h2 style={S.stepTitle}>Build Your Menu</h2>
      <p style={S.stepDesc}>Add your items by category. You can always edit these later.</p>

      {/* Existing items */}
      {Object.keys(groupedItems).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {Object.entries(groupedItems).map(([cat, catItems]) => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <h4 style={S.miniCatHeader}>{cat}</h4>
              {catItems.map((item) => (
                <div key={item.id} style={S.miniItem}>
                  <span style={S.miniItemName}>{item.item_name}</span>
                  <span style={S.miniItemPrice}>${(item.price_cents / 100).toFixed(2)}</span>
                  <button onClick={() => handleRemoveItem(item.id)} style={S.removeBtn}>✕</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Add item form */}
      <div style={S.addForm}>
        <div style={S.addFormRow}>
          <div style={{ ...S.field, flex: 1 }}>
            <label style={S.label}>Category</label>
            <input
              type="text"
              placeholder="e.g., Tacos"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={S.input}
              list="categories"
            />
            <datalist id="categories">
              {[...new Set(items.map((i) => i.category))].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div style={{ ...S.field, flex: 1 }}>
            <label style={S.label}>Price ($)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={S.input}
            />
          </div>
        </div>
        <div style={S.field}>
          <label style={S.label}>Item Name</label>
          <input
            type="text"
            placeholder="e.g., Carne Asada Taco"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            style={S.input}
          />
        </div>
        <div style={S.field}>
          <label style={S.label}>Description (optional)</label>
          <input
            type="text"
            placeholder="e.g., Grilled steak, cilantro, onion"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={S.input}
          />
        </div>
        <button onClick={handleAddItem} disabled={saving || !category || !itemName || !price} style={S.secondaryBtn}>
          {saving ? "ADDING..." : "+ ADD ITEM"}
        </button>
      </div>

      <div style={S.stepNav}>
        <span style={S.itemCount}>{items.length} item{items.length !== 1 ? "s" : ""} added</span>
        <button onClick={onComplete} style={S.primaryBtn} disabled={items.length === 0}>
          CONTINUE
        </button>
      </div>
    </div>
  );
}

// ============================================
// STEP 4: BRANDING
// ============================================
function BrandingStep({ venue, setVenue, onComplete }) {
  const [primary, setPrimary] = useState(venue.brand_colors?.primary || "#1E4D8C");
  const [accent, setAccent] = useState(venue.brand_colors?.accent || "#d4a843");
  const [background, setBackground] = useState(venue.brand_colors?.background || "#0a0a0a");
  const [pin, setPin] = useState(venue.bartender_pin || "1234");
  const [fee, setFee] = useState(venue.service_fee_percent || 5);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("venues")
      .update({
        bartender_pin: pin,
        service_fee_percent: fee,
        brand_colors: { primary, accent, background },
      })
      .eq("id", venue.id);

    if (!error) {
      setVenue((prev) => ({
        ...prev,
        bartender_pin: pin,
        service_fee_percent: fee,
        brand_colors: { primary, accent, background },
      }));
    }
    setSaving(false);
    onComplete();
  };

  return (
    <div style={S.stepCard}>
      <h2 style={S.stepTitle}>Customize Your Look</h2>
      <p style={S.stepDesc}>Set your brand colors and venue settings.</p>

      <div style={S.colorSection}>
        <div style={S.colorItem}>
          <label style={S.label}>Primary Color</label>
          <div style={S.colorWrap}>
            <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} style={S.colorPicker} />
            <input type="text" value={primary} onChange={(e) => setPrimary(e.target.value)} style={S.colorHex} />
          </div>
        </div>
        <div style={S.colorItem}>
          <label style={S.label}>Accent Color</label>
          <div style={S.colorWrap}>
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={S.colorPicker} />
            <input type="text" value={accent} onChange={(e) => setAccent(e.target.value)} style={S.colorHex} />
          </div>
        </div>
        <div style={S.colorItem}>
          <label style={S.label}>Background</label>
          <div style={S.colorWrap}>
            <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} style={S.colorPicker} />
            <input type="text" value={background} onChange={(e) => setBackground(e.target.value)} style={S.colorHex} />
          </div>
        </div>
      </div>

      {/* Preview */}
      <div style={{ padding: 24, borderRadius: 14, background: background, border: "1px solid #333", textAlign: "center", margin: "12px 0" }}>
        <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 4, background: `linear-gradient(135deg, ${primary}, ${accent})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {venue.name?.toUpperCase()}
        </span>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 2, marginTop: 4 }}>
          {venue.tagline?.toUpperCase() || "YOUR TAGLINE"}
        </p>
      </div>

      <div style={S.addFormRow}>
        <div style={{ ...S.field, flex: 1 }}>
          <label style={S.label}>Bartender PIN</label>
          <input
            type="text"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            style={S.input}
          />
        </div>
        <div style={{ ...S.field, flex: 1 }}>
          <label style={S.label}>Service Fee %</label>
          <input
            type="number"
            step="0.5"
            min="0"
            max="30"
            value={fee}
            onChange={(e) => setFee(parseFloat(e.target.value || 0))}
            style={S.input}
          />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} style={S.primaryBtn}>
        {saving ? "SAVING..." : "SAVE & CONTINUE"}
      </button>
    </div>
  );
}

// ============================================
// STEP 5: LAUNCH
// ============================================
function LaunchStep({ venue }) {
  const patronUrl = `${window.location.origin}/${venue.slug}`;
  const bartenderUrl = `${window.location.origin}/${venue.slug}/bartender`;
  const adminUrl = `${window.location.origin}/${venue.slug}/admin`;

  const [copied, setCopied] = useState(null);

  const copyUrl = (url, label) => {
    navigator.clipboard.writeText(url);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div style={S.stepCard}>
      <div style={S.launchIcon}>🚀</div>
      <h2 style={{ ...S.stepTitle, fontSize: 24 }}>You're Live!</h2>
      <p style={S.stepDesc}>
        {venue.name} is ready. Share the patron link with your customers and open the bartender link on your iPad.
      </p>

      <div style={S.urlSection}>
        <div style={S.urlCard}>
          <span style={S.urlLabel}>PATRON ORDERING</span>
          <span style={S.urlValue}>{patronUrl}</span>
          <button onClick={() => copyUrl(patronUrl, "patron")} style={S.copyBtn}>
            {copied === "patron" ? "COPIED!" : "COPY LINK"}
          </button>
        </div>

        <div style={S.urlCard}>
          <span style={S.urlLabel}>BARTENDER QUEUE</span>
          <span style={S.urlValue}>{bartenderUrl}</span>
          <button onClick={() => copyUrl(bartenderUrl, "bartender")} style={S.copyBtn}>
            {copied === "bartender" ? "COPIED!" : "COPY LINK"}
          </button>
        </div>

        <div style={S.urlCard}>
          <span style={S.urlLabel}>ADMIN DASHBOARD</span>
          <span style={S.urlValue}>{adminUrl}</span>
          <button onClick={() => copyUrl(adminUrl, "admin")} style={S.copyBtn}>
            {copied === "admin" ? "COPIED!" : "COPY LINK"}
          </button>
        </div>
      </div>

      <div style={S.launchNote}>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#d4a843", letterSpacing: 1, margin: 0 }}>
          ⚠ PAYMENTS ARE IN DEMO MODE
        </p>
        <p style={{ fontSize: 12, color: "#888", marginTop: 6, lineHeight: 1.6 }}>
          Orders work end-to-end but no real charges are made. Add your Square credentials in the admin dashboard to enable live payments.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <a href={patronUrl} target="_blank" rel="noopener noreferrer" style={S.launchBtn}>
          OPEN PATRON VIEW
        </a>
        <a href={adminUrl} target="_blank" rel="noopener noreferrer" style={S.launchBtnAlt}>
          GO TO ADMIN
        </a>
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const S = {
  page: {
    minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f5",
    fontFamily: "'Inter', sans-serif", padding: "0 20px 60px",
  },
  header: { textAlign: "center", padding: "32px 0 8px" },
  logo: {
    fontFamily: "'Oswald', sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: 4, margin: 0,
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  tagline: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 3, margin: "4px 0 0" },

  // Progress
  progressBar: {
    display: "flex", justifyContent: "center", alignItems: "flex-start",
    padding: "24px 0", maxWidth: 500, margin: "0 auto",
  },
  progressStep: { display: "flex", flexDirection: "column", alignItems: "center", position: "relative", flex: 1 },
  progressDot: {
    width: 28, height: 28, borderRadius: "50%", border: "2px solid",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#fff",
  },
  progressLabel: { fontFamily: "'Space Mono', monospace", fontSize: 8, letterSpacing: 1, marginTop: 6, textTransform: "uppercase" },
  progressLine: { position: "absolute", top: 14, left: "60%", width: "80%", height: 2, borderRadius: 1 },

  // Content
  content: { maxWidth: 480, margin: "0 auto" },
  stepCard: {
    background: "#141414", borderRadius: 20, padding: "32px 24px",
    border: "1px solid #222", display: "flex", flexDirection: "column", gap: 16,
  },
  stepTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 3, margin: 0, textAlign: "center" },
  stepDesc: { fontSize: 14, color: "#888", textAlign: "center", margin: 0, lineHeight: 1.6 },

  // Inputs
  field: { display: "flex", flexDirection: "column", gap: 6 },
  input: {
    padding: "14px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 10,
    color: "#f5f5f5", fontFamily: "'Inter', sans-serif", fontSize: 15, outline: "none", width: "100%",
  },
  label: { fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#888", letterSpacing: 1, textTransform: "uppercase" },
  error: { color: "#e74c3c", fontSize: 13, margin: 0, textAlign: "center" },

  // Slug
  slugRow: { display: "flex", alignItems: "center", background: "#1a1a1a", borderRadius: 10, border: "1px solid #333", overflow: "hidden" },
  slugPrefix: { padding: "14px 0 14px 14px", fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#666" },
  slugInput: {
    flex: 1, padding: "14px 14px 14px 0", background: "transparent", border: "none",
    color: "#f5f5f5", fontFamily: "'Space Mono', monospace", fontSize: 13, outline: "none",
  },

  // Buttons
  primaryBtn: {
    padding: "16px", borderRadius: 12, border: "none",
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
    letterSpacing: 3, cursor: "pointer", textAlign: "center", textDecoration: "none",
  },
  secondaryBtn: {
    padding: "12px", borderRadius: 10, border: "1px dashed #1E4D8C44",
    background: "#1E4D8C11", color: "#1E4D8C",
    fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 600,
    letterSpacing: 2, cursor: "pointer",
  },
  linkBtn: {
    background: "none", border: "none", color: "#1E4D8C", cursor: "pointer",
    fontFamily: "'Inter', sans-serif", fontSize: 13, textDecoration: "underline",
  },
  altAuth: { fontSize: 13, color: "#888", textAlign: "center", margin: 0 },

  // Menu step
  addForm: {
    padding: 16, background: "#0a0a0a", borderRadius: 12, border: "1px solid #222",
    display: "flex", flexDirection: "column", gap: 10,
  },
  addFormRow: { display: "flex", gap: 10 },
  miniCatHeader: {
    fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: 3,
    color: "#d4a843", textTransform: "uppercase", marginBottom: 6, paddingBottom: 4,
    borderBottom: "1px solid #d4a8431a",
  },
  miniItem: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 10px", background: "#1a1a1a", borderRadius: 8, marginBottom: 4,
  },
  miniItemName: { flex: 1, fontSize: 13, fontFamily: "'Oswald', sans-serif", fontWeight: 500 },
  miniItemPrice: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#d4a843" },
  removeBtn: {
    background: "transparent", border: "none", color: "#666", fontSize: 12, cursor: "pointer",
    padding: "2px 6px",
  },
  stepNav: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  itemCount: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", letterSpacing: 1 },

  // Branding step
  colorSection: { display: "flex", gap: 12, flexWrap: "wrap" },
  colorItem: { display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 120 },
  colorWrap: { display: "flex", alignItems: "center", gap: 6 },
  colorPicker: { width: 36, height: 36, border: "none", borderRadius: 6, cursor: "pointer", background: "transparent" },
  colorHex: {
    padding: "8px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 6,
    color: "#f5f5f5", fontFamily: "'Space Mono', monospace", fontSize: 11, width: 80, outline: "none",
  },

  // Launch step
  launchIcon: { fontSize: 48, textAlign: "center" },
  urlSection: { display: "flex", flexDirection: "column", gap: 10 },
  urlCard: {
    padding: "14px 16px", background: "#0a0a0a", borderRadius: 10, border: "1px solid #222",
    display: "flex", flexDirection: "column", gap: 6,
  },
  urlLabel: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 2 },
  urlValue: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#d4a843", wordBreak: "break-all" },
  copyBtn: {
    alignSelf: "flex-start", padding: "6px 12px", borderRadius: 6, border: "1px solid #333",
    background: "transparent", color: "#888", fontFamily: "'Space Mono', monospace",
    fontSize: 10, letterSpacing: 1, cursor: "pointer",
  },
  launchNote: {
    padding: 16, borderRadius: 10, background: "#d4a84310", border: "1px solid #d4a84322",
  },
  launchBtn: {
    flex: 1, padding: "14px", borderRadius: 10, border: "none",
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700,
    letterSpacing: 2, cursor: "pointer", textAlign: "center", textDecoration: "none",
  },
  launchBtnAlt: {
    flex: 1, padding: "14px", borderRadius: 10, border: "1px solid #333",
    background: "transparent", color: "#888", fontFamily: "'Oswald', sans-serif",
    fontSize: 14, fontWeight: 600, letterSpacing: 2, cursor: "pointer",
    textAlign: "center", textDecoration: "none",
  },
};
