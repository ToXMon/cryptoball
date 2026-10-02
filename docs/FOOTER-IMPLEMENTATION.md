# Cryptoball Footer: Verifiable Randomness Implementation Guide

**Phase:** 3 (MVP)  
**Effort:** ~1–2 days frontend + ~1 day keeper/program coordination  
**Owner:** Frontend lead + Keeper ops  

---

## 1. Footer Section HTML/CSS (Phase 3)

Add to `app/src/pages.tsx` or `app/src/components.tsx`:

```typescript
export function Footer() {
  return (
    <footer className="cb-footer">
      <section className="cb-footer-fairness">
        <h3 className="cb-footer-title">
          <span className="cb-icon" role="img" aria-label="Fair draw">🎲</span>
          {' '}Verifiable Randomness
        </h3>
        
        <p className="cb-footer-text">
          Each Cryptoball draw uses{' '}
          <a 
            href="https://docs.switchboard.xyz/" 
            target="_blank" 
            rel="noopener noreferrer"
          >
            Switchboard On-Demand VRF
          </a>
          . The winner is randomly selected and automatically paid on-chain.
        </p>

        <details className="cb-footer-details">
          <summary>Why this is fair (expand)</summary>
          <div className="cb-footer-details-content">
            <ol>
              <li>
                <strong>Before sales close:</strong> A random commitment is stored on-chain.
              </li>
              <li>
                <strong>At settlement:</strong> The random value is revealed on-chain.
              </li>
              <li>
                <strong>Winner selected:</strong> One ticket is picked using that value.
              </li>
              <li>
                <strong>Paid automatically:</strong> Prize is transferred in the same transaction.
              </li>
            </ol>
            <p className="cb-footer-details-proof">
              <a href="#/how-it-works">Read the full explainer</a> or{' '}
              <a href="https://docs.switchboard.xyz/">learn about VRF</a>.
            </p>
          </div>
        </details>

        <nav className="cb-footer-links">
          <a href="#/latest-draws" className="cb-footer-link">
            <span className="cb-icon">📋</span> View verified draws
          </a>
          <a href="#/how-it-works" className="cb-footer-link">
            <span className="cb-icon">📖</span> How it works
          </a>
        </nav>

        <p className="cb-footer-note">
          <em>
            Devnet ({process.env.REACT_APP_CLUSTER === 'devnet' ? '✓ play money' : 'mainnet'})
            {' '}•{' '}
            <a href="https://github.com/cryptoball/programs/blob/main/programs/cryptoball/src/winner.rs">
              View winner code
            </a>
          </em>
        </p>
      </section>
    </footer>
  );
}
```

**CSS** (add to `app/src/tokens.css` or `app/src/index.css`):

```css
.cb-footer {
  border-top: 1px solid var(--color-border);
  margin-top: 4rem;
  padding: 2rem 1rem;
  background-color: var(--color-surface-secondary);
  color: var(--color-text-secondary);
}

.cb-footer-fairness {
  max-width: 60ch;
  margin: 0 auto;
  font-size: 0.875rem;
  line-height: 1.5;
}

.cb-footer-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
  color: var(--color-text);
}

.cb-icon {
  display: inline-block;
  margin-right: 0.25em;
}

.cb-footer-text {
  margin: 0 0 1rem;
}

.cb-footer-text a {
  color: var(--color-primary);
  text-decoration: underline;
}

.cb-footer-details {
  margin: 1rem 0;
  padding: 0.75rem;
  background-color: var(--color-surface);
  border-radius: 0.375rem;
  border-left: 3px solid var(--color-primary);
}

.cb-footer-details summary {
  cursor: pointer;
  font-weight: 500;
  color: var(--color-text);
}

.cb-footer-details summary:hover {
  color: var(--color-primary);
}

.cb-footer-details-content {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.cb-footer-details-content ol {
  margin: 0 0 0.75rem;
  padding-left: 1.5rem;
}

.cb-footer-details-content li {
  margin: 0.5rem 0;
}

.cb-footer-details-proof {
  margin: 0;
  font-size: 0.8125rem;
  opacity: 0.85;
}

.cb-footer-links {
  display: flex;
  gap: 1rem;
  margin: 1rem 0;
  flex-wrap: wrap;
}

.cb-footer-link {
  display: inline-flex;
  align-items: center;
  gap: 0.375em;
  padding: 0.5rem 0.75rem;
  background-color: var(--color-button-ghost-bg);
  border: 1px solid var(--color-button-ghost-border);
  border-radius: 0.375rem;
  color: var(--color-primary);
  text-decoration: none;
  font-size: 0.8125rem;
  font-weight: 500;
  transition: all 200ms;
}

.cb-footer-link:hover {
  background-color: var(--color-button-ghost-bg-hover);
  border-color: var(--color-primary);
}

.cb-footer-note {
  margin-top: 1rem;
  font-size: 0.75rem;
  opacity: 0.7;
}

.cb-footer-note a {
  color: inherit;
}

.cb-footer-note a:hover {
  opacity: 1;
  text-decoration: underline;
}

/* Mobile adjustments */
@media (max-width: 640px) {
  .cb-footer {
    padding: 1.5rem 0.75rem;
  }

  .cb-footer-links {
    flex-direction: column;
    gap: 0.5rem;
  }

  .cb-footer-link {
    width: 100%;
    justify-content: center;
  }
}
```

