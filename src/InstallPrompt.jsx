/**
 * ============================================
 * WAITLESS — PWA Install Prompt
 * ============================================
 * 
 * FILE: src/InstallPrompt.jsx
 * 
 * Shows a subtle banner on the patron view prompting
 * users to add the app to their home screen.
 * Only shows once per session, and only on mobile.
 * ============================================
 */

import { useState, useEffect } from "react";

export default function InstallPrompt({ BRAND }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already dismissed this session
    if (sessionStorage.getItem("waitless_install_dismissed")) return;

    // Check if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Listen for the browser's install prompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show banner after a short delay (don't interrupt immediately)
      setTimeout(() => setShowBanner(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // iOS doesn't fire beforeinstallprompt — show manual instructions
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS && !navigator.standalone) {
      setTimeout(() => setShowBanner(true), 5000);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === "accepted") {
        setShowBanner(false);
      }
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setDismissed(true);
    sessionStorage.setItem("waitless_install_dismissed", "true");
  };

  if (!showBanner || dismissed) return null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  return (
    <div style={S.banner}>
      <div style={S.bannerContent}>
        <div style={S.bannerLeft}>
          <span style={S.bannerIcon}>📲</span>
          <div>
            <span style={S.bannerTitle}>Add to Home Screen</span>
            <span style={S.bannerDesc}>
              {isIOS
                ? "Tap the share button, then \"Add to Home Screen\""
                : "Quick access — no app store needed"}
            </span>
          </div>
        </div>
        <div style={S.bannerActions}>
          {!isIOS && deferredPrompt && (
            <button onClick={handleInstall} style={S.installBtn}>INSTALL</button>
          )}
          <button onClick={handleDismiss} style={S.dismissBtn}>✕</button>
        </div>
      </div>
    </div>
  );
}

const S = {
  banner: {
    position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
    padding: "12px 16px", background: "#141414",
    borderTop: "1px solid #222",
    animation: "slideUp 0.3s ease",
  },
  bannerContent: {
    maxWidth: 480, margin: "0 auto",
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
  },
  bannerLeft: { display: "flex", alignItems: "center", gap: 10 },
  bannerIcon: { fontSize: 24 },
  bannerTitle: {
    display: "block", fontFamily: "'Oswald', sans-serif", fontSize: 13,
    fontWeight: 600, letterSpacing: 1, color: "#f5f5f5",
  },
  bannerDesc: {
    display: "block", fontSize: 11, color: "#888", marginTop: 2,
  },
  bannerActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  installBtn: {
    padding: "8px 16px", borderRadius: 8, border: "none",
    background: "linear-gradient(135deg, #e91e8c, #d4a843)",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 12,
    fontWeight: 700, letterSpacing: 2, cursor: "pointer",
  },
  dismissBtn: {
    background: "transparent", border: "none", color: "#666",
    fontSize: 16, cursor: "pointer", padding: 4,
  },
};
