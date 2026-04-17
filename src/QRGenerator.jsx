/**
 * ============================================
 * WAITLESS — QR Code Generator
 * ============================================
 * 
 * FILE: src/QRGenerator.jsx
 * 
 * Generates and downloads:
 * - Standalone QR code PNG (just the code)
 * - Full branded poster PNG (with venue name, tagline, instructions)
 * 
 * Used inside the admin dashboard.
 * Also accessible standalone at: waitless.app/{slug}/qr
 * ============================================
 */

import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";

export default function QRGenerator({ venue, BRAND, embedded = false }) {
  const qrCanvasRef = useRef(null);
  const posterCanvasRef = useRef(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [posterDataUrl, setPosterDataUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  const venueUrl = `${window.location.origin}/${venue.slug}`;

  useEffect(() => {
    generateAssets();
  }, [venue.id]);

  async function generateAssets() {
    setLoading(true);

    // Generate standalone QR code
    try {
      const qr = await QRCode.toDataURL(venueUrl, {
        width: 800,
        margin: 2,
        errorCorrectionLevel: "H",
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });
      setQrDataUrl(qr);

      // Generate poster with branding
      const poster = await generatePoster(qr);
      setPosterDataUrl(poster);
    } catch (err) {
      console.error("QR generation failed:", err);
    } finally {
      setLoading(false);
    }
  }

  async function generatePoster(qrUrl) {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      // Letter size at 150 DPI — good for printing
      canvas.width = 1275;
      canvas.height = 1650;
      const ctx = canvas.getContext("2d");

      const primary = venue.brand_colors?.primary || "#e91e8c";
      const accent = venue.brand_colors?.accent || "#d4a843";
      const bg = venue.brand_colors?.background || "#0a0a0a";

      // Background
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle gradient glow
      const grad = ctx.createRadialGradient(canvas.width / 2, 400, 100, canvas.width / 2, 400, 800);
      grad.addColorStop(0, primary + "20");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Top accent bar
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, canvas.width, 12);

      // "ORDER FROM YOUR PHONE" header
      ctx.font = "bold 28px 'Courier New', monospace";
      ctx.fillStyle = accent;
      ctx.textAlign = "center";
      ctx.fillText("ORDER FROM YOUR PHONE", canvas.width / 2, 140);

      // Decorative line
      ctx.strokeStyle = accent + "44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - 200, 170);
      ctx.lineTo(canvas.width / 2 + 200, 170);
      ctx.stroke();

      // Venue name (large, gradient effect simulated with primary color)
      ctx.font = "bold 110px 'Arial Black', sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(venue.name.toUpperCase(), canvas.width / 2, 290);

      // Underline accent
      ctx.fillStyle = primary;
      const nameWidth = ctx.measureText(venue.name.toUpperCase()).width;
      ctx.fillRect(canvas.width / 2 - nameWidth / 2, 310, nameWidth, 6);

      // Tagline
      if (venue.tagline) {
        ctx.font = "italic 32px Georgia, serif";
        ctx.fillStyle = "#cccccc";
        ctx.fillText(venue.tagline, canvas.width / 2, 380);
      }

      // QR code
      const qrImg = new Image();
      qrImg.onload = () => {
        const qrSize = 600;
        const qrX = (canvas.width - qrSize) / 2;
        const qrY = 480;

        // White background card for QR
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(qrX - 30, qrY - 30, qrSize + 60, qrSize + 60);

        // Decorative border around white card
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.strokeRect(qrX - 30, qrY - 30, qrSize + 60, qrSize + 60);

        // Corner brackets for design flair
        const bracketLen = 40;
        const bracketWidth = 6;
        ctx.fillStyle = primary;
        // Top-left
        ctx.fillRect(qrX - 50, qrY - 50, bracketLen, bracketWidth);
        ctx.fillRect(qrX - 50, qrY - 50, bracketWidth, bracketLen);
        // Top-right
        ctx.fillRect(qrX + qrSize + 50 - bracketLen, qrY - 50, bracketLen, bracketWidth);
        ctx.fillRect(qrX + qrSize + 50 - bracketWidth, qrY - 50, bracketWidth, bracketLen);
        // Bottom-left
        ctx.fillRect(qrX - 50, qrY + qrSize + 50 - bracketWidth, bracketLen, bracketWidth);
        ctx.fillRect(qrX - 50, qrY + qrSize + 50 - bracketLen, bracketWidth, bracketLen);
        // Bottom-right
        ctx.fillRect(qrX + qrSize + 50 - bracketLen, qrY + qrSize + 50 - bracketWidth, bracketLen, bracketWidth);
        ctx.fillRect(qrX + qrSize + 50 - bracketWidth, qrY + qrSize + 50 - bracketLen, bracketWidth, bracketLen);

        // Draw QR
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

        // Step instructions
        const stepsY = 1180;
        ctx.font = "bold 26px 'Courier New', monospace";
        ctx.fillStyle = accent;
        ctx.fillText("HOW IT WORKS", canvas.width / 2, stepsY);

        const steps = [
          "1. SCAN — Point your camera at the code",
          "2. ORDER — Browse menu and pay on your phone",
          "3. PICKUP — We'll alert you when ready",
        ];

        ctx.font = "24px 'Helvetica Neue', sans-serif";
        ctx.fillStyle = "#ffffff";
        steps.forEach((step, i) => {
          ctx.fillText(step, canvas.width / 2, stepsY + 50 + i * 40);
        });

        // URL footer
        ctx.font = "20px 'Courier New', monospace";
        ctx.fillStyle = accent;
        ctx.fillText(venueUrl.replace(/^https?:\/\//, ""), canvas.width / 2, canvas.height - 100);

        // Powered by Waitless
        ctx.font = "16px 'Helvetica Neue', sans-serif";
        ctx.fillStyle = "#666666";
        ctx.fillText("POWERED BY WAITLESS", canvas.width / 2, canvas.height - 50);

        // Bottom accent bar
        ctx.fillStyle = accent;
        ctx.fillRect(0, canvas.height - 12, canvas.width, 12);

        resolve(canvas.toDataURL("image/png"));
      };
      qrImg.src = qrUrl;
    });
  }

  const downloadFile = (dataUrl, filename) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const styles = embedded ? S.embedded : S.standalone;

  return (
    <div style={styles.container}>
      {!embedded && (
        <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
      )}

      <div style={S.header}>
        <h2 style={S.title}>QR Code & Poster</h2>
        <p style={S.subtitle}>Print or share these to let customers order from their phones.</p>
      </div>

      {loading ? (
        <div style={S.loading}>
          <div style={S.spinner} />
          <p style={S.loadingText}>Generating...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <div style={S.grid}>
          {/* QR Code only */}
          <div style={S.card}>
            <div style={S.cardLabel}>QR CODE</div>
            <div style={S.qrPreview}>
              {qrDataUrl && <img src={qrDataUrl} alt="QR Code" style={S.qrImage} />}
            </div>
            <p style={S.cardDesc}>Just the code. Use anywhere — tables, signs, social media.</p>
            <button onClick={() => downloadFile(qrDataUrl, `${venue.slug}-qr.png`)} style={S.downloadBtn}>
              ⬇ DOWNLOAD QR
            </button>
          </div>

          {/* Full poster */}
          <div style={S.card}>
            <div style={S.cardLabel}>PRINT POSTER</div>
            <div style={S.posterPreview}>
              {posterDataUrl && <img src={posterDataUrl} alt="Poster" style={S.posterImage} />}
            </div>
            <p style={S.cardDesc}>Letter-size poster with your branding and instructions. Print and display.</p>
            <button onClick={() => downloadFile(posterDataUrl, `${venue.slug}-poster.png`)} style={S.downloadBtn}>
              ⬇ DOWNLOAD POSTER
            </button>
          </div>
        </div>
      )}

      <div style={S.urlBox}>
        <span style={S.urlLabel}>YOUR LINK</span>
        <span style={S.urlValue}>{venueUrl}</span>
        <button onClick={() => { navigator.clipboard.writeText(venueUrl); }} style={S.copyBtn}>COPY</button>
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const baseStyles = {
  header: { textAlign: "center", marginBottom: 24 },
  title: { fontFamily: "'Oswald', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 3, margin: 0 },
  subtitle: { fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#888", marginTop: 6 },

  loading: { display: "flex", flexDirection: "column", alignItems: "center", padding: 60, gap: 12 },
  spinner: { width: 40, height: 40, borderRadius: "50%", border: "3px solid #222", borderTopColor: "#1E4D8C", animation: "spin 1s linear infinite" },
  loadingText: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", letterSpacing: 2 },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginBottom: 20 },
  card: {
    padding: 20, background: "#141414", borderRadius: 14, border: "1px solid #222",
    display: "flex", flexDirection: "column", gap: 12,
  },
  cardLabel: {
    fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#d4a843",
    letterSpacing: 3, textAlign: "center",
  },
  qrPreview: {
    background: "#fff", padding: 16, borderRadius: 10,
    display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200,
  },
  qrImage: { maxWidth: "100%", height: "auto", display: "block" },
  posterPreview: {
    background: "#0a0a0a", borderRadius: 10, padding: 8,
    display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200,
  },
  posterImage: { maxWidth: "100%", maxHeight: 300, display: "block", borderRadius: 6 },
  cardDesc: { fontSize: 12, color: "#888", textAlign: "center", lineHeight: 1.5, margin: 0 },
  downloadBtn: {
    padding: "12px", borderRadius: 10, border: "none",
    background: "linear-gradient(135deg, #1E4D8C, #d4a843)",
    color: "#fff", fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 700,
    letterSpacing: 2, cursor: "pointer",
  },

  urlBox: {
    padding: "14px 16px", background: "#0a0a0a", borderRadius: 10, border: "1px solid #222",
    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
  },
  urlLabel: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#666", letterSpacing: 2 },
  urlValue: { flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#d4a843", wordBreak: "break-all" },
  copyBtn: {
    padding: "6px 14px", borderRadius: 6, border: "1px solid #333", background: "transparent",
    color: "#888", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer",
  },
};

const S = {
  ...baseStyles,
  embedded: { container: { padding: 0 } },
  standalone: {
    container: {
      maxWidth: 720, margin: "0 auto", padding: "40px 20px",
      minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f5",
      fontFamily: "'Inter', sans-serif",
    },
  },
};
