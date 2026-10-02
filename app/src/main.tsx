import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./app.css";
import { Wallets, WalletChip } from "./Wallet";
import { Confirmation, Landing, Pick, Results } from "./pages";
import { useRoute } from "./lib";

function Router() {
  const [page, a, b] = useRoute();
  switch (page) {
    case "pick": return <Pick id={Number(a)} />;
    case "ticket": return <Confirmation id={Number(a)} index={Number(b)} />;
    case "results": return <Results id={Number(a)} />;
    default: return <Landing />;
  }
}

function App() {
  return (
    <Wallets>
      <p className="cb-banner" role="status">Devnet only. Play money.</p>
      <header className="cb-head">
        <a className="cb-logo" href="#/">Cryptoball</a>
        <WalletChip />
      </header>
      <main className="cb-main"><Router /></main>
      <footer className="cb-foot cb-muted">Devnet demo with play money. Not a real lottery. Must be 18 or older where you live to play any real lottery. Play responsibly.</footer>
    </Wallets>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
