import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Balls, Countdown, Faucet, Stage, TicketFace, lazyScene } from "./components";
import { dateTime, explorer, go, num, pad, quickPick, short, sol, useAsync } from "./lib";
import { buyTicket, describeError, fetchCampaign, fetchCampaigns, fetchTicket, fetchTickets, funding, fundingNeeded, payout, refundTicket, type Campaign, type Ticket } from "./program";
import { useBalance, useWalletDialog } from "./Wallet";

// Code-split: three.js only loads when a stage scrolls into view on confirmation / results.
const TicketScene = lazyScene(() => import("./three/TicketScene"));
const BallsScene = lazyScene(() => import("./three/BallsScene"));

const MAX_CARTONS = 5;
const Loading = ({ what }: { what: string }) => <p className="cb-muted" aria-live="polite">Loading {what}…</p>;
const Err = ({ e }: { e: unknown }) => <p className="cb-error" role="alert">{describeError(e)}</p>;

function Trust() {
  return (
    <ul className="cb-trust">
      <li>Paid automatically. No claim step.</li>
      <li>Draw is verifiable on-chain.</li>
      <li>Your ticket is an NFT in your wallet.</li>
    </ul>
  );
}

function CampaignCard({ c }: { c: Campaign }) {
  const open = c.state === "Open" && c.closeTs * 1000 > Date.now();
  return (
    <article className="cb-card">
      <p className="cb-eyebrow">Draw #{c.id}</p>
      <p className="cb-prize">{sol(payout(c).prize)}</p>
      <p className="cb-muted">Entry {sol(c.priceLamports)} · 5 of 69 + Cryptoball · {num(c.ticketCount)} / {num(c.maxTickets)} sold</p>
      {c.state === "Open" ? <Countdown to={c.closeTs} /> : <p className="cb-countdown cb-muted">{c.state === "Settled" ? "Drawn" : c.state}</p>}
      <p>
        {open
          ? <a className="cb-btn cb-btn--primary" href={`#/pick/${c.id}`}>Pick numbers</a>
          : <a className="cb-btn cb-btn--ghost" href={`#/results/${c.id}`}>See results</a>}
      </p>
    </article>
  );
}

export function Landing() {
  const { data, error, loading } = useAsync(fetchCampaigns, []);
  const open = data?.filter((c) => c.state === "Open" && c.closeTs * 1000 > Date.now()).sort((a, b) => a.closeTs - b.closeTs);
  const hero = open?.[0];
  return (
    <>
      <section className="cb-hero">
        <p className="cb-eyebrow"><span className="cb-live" aria-hidden="true" /> Next draw</p>
        <h1 className="cb-prize cb-prize--xl">{hero ? sol(payout(hero).prize) : "Pick 5. Win it all."}</h1>
        <p className="cb-sub">Pick 5 numbers and a Cryptoball. One ticket wins. Paid automatically.</p>
        {hero && <Countdown to={hero.closeTs} label="Sales close in" />}
        <p><a className="cb-btn cb-btn--primary cb-btn--lg" href={hero ? `#/pick/${hero.id}` : "#/"}>Pick your numbers</a></p>
        <Trust />
        <p className="cb-muted cb-fine">Prize shown is the current pool after the {hero ? hero.feeBps / 100 : 10}% fee. The numbers you pick are recorded on your ticket; the winner is one randomly drawn ticket.</p>
      </section>
      <section aria-labelledby="draws">
        <h2 id="draws">Campaigns</h2>
        {loading && <Loading what="campaigns" />}
        {error != null && <Err e={error} />}
        <div className="cb-grid">{data?.map((c) => <CampaignCard key={c.id} c={c} />)}</div>
      </section>
      <Lookup />
    </>
  );
}

