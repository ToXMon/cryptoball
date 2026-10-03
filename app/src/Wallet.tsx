import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { short, sol } from "./lib";
import { Faucet } from "./components";
import { createBalanceRead, type BalanceState } from "./balance";
import { funding } from "./program";
import { passkeyAddress, passkeyErrorText, registerPasskeyWallet, revealRecoveryPhrase } from "./passkeyWallet";
import { DEVNET_RPC } from "./program";

// Devnet RPC only (R-74). Wallet Standard wallets (our passkey wallet first, then Phantom and friends, R-65)
// are auto-detected; no adapter bundle needed.
const PASSKEY = "Cryptoball Passkey";
registerPasskeyWallet();
const Ctx = createContext<() => void>(() => {});
export const useWalletDialog = () => useContext(Ctx);

/** One wallet balance, read once and shared. */
export interface WalletBalance {
  /** The connected wallet. `balance` and `unreadable` describe this address and no other. */
  address?: string;
  balance?: bigint;
  unreadable: boolean;
  /** A read is in flight: a wallet with nothing read yet claims nothing, and a re-read keeps the landing it already holds until the newest one replaces it. */
  reading: boolean;
  read: () => void;
}
const BalanceCtx = createContext<WalletBalance>({ unreadable: false, reading: false, read: () => {} });
export const useWalletBalance = () => useContext(BalanceCtx);

export function Wallets({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState<string>();
  const open = () => ref.current?.showModal();
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={[]} autoConnect onError={(e) => setErr(passkeyErrorText(e))}>
        <ConnectedBalance>
          <Ctx.Provider value={open}>
            {children}
            <WalletDialog dialogRef={ref} error={err} clearError={() => setErr(undefined)} />
          </Ctx.Provider>
        </ConnectedBalance>
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
 * The one devnet balance read behind every funding surface: it lives above them all, so the wallet dialog card and the
 * checkout card read the same value of the same wallet instead of racing two `getBalance` calls that can disagree.
 * `createBalanceRead` (balance.ts) owns what a read may claim and in what order; this binds it to one address, reads
 * whenever that address changes, and hands out the landing only while it is the landing of the address in hand, so a read
 * for the wallet the user just switched away from can never speak for the new one. `read` is rebuilt with the address and
 * this effect is the one that fires on a wallet switch, so a surface that reads for a reason of its own keys those to that
 * reason and not to `read`, which would send the same read twice. `funding` turns all that into what a card shows.
 */
export function useBalance(address?: string): WalletBalance {
  const [st, setSt] = useState<BalanceState>({ reading: false });
  const publish = useCallback((patch: Partial<BalanceState>) => setSt((s) => ({ ...s, ...patch })), []);
  const [reader] = useState(() => createBalanceRead(publish));
  const read = useCallback(() => { void reader.read(address); }, [reader, address]);
  useEffect(() => { read(); }, [read]);
  const held = st.landing?.address === address ? st.landing : undefined;
  return { address, balance: held?.balance, unreadable: held?.unreadable ?? false, reading: st.reading, read };
}

/** Above both funding surfaces, so neither of them reads the balance itself. */
function ConnectedBalance({ children }: { children: ReactNode }) {
  const { publicKey } = useWallet();
  const balance = useBalance(publicKey?.toBase58());
  return <BalanceCtx.Provider value={balance}>{children}</BalanceCtx.Provider>;
}

/** A fresh passkey wallet has 0 devnet SOL; the funding helper lives right here, next to the address. */
function Balance() {
  const { address, balance, unreadable, reading, read } = useWalletBalance();
  if (!address) return null;
  const fund = funding(balance, unreadable);
  if (fund.kind === "ok") return balance == null ? null : <p className="cb-muted">Devnet balance: <span className="cb-num">{sol(balance)}</span></p>;
  return <Faucet address={address} fund={fund} recheck={{ read, reading }} />;
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
          <Balance />
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
