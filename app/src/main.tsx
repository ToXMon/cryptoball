import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";

// Token-driven shell only. Pages (campaigns, picker, checkout, results) land in phase 4,
// after the program IDL exists (docs/design.md section 17).
function App() {
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
      <p style={{ color: "var(--warn)", fontSize: 14, margin: 0 }}>Devnet only. Play money.</p>
      <h1 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600, letterSpacing: "var(--logo-track)", fontSize: 48, margin: "var(--space-3) 0" }}>
        Cryptoball
      </h1>
      <p style={{ color: "var(--muted)" }}>Pick 5 numbers and a Cryptoball. One ticket wins. Paid automatically.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
