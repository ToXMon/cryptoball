import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletDialog } from "./Wallet";
import { Countdown, Err } from "./components";
import { dateTime, explorer, short, useAsync } from "./lib";
import {
  cancelLossless, commitLossless, depositLossless, discoverLosslessCampaigns,
  estimatedOdds, fetchLosslessConfig, fetchLosslessPosition, harvestLossless, LOSSLESS_PROGRAM_ID,
  LOSSLESS_USDC_MINT, mockAccrueLossless, mockLossLossless, parseUsdc, settleLossless,
  usdc, withdrawLossless, type LosslessCampaign, type LosslessPosition,
} from "./lossless";

const SEED = Array.from({ length: 32 }, (_, i) => i + 1);
const percent = (n: bigint, d: bigint) => d === 0n ? "0%" : `${(Number(n * 1_000_000n / d) / 10_000).toFixed(2)}%`;
const stateCopy = (c: LosslessCampaign) => c.shortfall
  ? "Shortfall · new deposits, harvest payouts, and draw commits stop. Withdrawals remain available."
  : c.state === "Open" ? "Open · deposit shares enter the draw after one slot; sales end at the listed deadline."
    : c.state === "DrawCommitted" ? "Draw committed · share weights and prize are fixed; the deterministic test seed is on-chain."
      : c.state === "Settled" ? `Revealed · ${c.winner ? `winner ${short(c.winner)}` : "winner recorded on-chain"}; prize paid from the separate prize vault.`
        : "Cancelled · no winner; any recorded prize returned to mock value and positions may withdraw.";

