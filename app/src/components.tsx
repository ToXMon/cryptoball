import { Component, Suspense, lazy, useEffect, useId, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { pad, parts, useNow, useReducedMotion, fundingCopy, FUNDING_COPY, CLAIM_CAPS, sol, useAsync } from "./lib";
import { FAUCET_URL, claimGate, claimSol, describeError, ERROR_COPY, fetchClaimRecord, fetchFaucet, faucetRemaining, isFundingError, type Funding, type Ticket } from "./program";

export function Ball({ n, bonus, delay = 0, drop }: { n: number; bonus?: boolean; delay?: number; drop?: boolean }) {
  return (
    <span
      className={`cb-ball${bonus ? " cb-ball--bonus" : ""}${drop ? " cb-ball--drop" : ""}`}
      style={drop ? { animationDelay: `${delay}ms` } : undefined}
    >
      <span className="cb-num">{pad(n)}</span>
    </span>
  );
}

export function Balls({ numbers, bonus, drop }: { numbers: number[]; bonus: number; drop?: boolean }) {
  return (
    <div className="cb-balls" role="list" aria-label={`Numbers ${numbers.join(", ")}, Cryptoball ${bonus}`}>
      {numbers.map((n, i) => <div role="listitem" key={n}><Ball n={n} drop={drop} delay={i * 140} /></div>)}
      <div role="listitem" aria-label={`Cryptoball ${bonus}`}><Ball n={bonus} bonus drop={drop} delay={numbers.length * 140} /></div>
    </div>
  );
}

export function Countdown({ to, label = "Closes in" }: { to: number; label?: string }) {
  const now = useNow();
  const left = to - now;
  if (left <= 0) return <p className="cb-countdown cb-muted">Sales closed</p>;
  const { d, h, m, s } = parts(left);
  return (
    <p className="cb-countdown" role="timer">
      <span className="cb-muted">{label}</span>{" "}
      {d > 0 && <b className="cb-num">{d}d </b>}
      <b className="cb-num">{pad(h)}h {pad(m)}m {pad(s)}s</b>
    </p>
  );
}

/** Class component: React error boundaries have no hook form. A failed 3D chunk leaves the flat card. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

const hasWebGL = () => {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
};

export interface SceneProps { active: boolean; reduced: boolean; ready: () => void; }

/**
 * Flat DOM first (LCP + a11y), 3D canvas lazily loaded once the stage scrolls into view.
 * The flat children stay in the DOM under the canvas; the canvas is aria-hidden.
 */
export function Stage<P extends object>({ flat, scene, sceneProps, className = "" }: {
  flat: ReactNode;
  scene: LazyExoticComponent<ComponentType<P & SceneProps>>;
  sceneProps: P;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();
  const [gl] = useState(hasWebGL);
  useEffect(() => {
    const el = box.current;
    if (!el || !gl) return;
    const io = new IntersectionObserver(([e]) => { setVisible(e.isIntersecting); if (e.isIntersecting) setSeen(true); });
    io.observe(el);
    return () => io.disconnect();
  }, [gl]);
  const Scene = scene as ComponentType<P & SceneProps>;
  return (
    <div ref={box} className={`cb-stage ${ready ? "is-3d" : ""} ${className}`}>
      <div className="cb-stage__flat">{flat}</div>
      {gl && seen && (
        <div className="cb-stage__canvas" aria-hidden="true">
          <Quiet>
            <Suspense fallback={null}>
              <Scene {...sceneProps} active={visible} reduced={reduced} ready={() => setReady(true)} />
            </Suspense>
          </Quiet>
        </div>
      )}
    </div>
  );
}

export const lazyScene = <P,>(load: () => Promise<{ default: ComponentType<P> }>) => lazy(load);

const COPIED = "Address copied.";

/**
 * An address with a copy button, so a player never has to read one out of a wall of characters. Used for the wallet
 * address and for the winner's, so both truncate the same way and copy the same way.
 */
export function Copyable({ value, label = "Copy address", display }: { value: string; label?: string; display?: string }) {
  const [status, setStatus] = useState<string>();
  const copied = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copy = async () => {
    clearTimeout(copied.current); // the older copy's timer must not take this one's status down with it
    try {
      await navigator.clipboard.writeText(value);
      setStatus(COPIED);
      copied.current = setTimeout(() => setStatus(undefined), 2000);
    } catch {
      setStatus("Could not copy the address. Select it and copy it by hand.");
    }
  };
  return (
    <>
      <span className="cb-num cb-addr">{display ?? value}</span>{" "}
      <button type="button" className="cb-btn cb-btn--ghost" onClick={() => void copy()}>{status === COPIED ? "Copied" : label}</button>
    </>
  );
}

/**
 * Funding helper for a wallet that cannot cover a ticket: the address, a copy button, the in-app devnet claim and a link
 * out to the official Solana devnet faucet. What it says about the wallet comes from `fundingCopy`, so every surface
 * renders the same state the same way, and `recheck` re-reads the one shared balance read: it is there because a failed
 * read must not hide the helper, and it waits for the read it started because only the newest read may speak for the wallet.
 *
 * The claim button is the fast path the app owes a friend: `claimGate` (program.ts) asks the two on-chain tallies what
 * this wallet may still take and never proposes more than the pool has left or than the lifetime allowance, so the
 * button and the program agree on what is possible. A cap reached before the click uses the program's own error copy
 * (`ERROR_COPY`), not new wording, and the external faucet stays on the page as the way through a drained pool.
 */
export function Faucet({ address, fund, recheck }: { address: string; fund: Funding; recheck?: { read: () => void; reading: boolean } }) {
  const headingId = useId();
  const { publicKey, sendTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<bigint>();
  const [err, setErr] = useState<unknown>();
  const [reads, setReads] = useState(0); // bumping this re-reads the tallies after a claim moves both of them
  const { data: ledger } = useAsync(fetchFaucet, [reads]);
  const { data: record } = useAsync(() => fetchClaimRecord(address), [address, reads]);
  const gate = claimGate({ address, busy, remaining: faucetRemaining(ledger), claimed: record?.claimed });
  const copy = fundingCopy(fund);

  const claim = async () => {
    if (gate.kind !== "claim") return;
    setBusy(true); setErr(undefined);
    try {
      await claimSol(gate.amount, { publicKey, sendTransaction });
      setClaimed(gate.amount);
      setReads(reads + 1);
      recheck?.read(); // the chain has had its say about what this wallet holds, so the read behind this card is stale
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  if (!copy && claimed == null) return null;
  return (
    <div>
      {copy && (
        <section className="cb-card cb-funding" aria-labelledby={headingId}>
          <h2 id={headingId}>{copy.heading}</h2>
          <p>{copy.note}</p>
          <p className="cb-row"><Copyable value={address} /></p>
          <p className="cb-row">
            {recheck && <button type="button" className="cb-btn cb-btn--ghost" disabled={recheck.reading} onClick={recheck.read}>{FUNDING_COPY.recheck}</button>}
            {gate.kind === "claim" && <button type="button" className="cb-btn cb-btn--primary" disabled={busy} onClick={() => void claim()}>{busy ? "Claiming…" : `Claim ${sol(gate.amount)}`}</button>}
            <a className={`cb-btn cb-btn--${gate.kind === "claim" ? "ghost" : "primary"}`} href={FAUCET_URL} target="_blank" rel="noreferrer">Open Solana devnet faucet</a>
          </p>
          <p className="cb-fine" aria-live="polite">
            {gate.kind === "capped" ? ERROR_COPY.ClaimLifetimeCap : gate.kind === "drained" ? ERROR_COPY.FaucetDrained : `${CLAIM_CAPS} ${FUNDING_COPY.faucet}`}
          </p>
          {gate.kind === "claim" && fund.kind === "empty" && (
            <p className="cb-fine">A wallet holding nothing cannot pay its own transaction fee: top up once from the Solana faucet above, then claim here for the 0.11 SOL.</p>
          )}
        </section>
      )}
      {claimed != null && <p className="cb-muted" role="status">Claimed {sol(claimed)} into this wallet.</p>}
      {err != null && <Err e={err} address={address} />}
    </div>
  );
}

/**
 * The one surface every error in the app is rendered through: the described text. A page that shows no funding card of its
 * own passes the address, and then a wallet short of devnet SOL also carries that address and the link that funds it,
 * because `FUNDING_ERROR` names the faucet app-wide and nothing else on such a page points at one. A page that renders the
 * funding card passes no address, and the card is the one place that address and that link are shown.
 */
export function Err({ e, address }: { e: unknown; address?: string }) {
  if (!isFundingError(e) || !address) return <p className="cb-error" role="alert">{describeError(e)}</p>;
  return (
    <div className="cb-error" role="alert">
      <p>{describeError(e)}</p>
      <p className="cb-num cb-addr">{address}</p>
      <p><a className="cb-btn cb-btn--primary" href={FAUCET_URL} target="_blank" rel="noreferrer">Open Solana devnet faucet</a></p>
    </div>
  );
}

export function TicketFace({ t }: { t: Pick<Ticket, "numbers" | "bonus" | "index" | "campaign"> }) {
  return (
    <div className="cb-ticket__face">
      <p className="cb-ticket__brand">Cryptoball</p>
      <Balls numbers={t.numbers} bonus={t.bonus} />
      <p className="cb-ticket__id cb-num">Ticket #{t.index} · Draw #{t.campaign}</p>
    </div>
  );
}
