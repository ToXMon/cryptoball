import { Component, Suspense, lazy, useEffect, useId, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { pad, parts, useNow, useReducedMotion, fundingCopy, FUNDING_COPY } from "./lib";
import { FAUCET_URL, describeError, isFundingError, type Funding, type Ticket } from "./program";

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
 * Funding helper for a wallet that cannot cover a ticket: the address, a copy button and a link out to the
 * official Solana devnet faucet. No faucet of our own (R-82 devnet-only); the copy says plainly it is free play money.
 * What it says about the wallet comes from `fundingCopy`, so every surface renders the same state the same way, and
 * `recheck` re-reads the one shared balance read: it is there because a failed read must not hide the helper, and it
 * waits for the read it started because only the newest read may speak for the wallet.
 */
export function Faucet({ address, fund, recheck }: { address: string; fund: Funding; recheck?: { read: () => void; reading: boolean } }) {
  const headingId = useId();
  const [status, setStatus] = useState<string>();
  const copied = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copy = fundingCopy(fund);
  const copyAddress = async () => {
    clearTimeout(copied.current); // the older copy's timer must not take this one's status down with it
    try {
      await navigator.clipboard.writeText(address);
      setStatus(COPIED);
      copied.current = setTimeout(() => setStatus(undefined), 2000);
    } catch {
      setStatus("Could not copy the address. Select it and copy it by hand.");
    }
  };
  if (!copy) return null;
  return (
    <section className="cb-card cb-funding" aria-labelledby={headingId}>
      <h2 id={headingId}>{copy.heading}</h2>
      <p>{copy.note}</p>
      <p className="cb-num cb-addr">{address}</p>
      <p className="cb-row">
        <button type="button" className="cb-btn cb-btn--ghost" onClick={() => void copyAddress()}>{status === COPIED ? "Address copied" : "Copy address"}</button>
        {recheck && <button type="button" className="cb-btn cb-btn--ghost" disabled={recheck.reading} onClick={recheck.read}>{FUNDING_COPY.recheck}</button>}
        <a className="cb-btn cb-btn--primary" href={FAUCET_URL} target="_blank" rel="noreferrer">Open Solana devnet faucet</a>
      </p>
      <p className="cb-fine" aria-live="polite">{status ?? FUNDING_COPY.faucet}</p>
    </section>
  );
}

/**
 * The one surface every error in the app is rendered through. A transaction that failed for want of devnet SOL says so in
 * plain words and carries the address to fund and the link that funds it, because `FUNDING_ERROR` names the faucet app-wide
 * and a page must never point at an affordance it is not showing; every other error is the described text. With no address in
 * hand there is nothing to fund from, so it falls back to the described text like any other.
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
