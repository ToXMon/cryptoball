import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { short, sol } from "./lib";
import { Faucet } from "./components";
import { funding, getBalance } from "./program";
import { passkeyAddress, passkeyErrorText, registerPasskeyWallet, revealRecoveryPhrase } from "./passkeyWallet";
import { DEVNET_RPC } from "./program";

// Devnet RPC only (R-74). Wallet Standard wallets (our passkey wallet first, then Phantom and friends, R-65)
// are auto-detected; no adapter bundle needed.
const PASSKEY = "Cryptoball Passkey";
registerPasskeyWallet();
const Ctx = createContext<() => void>(() => {});
export const useWalletDialog = () => useContext(Ctx);

export function Wallets({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState<string>();
  const open = () => ref.current?.showModal();
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={[]} autoConnect onError={(e) => setErr(passkeyErrorText(e))}>
        <Ctx.Provider value={open}>
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

/**
 * The one devnet balance read behind every funding surface: the last value, the address it was read for, whether that
 * read failed (a flaky RPC is not the same as a zero balance) and `read` to re-read it. A reading belongs to its own
 * address, so a read still in flight for the wallet the user just switched away from never renders next to the new one:
 * until that read lands the surfaces claim nothing at all. `funding` turns those into the state the helper renders.
 */
export function useBalance(address?: string) {
  const [st, setSt] = useState<{ address: string; balance?: bigint; unreadable: boolean }>();
  const read = useCallback(async (): Promise<void> => {
    if (!address) { setSt(undefined); return; }
    try {
      setSt({ address, balance: await getBalance(address), unreadable: false });
    } catch {
      setSt({ address, unreadable: true });
    }
  }, [address]);
  useEffect(() => { void read(); }, [read]);
  const mine = st?.address === address ? st : undefined;
  return { balance: mine?.balance, unreadable: mine?.unreadable ?? false, read };
}

/** A fresh passkey wallet has 0 devnet SOL; the funding helper lives right here, next to the address. */
function Balance({ address }: { address: string }) {
  const { balance, unreadable, read } = useBalance(address);
  const fund = funding(balance, unreadable);
  if (fund.kind === "ok") return balance == null ? null : <p className="cb-muted">Devnet balance: <span className="cb-num">{sol(balance)}</span></p>;
  return <Faucet address={address} fund={fund} retry={read} />;
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
          <Balance address={publicKey.toBase58()} />
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
