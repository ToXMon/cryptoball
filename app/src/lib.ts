import { useEffect, useState } from "react";

/** Copy for the funding helper (components.tsx). Amounts go through the same Intl formatter as the rest of the app. */
export const FUNDING_COPY = {
  heading: "Get devnet SOL",
  short: (balance: bigint, needed: bigint) => `This wallet has ${sol(balance)}. One checkout needs ${sol(needed)}: the ticket plus a small fee margin.`,
  unread: "This wallet's devnet balance could not be read just now. Check it again, or paste this address into the faucet.",
  recheck: "Check balance again",
  faucet: "The faucet is run by Solana Labs and hands out free devnet test SOL. It is devnet play money: no value, cannot be withdrawn or sold.",
  paste: "Paste this address into the faucet to claim free devnet test SOL for this wallet.",
} as const;

const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const dt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** R-83: all money, numbers and dates go through Intl (en-US). */
export const sol = (lamports: bigint) => `${usd.format(Number(lamports) / 1e9)} SOL`;
export const num = (n: number) => usd.format(n);
export const dateTime = (unixSecs: number) => dt.format(new Date(unixSecs * 1000));
export const short = (s: string) => (s.length > 11 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
export const pad = (n: number) => String(n).padStart(2, "0");
export const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

export function parts(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  return { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
}

/** Unbiased secure random int in [0, n) (R-35). */
function randInt(n: number) {
  const max = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= max);
  return buf[0] % n;
}

/** Quick pick: 5 distinct numbers in 1..=69 ascending plus a bonus in 1..=26. */
export function quickPick() {
  const set = new Set<number>();
  while (set.size < 5) set.add(randInt(69) + 1);
  return { numbers: [...set].sort((a, b) => a - b), bonus: randInt(26) + 1 };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useReducedMotion() {
  const q = "(prefers-reduced-motion: reduce)";
  const [r, setR] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [st, setSt] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setSt((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => live && setSt({ data, loading: false }),
      (error) => live && setSt({ error, loading: false }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}

/** Hash router: "#/pick/1" -> ["pick", "1"]. */
export function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => { setR(read()); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return r;
}
export const go = (path: string) => { location.hash = `#/${path}`; };
