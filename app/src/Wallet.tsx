import { createContext, useContext, useRef, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { short } from "./lib";

// Devnet RPC only (R-74). Wallet Standard wallets (Phantom first, R-65) are auto-detected; no adapter bundle needed.
const DEVNET_RPC = "https://api.devnet.solana.com";
const Ctx = createContext<() => void>(() => {});
export const useWalletDialog = () => useContext(Ctx);

export function Wallets({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={[]} autoConnect>
        <Ctx.Provider value={() => ref.current?.showModal()}>
          {children}
          <WalletDialog dialogRef={ref} />
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

function WalletDialog({ dialogRef }: { dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  const { wallets, select, disconnect, publicKey } = useWallet();
  const close = () => dialogRef.current?.close();
  const usable = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  return (
    <dialog
      ref={dialogRef}
      className="cb-dialog"
      aria-labelledby="wallet-title"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <h2 id="wallet-title">{publicKey ? "Wallet connected" : "Connect a wallet"}</h2>
      <p className="cb-muted">Devnet only. Play money. Use a devnet wallet.</p>
      {publicKey ? (
        <>
          <p className="cb-num cb-addr">{publicKey.toBase58()}</p>
          <button type="button" className="cb-btn cb-btn--ghost" onClick={() => { void disconnect(); close(); }}>Disconnect</button>
        </>
      ) : usable.length ? (
        <ul className="cb-list">
          {usable.map((w) => (
            <li key={w.adapter.name}>
              <button type="button" className="cb-btn cb-btn--ghost cb-btn--block" onClick={() => { select(w.adapter.name); close(); }}>
                <img src={w.adapter.icon} alt="" width={20} height={20} /> {w.adapter.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No Solana wallet found. <a href="https://phantom.app/download" target="_blank" rel="noreferrer">Get Phantom</a>, then reload.</p>
      )}
      <button type="button" className="cb-link" onClick={close}>Close</button>
    </dialog>
  );
}