function LosslessCampaignCard({ c, admin, slot, revision, refresh }: { c: LosslessCampaign; admin?: string; slot: bigint; revision: number; refresh: () => void }) {
  const { publicKey, sendTransaction } = useWallet();
  const me = publicKey?.toBase58();
  const wallet = { publicKey, sendTransaction };
  const openWallet = useWalletDialog();
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const { data: position } = useAsync(() => me ? fetchLosslessPosition(c.address, me) : Promise.resolve(undefined), [c.address, me, revision]);
  const now = Date.now() / 1000;
  const closed = c.closeTs <= now;
  const canWithdraw = !!position && !position.withdrawn && (c.state === "Settled" || c.state === "Cancelled" || c.shortfall);
  const odds = estimatedOdds(position, c, slot);
  const transact = async (label: string, fn: () => Promise<string>) => {
    if (!me) return openWallet();
    setBusy(label); setError(undefined); setNotice(undefined);
    try {
      const signature = await fn();
      setNotice(`${label} confirmed · ${short(signature)}`);
      refresh();
    } catch (e) { setError(e); }
    finally { setBusy(undefined); }
  };

  return (
    <article className="cb-card" data-campaign={c.address}>
      <p className="cb-eyebrow">USDC draw #{c.id.toString()} · mock adapter</p>
      <h3>{c.shortfall ? "Shortfall" : c.state === "DrawCommitted" ? "Awaiting reveal" : c.state}</h3>
      <p className="cb-sub">{stateCopy(c)}</p>
      {c.state === "Open" && !closed && <Countdown to={c.closeTs} label="Deposit window closes in" />}
      <dl className="cb-sum">
        <dt>Principal ledger</dt><dd className="cb-num">{usdc(c.principal)}</dd>
        <dt>Tracked mock value</dt><dd className="cb-num">{usdc(c.mockValue)}</dd>
        <dt>Prize vault</dt><dd className="cb-num">{usdc(c.prize)}</dd>
        <dt>Eligible shares</dt><dd className="cb-num">{usdc(c.state === "DrawCommitted" ? c.snapshotShares : c.shares)} · {c.state === "DrawCommitted" ? c.snapshotPositions : c.positions} positions</dd>
        <dt>Entry limit</dt><dd className="cb-num">{usdc(c.principalCap)} · {c.maxPositions} positions max</dd>
        <dt>Closes</dt><dd>{dateTime(c.closeTs)}</dd>
        {position && !position.withdrawn && <>
          <dt>Your principal shares</dt><dd className="cb-num">{usdc(position.shares)}</dd>
          <dt>Your estimated draw share</dt><dd className="cb-num">{odds.eligible ? percent(odds.numerator, odds.denominator) : "Not eligible yet"}</dd>
          <dt>Eligible after slot</dt><dd className="cb-num">{position.eligibleAfterSlot.toString()}</dd>
        </>}
        {c.winner && <><dt>Winner</dt><dd><a className="cb-addr" href={explorer("address", c.winner)} target="_blank" rel="noreferrer">{c.winner}</a></dd></>}
        {c.mockRandomness && <><dt>Recorded test seed</dt><dd className="cb-addr">{c.mockRandomness.map((n) => n.toString(16).padStart(2, "0")).join("")}</dd></>}
        <dt>Campaign account</dt><dd><a className="cb-addr" href={explorer("address", c.address)} target="_blank" rel="noreferrer">{short(c.address)}</a></dd>
      </dl>
      <p className="cb-fine cb-warn">Mock accrual is admin-funded test USDC, not market yield. The deterministic seed is not secure randomness. Amounts may fall in the shortfall path; no principal, yield, or profit is guaranteed.</p>
      <div className="cb-row">
        {c.state === "Open" && !closed && <>
          <label className="cb-field"><span>Deposit (USDC)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <button className="cb-btn cb-btn--primary" disabled={!!busy || c.shortfall} onClick={() => void transact("Deposit", async () => depositLossless(c, me ?? "", parseUsdc(amount), wallet))}>{busy === "Deposit" ? "Depositing…" : "Enter draw"}</button>
        </>}
        {admin != null && admin === me && c.state === "Open" && !closed && <>
          <button className="cb-btn cb-btn--ghost" disabled={!!busy} onClick={() => void transact("Mock accrual", () => mockAccrueLossless(c, admin, 1_000_000n, wallet))}>{busy === "Mock accrual" ? "Funding…" : "+1 USDC mock accrual"}</button>
          <button className="cb-btn cb-btn--ghost" disabled={!!busy || c.mockValue < 250_000n} onClick={() => void transact("Mock loss", () => mockLossLossless(c, admin, 250_000n, wallet))}>Simulate 0.25 USDC loss</button>
        </>}
        {c.state === "Open" && <button className="cb-btn cb-btn--ghost" disabled={!!busy || c.shortfall} onClick={() => void transact("Harvest", () => harvestLossless(c, wallet))}>{busy === "Harvest" ? "Harvesting…" : "Harvest mock accrual"}</button>}
        {c.state === "Open" && closed && c.shares > 0n && <button className="cb-btn cb-btn--primary" disabled={!!busy || c.shortfall || c.mockValue !== c.principal} onClick={() => void transact("Commit", () => commitLossless(c, SEED, wallet))}>{busy === "Commit" ? "Committing…" : "Commit test draw"}</button>}
        {c.state === "Open" && closed && <button className="cb-btn cb-btn--ghost" disabled={!!busy} onClick={() => void transact("Cancel", () => cancelLossless(c, wallet))}>Cancel closed round</button>}
        {c.state === "DrawCommitted" && <button className="cb-btn cb-btn--primary" disabled={!!busy} onClick={() => void transact("Reveal and settle", () => settleLossless(c, wallet))}>{busy === "Reveal and settle" ? "Revealing…" : "Reveal & settle test draw"}</button>}
        {c.state === "DrawCommitted" && <button className="cb-btn cb-btn--ghost" disabled={!!busy || Date.now() / 1000 <= c.commitTs + 3600} onClick={() => void transact("Cancel", () => cancelLossless(c, wallet))}>Cancel after 1h timeout</button>}
        {canWithdraw && <button className="cb-btn cb-btn--primary" disabled={!!busy} onClick={() => void transact("Withdraw", () => withdrawLossless(c, me ?? "", wallet))}>{busy === "Withdraw" ? "Withdrawing…" : "Withdraw remaining mock USDC"}</button>}
        {!me && (c.state === "Open" || c.shortfall || c.state === "Settled" || c.state === "Cancelled") && <button className="cb-btn cb-btn--ghost" onClick={openWallet}>Connect wallet to view your position</button>}
      </div>
      {c.state === "DrawCommitted" && <p className="cb-muted" aria-live="polite">Anticipation: the snapshot is fixed. Reveal the stored mock seed to see which share range wins.</p>}
      {notice && <p className="cb-muted" role="status">{notice}</p>}
      {error != null && <Err e={error} />}
    </article>
  );
}

