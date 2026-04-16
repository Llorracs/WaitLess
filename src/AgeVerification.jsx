/**
 * ============================================
 * WAITLESS — Age Verification
 * ============================================
 * 
 * FILE: src/AgeVerification.jsx
 * 
 * Browser-only ID scan with OCR. Photo never leaves the device.
 * Falls back to manual DOB entry if scan fails.
 * Stores age_verified flag in sessionStorage (cleared when tab closes).
 * ============================================
 */

import { useState, useRef } from "react";
import { createWorker } from "tesseract.js";

const STORAGE_KEY_PREFIX = "waitless_age_verified_";

export function isAgeVerified(venueId) {
  return sessionStorage.getItem(STORAGE_KEY_PREFIX + venueId) === "true";
}

function setAgeVerified(venueId) {
  sessionStorage.setItem(STORAGE_KEY_PREFIX + venueId, "true");
  sessionStorage.setItem(STORAGE_KEY_PREFIX + venueId + "_at", new Date().toISOString());
}

function calculateAge(dobString) {
  const dob = new Date(dobString);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// Try to extract DOB from OCR text (handles MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD)
function extractDOB(text) {
  // US format: MM/DD/YYYY or MM-DD-YYYY
  const usMatch = text.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/);
  if (usMatch) {
    const [_, m, d, y] = usMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // ISO format: YYYY-MM-DD
  const isoMatch = text.match(/\b(19|20)\d{2}[\/\-](0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    const [_, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DOB label patterns
  const dobLabelMatch = text.match(/DOB[:\s]*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
  if (dobLabelMatch) {
    const [_, m, d, y] = dobLabelMatch;
    return `${y}-${m}-${d}`;
  }

  return null;
}

export default function AgeVerification({ venue, BRAND, onVerified }) {
  const [mode, setMode] = useState("intro"); // intro | scanning | manual | failed
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanError, setScanError] = useState(null);
  const [manualDOB, setManualDOB] = useState("");
  const [manualError, setManualError] = useState(null);
  const fileInputRef = useRef(null);

  const minAge = venue.minimum_age || 21;

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setScanError(null);
    setMode("scanning");

    try {
      const worker = await createWorker("eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setScanProgress(Math.round(m.progress * 100));
          }
        },
      });

      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();

      console.log("OCR result:", text);

      const dob = extractDOB(text);

      if (!dob) {
        setScanError("Couldn't read date of birth from your ID. Please try again or enter manually.");
        setScanning(false);
        return;
      }

      const age = calculateAge(dob);

      if (age < minAge) {
        setScanError(`Sorry — you must be ${minAge} or older to order. Detected age: ${age}.`);
        setScanning(false);
        return;
      }

      // Success
      setAgeVerified(venue.id);
      setScanning(false);
      onVerified();
    } catch (err) {
      console.error("OCR error:", err);
      setScanError("Scan failed. Please try again or enter manually.");
      setScanning(false);
    }
  };

  const handleManualSubmit = () => {
    setManualError(null);
    if (!manualDOB) {
      setManualError("Please enter your date of birth");
      return;
    }
    const age = calculateAge(manualDOB);
    if (age < minAge) {
      setManualError(`You must be ${minAge} or older to order.`);
      return;
    }
    setAgeVerified(venue.id);
    onVerified();
  };

  return (
    <div style={{ ...S.overlay, background: BRAND.black }}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />

      <div style={S.card}>
        <div style={S.header}>
          <h1 style={{ ...S.title, background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            {venue.name?.toUpperCase()}
          </h1>
          <p style={S.subtitle}>AGE VERIFICATION REQUIRED</p>
        </div>

        {mode === "intro" && (
          <>
            <div style={S.iconCircle}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={BRAND.accent} strokeWidth="1.5">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="12" r="2" />
                <line x1="14" y1="10" x2="18" y2="10" />
                <line x1="14" y1="14" x2="18" y2="14" />
              </svg>
            </div>

            <p style={S.body}>
              You must be <strong style={{ color: BRAND.accent }}>{minAge} or older</strong> to order. Scan your driver's license or ID to verify.
            </p>

            <div style={S.privacyBox}>
              <span style={S.privacyIcon}>🔒</span>
              <p style={S.privacyText}>
                Your photo never leaves this device. We only verify your age — no images, names, or addresses are stored.
              </p>
            </div>

            <button onClick={() => fileInputRef.current?.click()} style={{ ...S.primaryBtn, background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})` }}>
              📸 SCAN MY ID
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />

            <button onClick={() => setMode("manual")} style={S.linkBtn}>
              Enter date of birth manually
            </button>
          </>
        )}

        {mode === "scanning" && (
          <>
            <div style={{ ...S.iconCircle, animation: "pulse 1.5s ease infinite" }}>
              <div style={{ ...S.spinner, borderTopColor: BRAND.accent }} />
            </div>
            <p style={S.body}>Reading your ID...</p>
            <div style={S.progressBar}>
              <div style={{ ...S.progressFill, width: `${scanProgress}%`, background: BRAND.accent }} />
            </div>
            <p style={{ ...S.privacyText, textAlign: "center" }}>{scanProgress}%</p>
          </>
        )}

        {scanError && mode === "scanning" === false && (
          <>
            <div style={{ ...S.iconCircle, borderColor: BRAND.danger }}>⚠️</div>
            <p style={{ ...S.body, color: BRAND.danger }}>{scanError}</p>
            <button onClick={() => { setScanError(null); setMode("intro"); }} style={{ ...S.primaryBtn, background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})` }}>
              TRY AGAIN
            </button>
            <button onClick={() => { setScanError(null); setMode("manual"); }} style={S.linkBtn}>
              Enter date of birth manually
            </button>
          </>
        )}

        {mode === "manual" && (
          <>
            <div style={S.iconCircle}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={BRAND.accent} strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>

            <p style={S.body}>Enter your date of birth</p>

            <input
              type="date"
              value={manualDOB}
              onChange={(e) => setManualDOB(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              style={S.dateInput}
            />

            {manualError && <p style={S.error}>{manualError}</p>}

            <button onClick={handleManualSubmit} style={{ ...S.primaryBtn, background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})` }}>
              VERIFY AGE
            </button>

            <button onClick={() => { setManualError(null); setMode("intro"); }} style={S.linkBtn}>
              ← Back to scan
            </button>
          </>
        )}
      </div>

      <p style={S.footerNote}>
        Physical ID is verified at venue entry. Misrepresenting your age is illegal.
      </p>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
      `}</style>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const S = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 1000,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    padding: 24, gap: 16, color: "#f5f5f5", fontFamily: "'Inter', sans-serif",
  },
  card: {
    background: "#141414", borderRadius: 24, padding: "36px 28px",
    maxWidth: 400, width: "100%", border: "1px solid #222",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
  },
  header: { textAlign: "center" },
  title: {
    fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700,
    letterSpacing: 4, margin: 0,
  },
  subtitle: {
    fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#666",
    letterSpacing: 3, margin: "4px 0 0",
  },
  iconCircle: {
    width: 80, height: 80, borderRadius: "50%", border: "1.5px solid #333",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 32, margin: "8px 0",
  },
  body: {
    fontSize: 14, color: "#ccc", textAlign: "center", lineHeight: 1.6,
    margin: 0, maxWidth: 320,
  },
  privacyBox: {
    display: "flex", gap: 12, padding: "12px 14px",
    background: "#0a0a0a", borderRadius: 10, border: "1px solid #222",
  },
  privacyIcon: { fontSize: 18, flexShrink: 0 },
  privacyText: {
    fontSize: 11, color: "#888", lineHeight: 1.5, margin: 0, fontFamily: "'Space Mono', monospace",
  },
  primaryBtn: {
    width: "100%", padding: "16px", borderRadius: 12, border: "none",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700,
    letterSpacing: 3, cursor: "pointer",
  },
  linkBtn: {
    background: "none", border: "none", color: "#666", fontSize: 13,
    textDecoration: "underline", cursor: "pointer", padding: 4,
  },
  spinner: {
    width: 32, height: 32, borderRadius: "50%", border: "3px solid #333",
    animation: "spin 1s linear infinite",
  },
  progressBar: {
    width: "100%", height: 6, borderRadius: 3, background: "#222", overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3, transition: "width 0.3s ease" },
  dateInput: {
    width: "100%", padding: "14px", background: "#0a0a0a", border: "1px solid #333",
    borderRadius: 10, color: "#f5f5f5", fontFamily: "'Inter', sans-serif", fontSize: 16,
    outline: "none", colorScheme: "dark",
  },
  error: {
    color: "#e74c3c", fontSize: 13, margin: 0, textAlign: "center",
  },
  footerNote: {
    fontSize: 11, color: "#444", textAlign: "center", margin: 0,
    maxWidth: 360, fontFamily: "'Space Mono', monospace", letterSpacing: 0.5,
  },
};