function Lookup() {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Ticket[] | null>(null);
  const [err, setErr] = useState<unknown>();
  return (
    <section aria-labelledby="find">
      <h2 id="find">Find your tickets</h2>
      <form className="cb-row" onSubmit={(e) => { e.preventDefault(); setErr(undefined); fetchTickets(q).then(setFound, setErr); }}>
        <label className="cb-field">
          <span className="cb-muted">Wallet address or purchase signature</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} required />
        </label>
        <button className="cb-btn cb-btn--ghost" type="submit">Look up</button>
      </form>
      {err != null && <Err e={err} />}
      {found && (found.length === 0
        ? <p className="cb-muted" aria-live="polite">No tickets found.</p>
        : <ul className="cb-list">{found.map((t) => <li key={`${t.campaign}-${t.index}`}><a href={`#/ticket/${t.campaign}/${t.index}`}>Draw #{t.campaign} · Ticket #{t.index} · {t.numbers.join(" ")} + {t.bonus}</a></li>)}</ul>)}
    </section>
  );
}

// ---------- pick ----------

interface Carton { numbers: number[]; bonus: number | null; }
const full = (c: Carton) => c.numbers.length === 5 && c.bonus != null;

function Cell({ n, on, dim, label, onClick }: { n: number; on: boolean; dim: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className="cb-cell" aria-pressed={on} aria-label={`${label} ${n}`} disabled={dim && !on} onClick={onClick}>
      <span className="cb-num">{pad(n)}</span>
    </button>
  );
}

export function Pick({ id }: { id: number }) {
  const { data: c, error, loading } = useAsync(() => fetchCampaign(id), [id]);
  const [carton, setCarton] = useState<Carton>({ numbers: [], bonus: null });
  const [cart, setCart] = useState<Carton[]>([]);
  if (loading && !c) return <Loading what="draw" />;
  if (error != null || !c) return <Err e={error} />;

  const toggle = (n: number) => setCarton((k) => ({ ...k, numbers: k.numbers.includes(n) ? k.numbers.filter((x) => x !== n) : k.numbers.length < 5 ? [...k.numbers, n].sort((a, b) => a - b) : k.numbers }));
  const add = () => { if (full(carton) && cart.length < MAX_CARTONS) { setCart([...cart, carton]); setCarton({ numbers: [], bonus: null }); } };
  const total = c.priceLamports * BigInt(cart.length);
  const fee = (total * BigInt(c.feeBps)) / 10_000n;

  return (
    <>
      <a className="cb-link" href="#/">← All draws</a>
      <h1>Draw #{c.id}: pick your numbers</h1>
      <Countdown to={c.closeTs} />
      <div className="cb-pick">
        <section aria-labelledby="carton-h" className="cb-card">
          <h2 id="carton-h">Carton {cart.length + 1} of {MAX_CARTONS}</h2>
          <p className="cb-muted">Choose 5 numbers from 1 to 69.</p>
          <div className="cb-cells" role="group" aria-label="Numbers 1 to 69">
            {Array.from({ length: 69 }, (_, i) => i + 1).map((n) => <Cell key={n} n={n} label="Number" on={carton.numbers.includes(n)} dim={carton.numbers.length >= 5} onClick={() => toggle(n)} />)}
          </div>
          <p className="cb-muted">Then your Cryptoball, 1 to 26.</p>
          <div className="cb-cells cb-cells--bonus" role="group" aria-label="Cryptoball 1 to 26">
            {Array.from({ length: 26 }, (_, i) => i + 1).map((n) => <Cell key={n} n={n} label="Cryptoball" on={carton.bonus === n} dim={false} onClick={() => setCarton((k) => ({ ...k, bonus: k.bonus === n ? null : n }))} />)}
          </div>
          <p className="cb-row">
            <button type="button" className="cb-btn cb-btn--ghost" onClick={() => setCarton(quickPick())}>Quick pick</button>
            <button type="button" className="cb-btn cb-btn--primary" disabled={!full(carton) || cart.length >= MAX_CARTONS} onClick={add}>Add to cart</button>
          </p>
          {cart.length >= MAX_CARTONS && <p className="cb-muted">Cart is full: {MAX_CARTONS} cartons per checkout.</p>}
        </section>

        <aside aria-labelledby="cart-h" className="cb-card">
          <h2 id="cart-h">Your cart</h2>
          {cart.length === 0 && <p className="cb-muted">No cartons yet.</p>}
          <ol className="cb-list">
            {cart.map((k, i) => (
              <li key={i} className="cb-cartline">
                <span className="cb-num">{k.numbers.map(pad).join(" ")} + {pad(k.bonus!)}</span>
                <button type="button" className="cb-link" aria-label={`Remove carton ${i + 1}`} onClick={() => setCart(cart.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ol>
          <Checkout c={c} cart={cart} total={total} fee={fee} onBought={(n) => setCart(cart.slice(n))} />
        </aside>
      </div>
    </>
  );
}

function Checkout({ c, cart, total, fee, onBought }: { c: Campaign; cart: Carton[]; total: bigint; fee: bigint; onBought: (n: number) => void }) {
  const { publicKey, sendTransaction } = useWallet();
  const openWallet = useWalletDialog();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<Ticket[]>([]);
  const buyer = publicKey?.toBase58();
  const { balance, unreadable, read } = useBalance(buyer);
  const wallet = { publicKey, sendTransaction };
  const needed = fundingNeeded(c.priceLamports, cart.length);
  const fund = funding(balance, unreadable, needed);

  // R-82: the app only ever talks to the devnet RPC (Wallets.tsx), so the cluster is fixed; the adapter has no cluster
  // readout, so the wallet-side check lives in the real program adapter when signing.
  async function pay() {
    if (!buyer) return openWallet();
    // Nothing is read before the payment: the card above already said whether the latest read could cover the order, and
    // the chain is the real judge. A wallet that cannot pay fails here with the funding message and a way to the faucet.
    setBusy(true); setErr(undefined); setDone([]); setProgress(0);
    const bought: Ticket[] = [];
    try {
      // One buy_ticket transaction per carton (design.md section 12, risk 2).
      for (const k of cart) { bought.push(await buyTicket(buyer, c.id, k.numbers, k.bonus!, wallet)); setProgress(bought.length); }
      sessionStorage.setItem("cb-last", JSON.stringify(bought));
      go(`ticket/${c.id}/${bought[0].index}`);
    } catch (e) {
      setErr(e);
      if (bought.length) { sessionStorage.setItem("cb-last", JSON.stringify(bought)); setDone(bought); onBought(bought.length); }
    } finally { setBusy(false); }
  }

  return (
    <div>
      <dl className="cb-sum">
        <dt>Entry price</dt><dd className="cb-num">{sol(c.priceLamports)} × {cart.length}</dd>
        <dt>Total</dt><dd className="cb-num"><b>{sol(total)}</b></dd>
        <dt>Protocol fee</dt><dd className="cb-num">{c.feeBps / 100}% of the pool ({sol(fee)} of this order)</dd>
      </dl>
      <p className="cb-warn">Devnet play money. No real funds.</p>
      {done.length > 0 && <p role="status">{done.length} ticket{done.length > 1 ? "s were" : " was"} bought before the error and removed from your cart. <a className="cb-link" href={`#/ticket/${c.id}/${done[0].index}`}>View ticket</a></p>}
      <button type="button" className="cb-btn cb-btn--primary cb-btn--block" disabled={busy || (!!buyer && cart.length === 0)} onClick={pay}>
        {busy ? `Confirming ${progress + 1} of ${cart.length}…` : buyer ? `Pay ${sol(total)}` : "Connect wallet to pay"}
      </button>
      {err != null && <Err e={err} />}
      {buyer != null && <Faucet address={buyer} fund={fund} retry={read} />}
      {busy && <p className="cb-muted" aria-live="polite">Approve each ticket in your wallet.</p>}
    </div>
  );
}

// ---------- confirmation ----------

export function Confirmation({ id, index }: { id: number; index: number }) {
  const { data: t, loading } = useAsync(async () => {
    const mine = JSON.parse(sessionStorage.getItem("cb-last") ?? "[]") as Ticket[];
    return mine.find((x) => x.campaign === id && x.index === index) ?? (await fetchTicket(id, index));
  }, [id, index]);
  const batch = (JSON.parse(sessionStorage.getItem("cb-last") ?? "[]") as Ticket[]).filter((x) => x.campaign === id);
  if (loading) return <Loading what="ticket" />;
  if (!t) return <p className="cb-error" role="alert">Ticket not found.</p>;
  return (
    <>
      <h1>You're in.</h1>
      <p className="cb-sub">If this ticket is drawn, the program pays <span className="cb-num">{short(t.buyer)}</span> automatically. No claim step.</p>
      <Stage
        className="cb-stage--ticket"
        scene={TicketScene}
        sceneProps={{ numbers: t.numbers, bonus: t.bonus, index: t.index, campaign: t.campaign }}
        flat={<article className="cb-ticket" aria-label={`Ticket ${t.index}, numbers ${t.numbers.join(", ")}, Cryptoball ${t.bonus}`}><TicketFace t={t} /></article>}
      />
      <dl className="cb-sum">
        <dt>Transaction</dt><dd><a className="cb-num" href={explorer("tx", t.signature)} target="_blank" rel="noreferrer">{short(t.signature)}</a></dd>
        <dt>Ticket NFT</dt><dd><a className="cb-num" href={explorer("address", t.asset)} target="_blank" rel="noreferrer">{short(t.asset)}</a></dd>
      </dl>
      {batch.length > 1 && (
        <p className="cb-muted">All tickets in this order:{" "}
          {batch.map((b) => <a key={b.index} className="cb-chip" href={`#/ticket/${b.campaign}/${b.index}`} aria-current={b.index === t.index}>#{b.index}</a>)}
        </p>
      )}
      <p className="cb-row"><a className="cb-btn cb-btn--ghost" href={`#/results/${id}`}>Draw results</a><a className="cb-btn cb-btn--ghost" href="#/">All draws</a></p>
    </>
  );
}

// ---------- results ----------

export function Results({ id }: { id: number }) {
  const { data, error, loading } = useAsync(async () => {
    const c = await fetchCampaign(id);
    const winner = c.winningIndex != null ? await fetchTicket(id, c.winningIndex) : undefined;
    return { c, winner };
  }, [id]);
  const [run, setRun] = useState(0);
  const { publicKey } = useWallet();
  if (loading && !data) return <Loading what="results" />;
  if (error != null || !data) return <Err e={error} />;
  const { c, winner } = data;
  const me = publicKey?.toBase58();

  if (c.state !== "Settled" || !winner) {
    return (
      <>
        <a className="cb-link" href="#/">← All draws</a>
        <h1>Draw #{c.id}</h1>
        {c.state === "Open" && <Countdown to={c.closeTs} label="Sales close in" />}
        <p className="cb-sub">{c.state === "Open" ? "The draw happens after sales close." : c.state === "DrawCommitted" ? "Draw night: waiting for the randomness reveal." : "This draw was cancelled."}</p>
        {c.state === "Cancelled" && <CancelledRefund c={c} />}
      </>
    );
  }
  const { prize, fee } = payout(c);
  return (
    <div data-theme="light" className="cb-programme">
      <a className="cb-link" href="#/">← All draws</a>
      <h1>Draw #{c.id} results</h1>
      <Stage
        className="cb-stage--balls"
        scene={BallsScene}
        sceneProps={{ numbers: winner.numbers, bonus: winner.bonus, runKey: run }}
        flat={<Balls numbers={winner.numbers} bonus={winner.bonus} drop />}
      />
      <p className="cb-row"><button type="button" className="cb-btn cb-btn--ghost" onClick={() => setRun(run + 1)}>Replay drop</button></p>
      <p className="cb-sub">One ticket was drawn at random. The numbers on it are not used to pick the winner.</p>
      <dl className="cb-sum">
        <dt>Winning ticket</dt><dd className="cb-num">#{winner.index}{me === winner.buyer ? " (yours!)" : ""}</dd>
        <dt>Paid to</dt><dd><span className="cb-num">{short(winner.buyer)}</span> automatically, {sol(prize)}</dd>
        <dt>Treasury fee</dt><dd className="cb-num">{sol(fee)}</dd>
        <dt>Sales closed</dt><dd>{dateTime(c.closeTs)}</dd>
        {c.randAccount && <><dt>Randomness account</dt><dd><a className="cb-num" href={explorer("address", c.randAccount)} target="_blank" rel="noreferrer">{short(c.randAccount)}</a></dd></>}
        {c.randomness && <><dt>Revealed value</dt><dd className="cb-num cb-addr">{c.randomness}</dd></>}
      </dl>
      <p className="cb-muted cb-fine">Randomness comes from Switchboard's TEE-based oracle and is checked by the program at settlement.</p>
    </div>
  );
}

function CancelledRefund({ c }: { c: Campaign }) {
  const { publicKey, sendTransaction } = useWallet();
  const [msg, setMsg] = useState<string>();
  const mine = useAsync(() => (publicKey ? fetchTickets(publicKey.toBase58()) : Promise.resolve([])), [publicKey]);
  const list = (mine.data ?? []).filter((t) => t.campaign === c.id && t.status === "Active");
  if (!list.length) return <p className="cb-muted">Cancelled draws refund every ticket to its buyer. Connect your wallet to see yours.</p>;
  return (
    <ul className="cb-list">
      {list.map((t) => (
        <li key={t.index} className="cb-cartline">
          <span>Ticket #{t.index}</span>
          <button type="button" className="cb-btn cb-btn--ghost" onClick={() => refundTicket(c.id, t.index, { publicKey, sendTransaction }).then(() => setMsg("Refunded."), (e) => setMsg(describeError(e)))}>Refund</button>
        </li>
      ))}
      {msg && <li aria-live="polite">{msg}</li>}
    </ul>
  );
}