---

## 2. Campaign Results Page Enhancement

Add evidence links to the campaign results component:

```typescript
interface CampaignResultsProps {
  campaignId: number;
}

export function CampaignResults({ campaignId }: CampaignResultsProps) {
  const { data: campaign, loading, error } = useAsync(() => fetchCampaign(campaignId), [campaignId]);
  
  if (loading) return <Loading what="campaign" />;
  if (error || !campaign) return <Err e={error} />;
  if (campaign.state !== "Settled") return <p>Campaign not yet settled.</p>;

  const ticket = useMemo(() => {
    // Fetch the winning ticket (use campaign.winning_index to derive PDA)
    return fetchTicket(campaignId, campaign.winning_index);
  }, [campaignId, campaign.winning_index]);

  const explorerUrl = (txHash: string) => 
    `https://explorer.solana.com/tx/${txHash}?cluster=${process.env.REACT_APP_CLUSTER || 'devnet'}`;

  const randomnessExplorerUrl = () =>
    `https://explorer.solana.com/account/${campaign.rand_account}?cluster=${process.env.REACT_APP_CLUSTER || 'devnet'}`;

  return (
    <section className="cb-results">
      <h1>Draw #{campaign.id} Results</h1>

      {/* Winner section */}
      <article className="cb-card">
        <h2>🏆 Winner</h2>
        {ticket && (
          <>
            <p><strong>Ticket:</strong> #{campaign.winning_index}</p>
            <p><strong>Numbers:</strong> {ticket.numbers.map(pad).join(', ')} + {pad(ticket.bonus)}</p>
            <p><strong>Owner:</strong> {short(campaign.winner)}</p>
            <p><strong>Prize:</strong> {sol(campaign.prize)} SOL</p>
          </>
        )}
      </article>

      {/* Evidence section */}
      <article className="cb-card">
        <h2>📋 Verify the Draw</h2>
        <p className="cb-muted">
          The winner was selected using Switchboard's randomness and verified on-chain.
          You can check the commitment, reveal, and settlement transactions below.
        </p>
        
        <details className="cb-evidence-block">
          <summary>
            <span className="cb-icon">📌</span>
            Randomness commitment
          </summary>
          <div className="cb-evidence-detail">
            <p>
              <strong>Account:</strong>{' '}
              <code>{campaign.rand_account}</code>{' '}
              <a href={randomnessExplorerUrl()} target="_blank" rel="noopener noreferrer">
                [Solana Explorer]
              </a>
            </p>
            <p>
              <strong>Seed slot:</strong> {campaign.seed_slot}
            </p>
            <p>
              <strong>Committed at:</strong> {dateTime(campaign.committed_at * 1000)}
            </p>
            <p className="cb-muted cb-fine">
              This proves a random value was committed before sales closed.
            </p>
          </div>
        </details>

        <details className="cb-evidence-block">
          <summary>
            <span className="cb-icon">✅</span>
            Randomness revealed & settlement
          </summary>
          <div className="cb-evidence-detail">
            <p>
              <strong>Revealed value:</strong>{' '}
              <code className="cb-mono">{campaign.randomness.slice(0, 16)}...</code>
            </p>
            <p>
              <strong>Winning index:</strong> {campaign.winning_index} (deterministic from randomness)
            </p>
            <p className="cb-muted cb-fine">
              The revealed value determines the winner. The index matches ticket #{campaign.winning_index}.
            </p>
          </div>
        </details>

        <nav className="cb-evidence-links">
          <a 
            href={explorerUrl(campaign.settlement_tx || '#')} 
            className="cb-link"
            target="_blank" 
            rel="noopener noreferrer"
          >
            Settlement transaction ↗
          </a>
          <a href={`#/verify/${campaignId}`} className="cb-link">
            Verify locally
          </a>
          <a 
            href="https://docs.switchboard.xyz/" 
            className="cb-link"
            target="_blank" 
            rel="noopener noreferrer"
          >
            About Switchboard VRF ↗
          </a>
        </nav>
      </article>
    </section>
  );
}
```

**CSS:**

```css
.cb-results {
  max-width: 800px;
  margin: 2rem auto;
}

