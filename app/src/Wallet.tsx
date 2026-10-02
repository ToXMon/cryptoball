import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { short } from "./lib";
import { passkeyAddress, passkeyErrorText, registerPasskeyWallet, revealRecoveryPhrase } from "./passkeyWallet";

// Devnet RPC only (R-74). Wallet Standard wallets (our passkey wallet first, then Phantom and friends, R-65)
// are auto-detected; no adapter bundle needed.
const DEVNET_RPC = "https://api.devnet.solana.com";
const PASSKEY = "Cryptoball Passkey";
registerPasskeyWallet();
const Ctx = createContext<() => void>(() => {});
export const useWalletDialog = () => useContext(Ctx);

export function Wallets({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState<string>();
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={[]} autoConnect onError={(e) => setErr(passkeyErrorText(e))}>
        <Ctx.Provider value={() => ref.current?.showModal()}>
          {children}
          <WalletDialog dialogRef={ref} error={err} clearError={() => setErr(undefined)} />
        </Ctx.Provider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function WalletChip() {
  const open = useWalletDialog();
  const { publicKey, connecting } = useWallet();
  const addr = publicKey?.toBase58();
  return (
    <button type="button" className="cb-btn cb-btn--wallet" onClick={open}>
      <span className={`cb-dot${addr ? " cb-dot--on" : ""}`} aria-hidden="true" />
      {addr ? <span className="cb-num">{short(addr)}</span> : connecting ? "connecting…" : "connect wallet"}
    </button>
  );
}

function WalletDialog({ dialogRef, error, clearError }: { dialogRef: React.RefObject<HTMLDialogElement | null>; error?: string; clearError: () => void }) {
  const { wallets, select, disconnect, publicKey } = useWallet();
  const [phrase, setPhrase] = useState<string>();
  const [busy, setBusy] = useState(false);
  const close = () => { dialogRef.current?.close(); setPhrase(undefined); };
  const installed = wallets.filter((w) => w.adapter.name !== PASSKEY);
  const usable = installed.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const passkey = wallets.find((w) => w.adapter.name === PASSKEY);
  const isPasskey = passkey?.readyState === WalletReadyState.Installed;
  const backup = async () => {
    setBusy(true);
    try { setPhrase(await revealRecoveryPhrase()); } catch (e) { setPhrase(passkeyErrorText(e)); } finally { setBusy(false); }
  };
  return (
    <dialog
      ref={dialogRef}
      className="cb-dialog"
      aria-labelledby="wallet-title"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <h2 id="wallet-title">{publicKey ? "Wallet connected" : "Connect a wallet"}</h2>
      <p className="cb-muted">Devnet only. Play money. Use a devnet wallet.</p>
      {error && <p className="cb-error" role="alert">{error}</p>}
      {publicKey ? (
        <>
          <p className="cb-num cb-addr">{publicKey.toBase58()}</p>
          {publicKey.toBase58() === passkeyAddress() && (
            <button type="button" className="cb-btn cb-btn--ghost" disabled={busy} onClick={() => void backup()}>{busy ? "Checking…" : "Show recovery phrase"}</button>
          )}
          <button type="button" className="cb-btn cb-btn--ghost" onClick={() => { void disconnect(); close(); }}>Disconnect</button>
        </>
      ) : (
        <>
          <h3 className="cb-muted">Passkey wallet</h3>
          {isPasskey && passkey ? (
            <ul className="cb-list">
              <li>
                <button type="button" className="cb-btn cb-btn--primary cb-btn--block" onClick={() => { clearError(); select(passkey.adapter.name); close(); }}>
                  <img src={passkey.adapter.icon} alt="" width={20} height={20} /> Cryptoball Passkey
                </button>
              </li>
            </ul>
          ) : (
            <p>No passkey support in this browser. Open the site in Safari or Chrome.</p>
          )}
          <p className="cb-muted cb-fine">New here? One tap creates the wallet with a Face ID or device PIN. Got one already? The same button unlocks it. Your key is derived on this device; nobody else holds it.</p>
          {!!usable.length && (
            <>
              <h3 className="cb-muted">Or an installed wallet</h3>
              <ul className="cb-list">
                {usable.map((w) => (
                  <li key={w.adapter.name}>
                    <button type="button" className="cb-btn cb-btn--ghost cb-btn--block" onClick={() => { clearError(); select(w.adapter.name); close(); }}>
                      <img src={w.adapter.icon} alt="" width={20} height={20} /> {w.adapter.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {phrase && (
        <section aria-labelledby="phrase-h">
          <h3 id="phrase-h">Recovery phrase</h3>
          <p className="cb-warn">Write these 24 words down and keep them offline. They are the only way back if you lose the passkey or this site changes address.</p>
          <p className="cb-num">{phrase}</p>
        </section>
      )}
      <button type="button" className="cb-link" onClick={close}>Close</button>
    </dialog>
  );
}
