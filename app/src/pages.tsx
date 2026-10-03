import { useEffect, useId, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Balls, Copyable, Countdown, Err, Faucet, Stage, TicketFace, lazyScene } from "./components";
import { dateTime, explorer, finishedCopy, FINISHED_COPY, go, num, pad, quickPick, short, sol, useAsync } from "./lib";
import { buyTicket, campaignAddress, discoverCampaigns, fetchCampaign, fetchSettleSignature, fetchTicket, fetchTickets, funding, fundingNeeded, iWon, outcome, payGate, payout, refundTicket, type Campaign, type Ticket } from "./program";
import { useWalletBalance, useWalletDialog } from "./Wallet";

// Code-split: three.js only loads when a stage scrolls into view on confirmation / results.
const TicketScene = lazyScene(() => import("./three/TicketScene"));
const BallsScene = lazyScene(() => import("./three/BallsScene"));

const MAX_CARTONS = 5;
const Loading = ({ what }: { what: string }) => <p className="cb-muted" aria-live="polite">Loading {what}…</p>;

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
  const { prize } = payout(c);
  const state = outcome(c);
  return (
    <article className="cb-card">
      <p className="cb-eyebrow">Draw #{c.id}</p>
      <p className="cb-prize">{state === "cancelled" ? "No prize" : state === "settled" ? sol(c.prizeLamports ?? prize) : sol(prize)}</p>
      <p className="cb-muted">Entry {sol(c.priceLamports)} · 5 of 69 + Cryptoball · {num(c.ticketCount)} / {num(c.maxTickets)} sold</p>
      {open ? <Countdown to={c.closeTs} /> : <p className="cb-countdown cb-muted">{state === "settled" ? "Drawn" : state === "cancelled" ? "Cancelled, everyone refunded" : state === "committed" ? "Committed, awaiting reveal" : "Closed"}</p>}
      {!open && <p className="cb-muted cb-fine">{finishedCopy(state, c.winningIndex, true)}</p>}
      <p>
        {open
          ? <a className="cb-btn cb-btn--primary" href={`#/pick/${c.id}`}>Pick numbers</a>
          : state === "open" ? <span className="cb-btn cb-btn--ghost" aria-disabled="true">Sales closed</span>
            : <a className="cb-btn cb-btn--ghost" href={`#/results/${c.id}`}>See results</a>}
      </p>
    </article>
  );
}

