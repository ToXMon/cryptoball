import { dateTime, explorer, short, useAsync } from "./lib";
import { discoverLosslessCampaigns, LOSSLESS_PROGRAM_ID, LOSSLESS_USDC_MINT, usdc } from "./lossless";
import { Err } from "./components";

export function LosslessLanding() {
  const { data, error, loading } = useAsync(discoverLosslessCampaigns, []);
  return (
    <div data-theme="light" className="cb-programme">
      <a className="cb-link" href="#/">← SOL raffle</a>
      <p className="cb-eyebrow">Separate product · devnet USDC prototype</p>
      <h1>Cryptoball Lossless V1</h1>
      <p className="cb-sub">Mock-adapter prototype only. This is not the SOL raffle and does not promise principal safety, yield, or profit.</p>
      <dl className="cb-sum">
        <dt>Network</dt><dd>Solana devnet only</dd>
        <dt>Program</dt><dd><a className="cb-addr" href={explorer("address", LOSSLESS_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">{LOSSLESS_PROGRAM_ID.toBase58()}</a></dd>
        <dt>Asset</dt><dd>Devnet USDC test asset · six decimals</dd>
        <dt>Mint</dt><dd><a className="cb-addr" href={explorer("address", LOSSLESS_USDC_MINT.toBase58())} target="_blank" rel="noreferrer">{LOSSLESS_USDC_MINT.toBase58()}</a></dd>
        <dt>Adapter</dt><dd>Admin-funded deterministic mock; no lending venue</dd>
        <dt>Draw</dt><dd>Caller-supplied deterministic test seed; not secure randomness</dd>
      </dl>
      <section aria-labelledby="lossless-campaigns">
        <h2 id="lossless-campaigns">Lossless V1 campaigns</h2>
        {loading && <p className="cb-muted" aria-live="polite">Discovering accounts for the lossless-v1 program…</p>}
        {error != null && <Err e={error} />}
        {!!data?.truncated && <p className="cb-warn">Showing the 100 most recent of {data.found} lossless-v1 campaigns.</p>}
        {!!data?.campaigns.length && <div className="cb-grid">{data.campaigns.map((c) => (
          <article className="cb-card" key={c.address}>
            <p className="cb-eyebrow">Campaign #{c.id.toString()}</p>
            <h3>{c.shortfall ? "Shortfall" : c.state}</h3>
            <dl className="cb-sum">
              <dt>Principal ledger</dt><dd className="cb-num">{usdc(c.principal)}</dd>
              <dt>Mock value</dt><dd className="cb-num">{usdc(c.mockValue)}</dd>
              <dt>Prize ledger</dt><dd className="cb-num">{usdc(c.prize)}</dd>
              <dt>Shares / positions</dt><dd className="cb-num">{usdc(c.shares)} / {c.positions} of {c.maxPositions}</dd>
              <dt>Closes</dt><dd>{dateTime(c.closeTs)}</dd>
              <dt>Account</dt><dd><a className="cb-addr" href={explorer("address", c.address)} target="_blank" rel="noreferrer">{short(c.address)}</a></dd>
            </dl>
          </article>
        ))}</div>}
        {!loading && !error && !data?.campaigns.length && <p className="cb-muted">No campaign accounts found for this separate program ID.</p>}
      </section>
      <p className="cb-muted cb-fine">For devnet testing only. Mock accrual is not market yield. No sponsor funds, token, points, governance, or real adapter are enabled.</p>
    </div>
  );
}