.cb-evidence-block {
  margin: 1rem 0;
  padding: 1rem;
  background-color: var(--color-surface-secondary);
  border-radius: 0.375rem;
  border-left: 3px solid var(--color-primary);
}

.cb-evidence-block summary {
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.5em;
}

.cb-evidence-block summary:hover {
  color: var(--color-primary);
}

.cb-evidence-detail {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.cb-evidence-detail p {
  margin: 0.5rem 0;
  font-size: 0.875rem;
}

.cb-mono {
  font-family: 'Courier New', monospace;
  background-color: var(--color-surface);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
}

.cb-evidence-links {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

.cb-evidence-links .cb-link {
  font-size: 0.875rem;
  color: var(--color-primary);
  text-decoration: underline;
}
```

---

## 3. Keeper Integration: Store Tx Hashes (Phase 3)

Update the keeper to emit/log transaction hashes for later UI use:

```typescript
// keeper/src/settle-draw.ts
import { Connection, Transaction, Keypair, PublicKey } from "@solana/web3.js";
import { SwitchboardProgram } from "@switchboard-xyz/on-demand";

async function settleDrawWithEvidence(
  connection: Connection,
  campaign: PublicKey,
  randomnessAccount: PublicKey,
  ticketIndex: number,
  keeperKeypair: Keypair,
  programId: PublicKey,
): Promise<{
  commitmentTxHash?: string;
  settlementTxHash: string;
  randomnessAccount: string;
  revealed: string;
  winner: string;
}> {
  // Assume commitment already happened in a previous tx
  // This tx does reveal + settle_draw

  const sb = new SwitchboardProgram(
    connection,
    new Keypair(), // dummy; we only use it for structure
    programId,
  );

  // Build the reveal instruction (Switchboard)
  const revealIx = await sb.createRevealInstruction({
    randomnessAccount,
  });

  // Build our settle_draw instruction
  const settleDrawIx = await program.methods
    .settleDraw()
    .accounts({
      campaign,
      randomness: randomnessAccount,
      // ... other accounts
    })
    .instruction();

  // Build combined tx
  const tx = new Transaction().add(revealIx, settleDrawIx);
  tx.feePayer = keeperKeypair.publicKey;

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = 
    await connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = blockhash;

  // Sign and send
  tx.sign(keeperKeypair);
  const settlementTxHash = await connection.sendRawTransaction(tx.serialize());

  // Confirm
  await connection.confirmTransaction(
    {
      signature: settlementTxHash,
      blockhash,
      lastValidBlockHeight,
    },
    "finalized",
  );

  // Fetch the settled campaign to get the winner
  const settledCampaign = await program.account.campaign.fetch(campaign);

  // Log evidence for UI consumption
  const evidence = {
    commitmentTxHash: process.env.COMMITMENT_TX_HASH || undefined,
    settlementTxHash,
    randomnessAccount: randomnessAccount.toBase58(),
    revealed: Array.from(settledCampaign.randomness)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(''),
    winner: settledCampaign.winner.toBase58(),
  };

  console.log("✓ Draw settled with evidence:", evidence);
  
  // Store in a way your indexer can pick up (e.g., emit event, write to DB)
  // For now, just return it
  return evidence;
}
```

---

## 4. Campaign Indexer Update (Phase 3)

If you have an indexer (or will add one), store the tx hashes:

```typescript
// indexer/src/parse-settlement.ts
interface DrawEvidence {
  campaignId: number;
  settlementTxHash: string;
  randomnessAccount: string;
  revealed: string;
  winner: string;
  settledAt: Date;
}

async function indexDrawSettlement(
  tx: Transaction,
  campaignId: number,
): Promise<DrawEvidence | null> {
  // Parse the settlement tx
  const settleInstruction = tx.instructions.find(
    (ix) => ix.programId.equals(CRYPTOBALL_PROGRAM_ID)
      && ix.data[0] === 8, // settle_draw instruction code
  );

  if (!settleInstruction) return null;

  // Fetch the campaign account to get the evidence
  const campaign = await connection.getAccountInfo(campaignPda);
  const parsed = program.coder.accounts.decode("Campaign", campaign.data);

  return {
    campaignId,
    settlementTxHash: tx.transaction.signatures[0],
    randomnessAccount: parsed.randAccount.toBase58(),
    revealed: Buffer.from(parsed.randomness).toString('hex'),
    winner: parsed.winner.toBase58(),
    settledAt: new Date(),
  };
}
```

---

## 5. "How It Works" Page (Phase 3)

Add or enhance the explainer:

```typescript
export function HowItWorks() {
  return (
    <article className="cb-article">
      <h1>How Cryptoball Works</h1>

      <section>
        <h2>🎲 Why the draw is fair</h2>
        <p>
          Cryptoball uses <a href="https://switchboard.xyz/">Switchboard On-Demand VRF</a> (Verifiable Random Function).
          Here's the sequence:
        </p>
        <ol>
          <li>
            <strong>Sales close:</strong> After the timer hits zero, no more tickets can be bought.
          </li>
          <li>
            <strong>Commitment:</strong> Anyone (keeper, bot, or user) requests a random number from Switchboard.
            Switchboard stores a <em>commitment</em> to that number on-chain.
          </li>
          <li>
            <strong>Reveal:</strong> Switchboard reveals the actual random number on-chain, still locked by its commitment.
          </li>
          <li>
            <strong>Settlement:</strong> Our program reads the revealed number and deterministically picks one winning ticket.
            The winner is paid in the same transaction.
          </li>
        </ol>
        <p>
          Once the result is in a Solana block, it's <em>permanent</em> and <em>immutable</em>.
          No changes, no retroactive adjustments.
        </p>
      </section>

      <section>
        <h2>🔗 You can verify this</h2>
        <p>
          After each draw, you can:
        </p>
        <ul>
          <li>Check the Switchboard commitment (before sales closed)</li>
          <li>Check the revealed value (posted at settlement)</li>
          <li>Compute the winning ticket index yourself</li>
          <li>Confirm the winner was paid</li>
        </ul>
        <p>
          All of this is readable from{' '}
          <a href="https://explorer.solana.com/" target="_blank">
            Solana Explorer
          </a>
          . No special tools needed.
        </p>
      </section>

      <section>
        <h2>🏆 How winners are picked</h2>
        <p>
          Our <a href="https://github.com/cryptoball/programs/blob/main/src/winner.rs">
            winner selection code
          </a>{' '}
          is simple and deterministic:
        </p>
        <pre><code>{`winning_index = revealed_random_value % ticket_count

// Example:
// revealed = 0x1a2b3c... (32 bytes, as u128: 12345)
// ticket_count = 100
// winning_index = 12345 % 100 = 45

// Ticket #45 wins.`}</code></pre>
        <p>
          This is the only logic that matters. It cannot be changed mid-draw.
        </p>
      </section>

      <section>
        <h2>🎫 Your ticket is an NFT</h2>
        <p>
          When you buy a ticket, we mint a <a href="https://metaplex.com/">Metaplex Core</a> NFT and send it to your wallet.
        </p>
        <ul>
          <li>You own it (private key in your wallet)</li>
          <li>You can transfer it to someone else</li>
          <li>It's a real asset on Solana, not just a receipt</li>
          <li>The numbers you picked are stored on the NFT (and on-chain) forever</li>
        </ul>
      </section>

      <section>
        <h2>💰 Automatic payout</h2>
        <p>
          If your ticket wins:
        </p>
        <ol>
          <li>The program computes the winner</li>
          <li>10% of the pool goes to the treasury (operational costs)</li>
          <li>90% goes to your wallet</li>
          <li>All in the same transaction, no claim step</li>
        </ol>
        <p>
          You don't have to do anything. You just receive the prize.
        </p>
      </section>

      <section>
        <h2>📊 Devnet vs Mainnet</h2>
        <table>
          <tr>
            <th>Aspect</th>
            <th>Devnet</th>
            <th>Mainnet (future)</th>
          </tr>
          <tr>
            <td>Real money</td>
            <td>No (play money)</td>
            <td>Yes (SOL)</td>
          </tr>
          <tr>
            <td>Finality</td>
            <td>None (can reorg)</td>
            <td>32 slots (~13 sec)</td>
          </tr>
          <tr>
            <td>Verifiable</td>
            <td>Yes (with RPC node)</td>
            <td>Yes (anyone)</td>
          </tr>
          <tr>
            <td>Switchboard TEE</td>
            <td>Available</td>
            <td>Available + Attestation</td>
          </tr>
        </table>
      </section>

      <section>
        <h2>🔗 Links</h2>
        <ul>
          <li>
            <a href="https://docs.switchboard.xyz/">
              Switchboard VRF Documentation
            </a>
          </li>
          <li>
            <a href="https://github.com/cryptoball">
              Cryptoball Source Code
            </a>
          </li>
          <li>
            <a href="https://explorer.solana.com/" target="_blank">
              Solana Explorer (view any transaction)
            </a>
          </li>
          <li>
            <a href="#/latest-draws">
              See verified draws
            </a>
          </li>
        </ul>
      </section>
    </article>
  );
}
```

---

## 6. Latest Draws Component (Phase 4)

A page showing recent settled draws with evidence:

```typescript
export function LatestDraws() {
  const { data: campaigns, loading, error } = useAsync(
    async () => {
      const all = await fetchCampaigns();
      return all
        .filter((c) => c.state === "Settled")
        .sort((a, b) => b.settledAt - a.settledAt)
        .slice(0, 10);
    },
    [],
  );

  return (
    <section>
      <h2>Recent Verified Draws</h2>
      {loading && <Loading what="draws" />}
      {error && <Err e={error} />}
      <ul className="cb-draws-list">
        {campaigns?.map((c) => (
          <li key={c.id} className="cb-draw-card">
            <a href={`#/results/${c.id}`}>
              <span className="cb-draw-id">Draw #{c.id}</span>
              <span className="cb-draw-winner">
                Ticket #{c.winning_index} won {sol(c.prize)}
              </span>
              <span className="cb-draw-date">
                {dateTime(c.settledAt)}
              </span>
              <span className="cb-icon">→</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

---

## 7. Styling: Tokens to Add (Phase 3)

In `app/src/tokens.css`, add:

```css
:root {
  /* ... existing tokens ... */

  /* Footer / fairness */
  --color-surface-secondary: rgb(248, 248, 250);
  --color-button-ghost-bg: transparent;
  --color-button-ghost-border: rgb(200, 200, 210);
  --color-button-ghost-bg-hover: rgb(248, 248, 250);
}

html.dark {
  --color-surface-secondary: rgb(30, 30, 40);
  --color-button-ghost-border: rgb(80, 80, 100);
  --color-button-ghost-bg-hover: rgb(40, 40, 55);
}
```

---

## 8. Integration Checklist

**Program-side (Phase 3):**
- [ ] Emit `SettledDraw` event with all evidence data
- [ ] Store `settlement_tx_hash` or ensure keeper logs it
- [ ] Confirm `winner.rs` is testable and deterministic

**Frontend-side (Phase 3):**
- [ ] Add footer section with fairness claim
- [ ] Add evidence block to results page
- [ ] Add "How It Works" page with verification info
- [ ] Link all txs to Solana Explorer

**Keeper-side (Phase 3):**
- [ ] Log commitment and settlement tx hashes
- [ ] Pass evidence data to indexer or UI API

**Indexer-side (Phase 3):**
- [ ] Store evidence data per settled draw
- [ ] Expose via API for UI consumption

**Phase 4 (optional, enhanced verification):**
- [ ] Add `/verify/{campaignId}` page
- [ ] Fetch on-chain data, verify locally
- [ ] Add "Latest Draws" showcase
- [ ] Run distribution tests

---

## 9. Testing

**Manual (Phase 3):**
1. Deploy program to devnet
2. Create a campaign, buy tickets
3. Wait for close time + commit
4. Reveal and settle
5. Check footer, results page, evidence links
6. Click through to Solana Explorer

**Automated (Phase 4):**
```typescript
describe("Verifiable Randomness", () => {
  it("settles a draw with evidence", async () => {
    // ... setup, create campaign, buy tickets ...

    // Commit
    const commitTx = await settleDrawWithEvidence(
      connection,
      campaignPda,
      randomnessPda,
      0, // winning index
      keeper,
      PROGRAM_ID,
    );

    // Verify commitment stored
    const campaign = await program.account.campaign.fetch(campaignPda);
    expect(campaign.randomness).toContain(Buffer.from(...));
    expect(campaign.winning_index).toEqual(0);
    expect(campaign.winner).toEqual(winnerWallet.publicKey);

    // Verify on-chain
    const verified = await verifyDraw(campaignId);
    expect(verified).toBe(true);
  });
});
```

---

## Summary

| Item | Phase | Effort | Owner |
|------|-------|--------|-------|
| Footer section | 3 | 2h | Frontend |
| Results page evidence | 3 | 2h | Frontend |
| How It Works page | 3 | 3h | Frontend + Copy |
| Keeper tx logging | 3 | 1h | Keeper ops |
| Verification page | 4 | 4h | Frontend |
| Latest draws page | 4 | 2h | Frontend |
| Automated tests | 4 | 3h | QA |

**Phase 3 total:** ~8 hours frontend + 1 hour ops = **1 working day**.