export function Landing() {
  const { data, error, loading } = useAsync(discoverCampaigns, []);
  const campaigns = data?.campaigns;
  const live = (c: Campaign) => c.state === "Open" && c.closeTs * 1000 > Date.now();
  const open = campaigns?.filter(live).sort((a, b) => a.closeTs - b.closeTs);
  // Everything else - a closed draw waiting for its commit, and every finished draw - is listed too, so a friend who
  // arrives after everything shut still sees what happened rather than an empty page.
  const past = campaigns?.filter((c) => !live(c));
  const hero = open?.[0];
  const last = past?.[0];
  // Nothing open is not an empty page: the most recent finished draw is the answer, and it is one click away.
  const headline = hero ? sol(payout(hero).prize) : last && outcome(last) === "settled" ? `${sol(last.prizeLamports ?? payout(last).prize)} won` : "Pick 5. Win it all.";
  return (
    <>
      <section className="cb-hero">
        <p className="cb-eyebrow"><span className="cb-live" aria-hidden="true" /> {hero ? "Next draw" : "Latest result"}</p>
        <h1 className="cb-prize cb-prize--xl">{headline}</h1>
        <p className="cb-sub">Pick 5 numbers and a Cryptoball. One ticket wins. Paid automatically.</p>
        {hero ? <Countdown to={hero.closeTs} label="Sales close in" /> : <p className="cb-muted">{last ? finishedCopy(outcome(last), last.winningIndex, true) : "The next draw opens soon."}</p>}
        <p><a className="cb-btn cb-btn--primary cb-btn--lg" href={hero ? `#/pick/${hero.id}` : last ? `#/results/${last.id}` : "#/"}>{hero ? "Pick your numbers" : last ? "See the result" : "Cryptoball"}</a></p>
        <Trust />
        <p className="cb-muted cb-fine">Prize shown is the current pool after the {hero ? hero.feeBps / 100 : 10}% fee. The numbers you pick are recorded on your ticket; the winner is one randomly drawn ticket.</p>
      </section>
      <section aria-labelledby="draws">
        <h2 id="draws">Campaigns</h2>
        {loading && <Loading what="campaigns" />}
        {error != null && <Err e={error} />}
        {!!data?.truncated && <p className="cb-warn">Showing the {num(data.campaigns.length)} most recent of {num(data.found)} draws ever opened. Older ones are still on chain and still refundable.</p>}
        <div className="cb-grid">{open?.map((c) => <CampaignCard key={c.id} c={c} />)}</div>
        {!loading && !open?.length && <p className="cb-muted">No draw is open right now. Finished draws are below.</p>}
      </section>
      {!!past?.length && (
        <section aria-labelledby="past">
          <h2 id="past">Closed draws</h2>
          <p className="cb-muted">Every draw that is no longer selling: the numbers, the winner and the proof where there is one, and a refund where there is not.</p>
          <div className="cb-grid">{past.map((c) => <CampaignCard key={c.id} c={c} />)}</div>
        </section>
      )}
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
  const { address, balance, unreadable, reading, read } = useWalletBalance();
  const wallet = { publicKey, sendTransaction };
  const fund = funding(balance, unreadable, fundingNeeded(c.priceLamports, cart.length));
  const gate = payGate({ buyer, busy, cartons: cart.length });

  // Entering this draw is the one moment here that can leave the shared landing stale, so this asks for one read: the card
  // judges the landing it holds against the live cart total on every render, so a cart that changes is no reason to read
  // again — the claim, not the need, is what goes stale. It does not key to `read` either: `read` is rebuilt with the address,
  // and the read above this one already fires on a wallet switch. No polling: this, paying below, and the card's own re-check.
  useEffect(() => { read(); }, []);

  // R-82: the app only ever talks to the devnet RPC (Wallets.tsx), so the cluster is fixed; the adapter has no cluster
  // readout, so the wallet-side check lives in the real program adapter when signing.
  async function pay() {
    if (gate.kind === "connect") return openWallet();
    if (gate.kind === "wait") return;
    // The gate is the whole decision, and the balance read is not part of it: this sends the order whatever the card
    // above said, because the chain is the judge of whether a wallet can pay and answers FUNDING_ERROR if it cannot.
    setBusy(true); setErr(undefined); setDone([]); setProgress(0);
    const bought: Ticket[] = [];
    try {
      // One buy_ticket transaction per carton (design.md section 12, risk 2).
      for (const k of cart) { bought.push(await buyTicket(gate.buyer, c.id, k.numbers, k.bonus!, wallet)); setProgress(bought.length); }
      sessionStorage.setItem("cb-last", JSON.stringify(bought));
      go(`ticket/${c.id}/${bought[0].index}`);
    } catch (e) {
      setErr(e);
      if (bought.length) { sessionStorage.setItem("cb-last", JSON.stringify(bought)); setDone(bought); onBought(bought.length); }
    } finally {
      // The chain has had its say about what this wallet holds: paying spends from it, and a FUNDING_ERROR says the read
      // above was wrong about it. Either way the read goes stale here, so it is taken again — that is what puts the
      // faucet helper back on the page when the error tells the friend to use it.
      read();
      setBusy(false);
    }
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
      <button type="button" className="cb-btn cb-btn--primary cb-btn--block" disabled={busy || gate.kind === "wait"} onClick={pay}>
        {busy ? `Confirming ${progress + 1} of ${cart.length}…` : buyer ? `Pay ${sol(total)}` : "Connect wallet to pay"}
      </button>
      {err != null && <Err e={err} />}
      {address != null && <Faucet address={address} fund={fund} recheck={{ read, reading }} />}
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

/**
 * The proof of a finished draw, on the page that shows the result: the randomness account, the slot it was seeded from,
 * the revealed value, and the settle transaction that turned one into the other. A player can click all of it and check
 * it themselves, which is the whole promise of the product. The settle signature is a chain read that may come back
 * empty (an account with a long history, or an RPC that lost it), and it never blocks the result: the draw's own
 * Explorer history is the fallback, so the numbers above are never withheld for a missing link.
 */
function Proof({ c, settle }: { c: Campaign; settle?: string }) {
  const headingId = useId();
  return (
    <section className="cb-card" aria-labelledby={headingId}>
      <h2 id={headingId}>Proof this draw was fair</h2>
      <dl className="cb-sum">
        <dt>Randomness account</dt>
        <dd>{c.randAccount ? <a className="cb-num" href={explorer("address", c.randAccount)} target="_blank" rel="noreferrer">{short(c.randAccount)}</a> : <span className="cb-muted">no randomness was committed for this draw</span>}</dd>
        <dt>Seed slot</dt>
        <dd className="cb-num">{c.seedSlot ? num(c.seedSlot) : <span className="cb-muted">none</span>}</dd>
        <dt>Revealed value</dt>
        <dd className="cb-num cb-addr">{c.randomness ?? "not revealed"}</dd>
        <dt>Settle transaction</dt>
        <dd>{settle
          ? <a className="cb-num" href={explorer("tx", settle)} target="_blank" rel="noreferrer">{short(settle)}</a>
          : <a className="cb-num" href={explorer("address", campaignAddress(c.id))} target="_blank" rel="noreferrer">all draw transactions</a>}</dd>
        <dt>Draw account</dt>
        <dd><a className="cb-num" href={explorer("address", campaignAddress(c.id))} target="_blank" rel="noreferrer">{short(campaignAddress(c.id))}</a></dd>
      </dl>
      <p className="cb-muted cb-fine">Randomness comes from Switchboard's TEE-based oracle and is checked by the program at settlement: the seed slot is fixed before sales of the result could be known, and the winning ticket is an index derived from the revealed value, not a match against the numbers on any ticket.</p>
    </section>
  );
}

export function Results({ id }: { id: number }) {
  const { data, error, loading } = useAsync(async () => {
    const c = await fetchCampaign(id);
    // One chain read for the winning ticket, one for the settle transaction. Neither is allowed to hide the result:
    // a failed proof read leaves the numbers, the winner and the money on the page.
    const won = outcome(c) === "settled" ? await fetchTicket(id, c.winningIndex!).catch(() => undefined) : undefined;
    const settle = c.randAccount ? await fetchSettleSignature(c.randAccount).catch(() => undefined) : undefined;
    return { c, won, settle };
  }, [id]);
  const [run, setRun] = useState(0);
  const { publicKey } = useWallet();
  if (loading && !data) return <Loading what="results" />;
  if (error != null || !data) return <Err e={error} />;
  const { c, won, settle } = data;
  const me = publicKey?.toBase58();
  const state = outcome(c);
  const { pool } = payout(c);

  if (state === "open") {
    const late = c.closeTs * 1000 <= Date.now();
    return (
      <>
        <a className="cb-link" href="#/">← All draws</a>
        <h1>Draw #{c.id}</h1>
        {late ? <p className="cb-countdown cb-muted">Sales closed</p> : <Countdown to={c.closeTs} label="Sales close in" />}
        <p className="cb-sub" role="status">{finishedCopy("open", undefined, late)}</p>
        <dl className="cb-sum">
          <dt>Tickets sold</dt><dd className="cb-num">{num(c.ticketCount)}</dd>
          <dt>Pool</dt><dd className="cb-num">{sol(pool)}</dd>
          <dt>Sales closed</dt><dd>{dateTime(c.closeTs)}</dd>
        </dl>
        {!late && <p><a className="cb-btn cb-btn--primary" href={`#/pick/${c.id}`}>Pick numbers</a></p>}
      </>
    );
  }

  if (state !== "settled") {
    return (
      <div data-theme="light" className="cb-programme">
        <a className="cb-link" href="#/">← All draws</a>
        <h1>Draw #{c.id}: {state === "cancelled" ? "cancelled, everyone refunded" : "committed, no winner yet"}</h1>
        <p className="cb-sub" role="status">{state === "cancelled" ? FINISHED_COPY.cancelled : FINISHED_COPY.committed}</p>
        <dl className="cb-sum">
          <dt>Tickets sold</dt><dd className="cb-num">{num(c.ticketCount)}</dd>
          <dt>Pool</dt><dd className="cb-num">{sol(pool)}</dd>
          <dt>Sales closed</dt><dd>{dateTime(c.closeTs)}</dd>
          <dt>Committed</dt><dd>{c.committedAt ? dateTime(c.committedAt) : "not committed"}</dd>
        </dl>
        {state === "cancelled" && <CancelledRefund c={c} />}
        <Proof c={c} settle={settle} />
      </div>
    );
  }

  const { fee, prize } = payout(c);
  const prizePaid = c.prizeLamports ?? prize;
  const feeTaken = c.feeLamports ?? fee;
  return (
    <div data-theme="light" className="cb-programme">
      <a className="cb-link" href="#/">← All draws</a>
      <h1>Draw #{c.id} results</h1>
      <p className="cb-sub" role="status">{iWon(c, me) ? "Your ticket won this draw. The prize was paid to your wallet in the settling transaction." : finishedCopy(state, c.winningIndex)}</p>
      {won && (
        <Stage
          className="cb-stage--balls"
          scene={BallsScene}
          sceneProps={{ numbers: won.numbers, bonus: won.bonus, runKey: run }}
          flat={<Balls numbers={won.numbers} bonus={won.bonus} drop />}
        />
      )}
      <p className="cb-row"><button type="button" className="cb-btn cb-btn--ghost" onClick={() => setRun(run + 1)}>Replay drop</button></p>
      <dl className="cb-sum">
        <dt>Winning ticket</dt><dd className="cb-num">#{c.winningIndex}{me === c.winner ? " (yours!)" : ""}</dd>
        {won && <><dt>Numbers on it</dt><dd className="cb-num">{won.numbers.map(pad).join(" ")} + {pad(won.bonus)}</dd></>}
        {c.winningNumbers && <><dt>Drawn numbers</dt><dd className="cb-num">{c.winningNumbers.map(pad).join(" ")} + {pad(c.winningBonus ?? 0)}</dd></>}
        {!won && <><dt>Numbers on it</dt><dd className="cb-muted">the winning ticket account could not be read just now; the winner and the prize below are read from the draw itself</dd></>}
        <dt>Paid to</dt><dd><Copyable value={c.winner ?? ""} label="Copy address" display={short(c.winner ?? "")} /></dd>
        <dt>Prize paid</dt><dd className="cb-num">{sol(prizePaid)}, automatically, in the settling transaction</dd>
        <dt>Treasury fee</dt><dd className="cb-num">{sol(feeTaken)}</dd>
        <dt>Tickets sold</dt><dd className="cb-num">{num(c.ticketCount)}</dd>
        <dt>Pool</dt><dd className="cb-num">{sol(pool)}</dd>
        <dt>Sales closed</dt><dd>{dateTime(c.closeTs)}</dd>
      </dl>
      <Proof c={c} settle={settle} />
      <p className="cb-muted cb-fine">One ticket was drawn at random. The numbers on it are not used to pick the winner: the winning ticket is the index the revealed randomness produced.</p>
    </div>
  );
}

function CancelledRefund({ c }: { c: Campaign }) {
  const { publicKey, sendTransaction } = useWallet();
  const { address, read } = useWalletBalance();
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<unknown>();
  const mine = useAsync(() => (publicKey ? fetchTickets(publicKey.toBase58()) : Promise.resolve([])), [publicKey]);
  const list = (mine.data ?? []).filter((t) => t.campaign === c.id && t.status === "Active");
  if (!list.length) return <p className="cb-muted">Cancelled draws refund every ticket to its buyer. Connect your wallet to see yours.</p>;
  // A refund spends from the wallet exactly as a purchase does, so the read is taken again however this lands: what the
  // chain did is the only thing that settles whether this wallet can still afford anything, and the error below carries the
  // faucet so a refund that ran out of SOL is actionable on this page, which has no funding card of its own.
  const refund = (index: number) => refundTicket(c.id, index, { publicKey, sendTransaction }).then(
    () => { read(); setErr(undefined); setMsg("Refunded."); },
    (e) => { read(); setMsg(undefined); setErr(e); },
  );
  return (
    <ul className="cb-list">
      {list.map((t) => (
        <li key={t.index} className="cb-cartline">
          <span>Ticket #{t.index}</span>
          <button type="button" className="cb-btn cb-btn--ghost" onClick={() => void refund(t.index)}>Refund</button>
        </li>
      ))}
      {msg && <li aria-live="polite">{msg}</li>}
      {err != null && <li><Err e={err} address={address} /></li>}
    </ul>
  );
}