export function LosslessLanding() {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const { data, error, loading } = useAsync(discoverLosslessCampaigns, [revision]);
  const { data: config, error: configError } = useAsync(fetchLosslessConfig, [revision]);
  const { publicKey } = useWallet();
  return (
    <div data-theme="light" className="cb-programme">
      <a className="cb-link" href="#/">← SOL raffle</a>
      <p className="cb-eyebrow">Separate product · devnet USDC prototype</p>
      <h1>Cryptoball Lossless V1</h1>
      <p className="cb-sub">A mock-first deposit-and-draw experiment, separate from the SOL raffle. No real lending adapter and no guarantee of principal, yield, or profit.</p>
      <dl className="cb-sum">
        <dt>Network</dt><dd>Solana devnet only</dd>
        <dt>Program</dt><dd><a className="cb-addr" href={explorer("address", LOSSLESS_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">{LOSSLESS_PROGRAM_ID.toBase58()}</a></dd>
        <dt>Asset</dt><dd>Devnet USDC test asset · six decimals</dd>
        <dt>Mint</dt><dd><a className="cb-addr" href={explorer("address", LOSSLESS_USDC_MINT.toBase58())} target="_blank" rel="noreferrer">{LOSSLESS_USDC_MINT.toBase58()}</a></dd>
        <dt>Adapter</dt><dd>Admin-funded deterministic mock; no lending venue</dd>
        <dt>Draw</dt><dd>Caller-supplied deterministic test seed; not secure randomness</dd>
        {config && <><dt>Mock admin</dt><dd className="cb-addr">{short(config.admin)}{publicKey?.toBase58() === config.admin ? " · connected" : ""}</dd><dt>Mock fee</dt><dd>{config.feeBps / 100}% of tracked accrual</dd></>}
      </dl>
      {(error != null || configError != null) && <Err e={error ?? configError} />}
      <section aria-labelledby="lossless-campaigns">
        <h2 id="lossless-campaigns">Campaigns · enter, wait, reveal</h2>
        {loading && <p className="cb-muted" aria-live="polite">Discovering accounts for the separate lossless-v1 program…</p>}
        {!!data?.truncated && <p className="cb-warn">Showing the 100 most recent of {data.found} lossless-v1 campaigns.</p>}
        {!!data?.campaigns.length && <div className="cb-grid">{data.campaigns.map((c) => <LosslessCampaignCard key={c.address} c={c} admin={config?.admin} slot={data.slot} revision={revision} refresh={refresh} />)}</div>}
        {!loading && !error && !data?.campaigns.length && <p className="cb-muted">No lossless-v1 campaigns are seeded yet. Use the devnet operator script to create the pinned mock campaign.</p>}
      </section>
      <p className="cb-muted cb-fine">Odds are displayed as your eligible share of the snapshotted test shares; they are not a promise of winning. A shortfall distributes only the remaining mock assets pro rata. Replay starts with a new campaign: finished accounts remain as receipts.</p>
      <p><a className="cb-btn cb-btn--ghost" href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Get devnet test USDC</a> <button className="cb-btn cb-btn--ghost" onClick={refresh}>Refresh campaign state</button></p>
    </div>
  );
}
