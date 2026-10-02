import { Component, Suspense, lazy, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { pad, parts, useNow, useReducedMotion } from "./lib";
import type { Ticket } from "./program";

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

export function TicketFace({ t }: { t: Pick<Ticket, "numbers" | "bonus" | "index" | "campaign"> }) {
  return (
    <div className="cb-ticket__face">
      <p className="cb-ticket__brand">Cryptoball</p>
      <Balls numbers={t.numbers} bonus={t.bonus} />
      <p className="cb-ticket__id cb-num">Ticket #{t.index} · Draw #{t.campaign}</p>
    </div>
  );
}
