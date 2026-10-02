# Cryptoball Fairness Claims & Evidence Requirements

**Purpose:** Define what Cryptoball can claim in marketing, on the landing page, and in documentation—and the precise evidence that must back each claim.

**Audience:** Marketing, legal, engineering, users.

**Status:** Framework for Phase 3+ (evidence infrastructure and linking).

---

## Part 1: Approved Claims Matrix

Each row: Claim → Conditions → Evidence → Who verifies

### Claim 1: "Draw winner is randomly selected"

| Field | Content |
|-------|---------|
| **Claim** | "One ticket is randomly selected to win." |
| **Conditions** | Draw is in Settled state; ticket_count > 0; randomness value is non-zero |
| **Switchboard enabled?** | YES (randomness from VRF) |
| **Evidence required** | Settlement tx showing the exact randomness value + computed winning index |
| **Evidence source** | Campaign account (onchain) shows: `randomness: [u8; 32]`, `winning_index: u32` |
| **Who verifies** | User with Solana RPC node (or trusts an indexer) |
| **Confidence level** | Cryptographic (once in block) |
| **Mainnet / Devnet** | Both ✓ |
| **Footer text** | "🎲 Winner randomly selected (Switchboard VRF)" |

### Claim 2: "Randomness is verifiable on-chain"

| Field | Content |
|-------|---------|
| **Claim** | "Anyone can verify the randomness value used to pick the winner by reading Solana's ledger." |
| **Conditions** | Campaign is Settled; Switchboard randomness account is still readable (should be permanent) |
| **Switchboard enabled?** | YES (commitment + reveal on-chain) |
| **Evidence required** | 1. Commitment tx (before close_ts), 2. Reveal tx (in settlement block), 3. Randomness account data (commitment hash + revealed value) |
| **Evidence source** | Solana Explorer (account data), transaction history |
| **Who verifies** | Any chain observer; no special tools needed |
| **Confidence level** | Cryptographic + historical (immutable ledger) |
| **Mainnet / Devnet** | Mainnet: yes (32-slot finality). Devnet: yes but reorg-able. |
| **Footer text** | "[📋 Verify this draw](link to commitment + reveal txs in Explorer)" |

### Claim 3: "No retroactive changes to the draw"

| Field | Content |
|-------|---------|
| **Claim** | "Once the winner is settled on-chain, the result cannot be changed." |
| **Conditions** | Campaign is Settled (not Open, not DrawCommitted, not Cancelled) |
| **Switchboard enabled?** | YES (settlement is atomic, immutable once in block) |
| **Evidence required** | Campaign account history shows state transition: Open → DrawCommitted → Settled (no revert) |
| **Evidence source** | Solana transaction history; campaign state machine guards |
| **Who verifies** | Any auditor reading the block history |
| **Confidence level** | Cryptographic (account mutations logged in tx hash) |
| **Mainnet / Devnet** | Mainnet: strong (32-slot finality). Devnet: weak (reorgable). |
| **Footer text** | "Outcome immutable once settled." |

### Claim 4: "Automatic payout; no claim step needed"

| Field | Content |
|-------|---------|
| **Claim** | "The winner receives their prize immediately in the same transaction as settlement—no separate claim instruction." |
| **Conditions** | Settle_draw executes successfully; two PDA-signed system transfers complete (fee to treasury, prize to winner) |
| **Switchboard enabled?** | INDEPENDENT (Switchboard VRF only randomness provider; payout is Cryptoball logic) |
| **Evidence required** | Settlement tx showing two transfers: fee → treasury, prize → winner.key() |
| **Evidence source** | Solana Explorer; transaction receipt showing effects |
| **Who verifies** | User sees SOL appear in wallet; transaction explorer confirms amount |
| **Confidence level** | Immediate (on-chain settlement) |
| **Mainnet / Devnet** | Both ✓ |
| **Footer text** | "✓ Paid instantly. No claim needed." |

### Claim 5: "Your ticket is an NFT in your wallet"

| Field | Content |
|-------|---------|
| **Claim** | "Each ticket is a Metaplex Core asset. You own it; you can transfer it; it's a real NFT." |
| **Conditions** | Ticket is in Active state; Core asset exists on-chain with owner = buyer |
| **Switchboard enabled?** | INDEPENDENT |
| **Evidence required** | Ticket NFT in wallet; metadata (numbers, bonus) visible in wallet or on Metaplex Explorer |
| **Evidence source** | Wallet software (Magic Eden, Phantom, etc.); Metaplex Core explorer |
| **Who verifies** | User's wallet client |
| **Confidence level** | Direct (user has private key, can transfer) |
| **Mainnet / Devnet** | Both ✓ |
| **Footer text** | "🎫 Tickets are NFTs." |

### Claim 6: "You can verify the result"

| Field | Content |
|-------|---------|
| **Claim** | "After the draw settles, you can independently verify that the right ticket won and was paid correctly." |
| **Conditions** | Draw is Settled; verification page or Explorer data is accessible |
| **Switchboard enabled?** | YES (commitment + reveal chain verifiable) |
| **Evidence required** | 1. Known vector test (commitment + reveal → index), 2. Campaign account (stored index + winner), 3. Ticket account (buyer = winner), 4. Treasury balance (fee received) |
| **Evidence source** | Our verification page (if Phase 4); manual calculation with Explorer |
| **Who verifies** | Power users, auditors; anyone willing to query Solana RPC |
| **Confidence level** | Cryptographic (with effort) |
| **Mainnet / Devnet** | Mainnet: yes. Devnet: yes but requires RPC node. |
| **Footer text** | "[See code] [Run verification]" (links to GitHub + verification page) |

---

## Part 2: Claims NOT Approved

### ✗ Claim: "Cryptographically proven fair by mathematics alone"

**Why not:**
- Switchboard uses a TEE, not a zero-knowledge proof or cryptographic protocol
- The TEE's internals are black-box (to users; transparent to Switchboard's infra)
- Fairness relies on trust in Switchboard's hardware, not pure math
- On devnet, there is no TEE attestation at all

**Alternative phrasing:**
- ✓ "Randomness is generated by Switchboard's trusted hardware and posted on-chain"
- ✓ "The value is verifiable on-chain; Switchboard's commitment is irrevocable"

---

### ✗ Claim: "Verified by {N} independent oracles"

**Why not:**
- Switchboard On-Demand uses a single TEE instance per draw
- There is no oracle consensus
- Multiple oracles would be Switchboard's "oracle network" product, not "On-Demand"

**Alternative phrasing:**
- ✓ "Randomness from Switchboard's On-Demand VRF service"
- ✓ "Commitment + reveal verified on Solana's blockchain"

---

### ✗ Claim: "Winners are mathematically impossible to predict in advance"

**Why not:**
- Technically true, but misleading
- It implies Switchboard couldn't predict either (maybe not true—only Switchboard knows)
- On devnet, there's no attestation proving the value was random

**Alternative phrasing:**
- ✓ "Winners are determined by randomness committed before the draw closes"
- ✓ "The winning ticket is selected from the randomness value, same transaction"

---

### ✗ Claim: "Devnet draw results are final and immutable"

**Why not:**
- Devnet has no finality; blocks reorg constantly
- Results are immutable only in the sense of Anchor's state machine, not Solana's consensus

**Alternative phrasing for Devnet:**
- ✓ "Devnet—play money draw using the same system as mainnet"
- ✓ "Results are test-net only and may be reset"

**Alternative phrasing for Mainnet:**
- ✓ "Results are final after 32 slots (~13 seconds) on mainnet Solana"

---

### ✗ Claim: "Switchboard guarantees the draw will settle"

**Why not:**
- Switchboard can go down
- Our keeper can disappear
- The reveal can timeout and the draw gets cancelled

**Alternative phrasing:**
- ✓ "If the reveal times out (e.g., Switchboard is down), anyone can cancel and refund all tickets"
- ✓ "If settlement fails, the draw cancels and funds are returned"

---

## Part 3: Evidence Linking Strategy

### 3.1 Where to Link

**Landing page footer:**
```html
<footer>
  <section>
    <h3>Fair & Verifiable</h3>
    <p>Each draw uses Switchboard VRF + Solana's immutable ledger.</p>
    <p><a href="#/latest-draws">See {N} verified draws</a></p>
    <details>
      <summary>Why this is fair</summary>
      <p>
        Every draw posts a commitment before sales close, reveals on-chain at settlement, 
        and bakes the result into Solana's permanent record. 
        <a href="https://docs.switchboard.xyz">Learn about VRF</a> | 
        <a href="#/how-it-works">Read our explainer</a>
      </p>
    </details>
  </section>
</footer>
```

**Campaign results page:**
```
Draw #42 Results

🏆 Winning ticket: #17
💰 Prize: 9.5 SOL
📋 Winner: solxxxx...yyyy

Evidence:
  [Commitment tx in Explorer](link)
  [Reveal tx in Explorer](link)
  [Settlement tx in Explorer](link)
  [Verify locally](/verify/42)
```

**Dedicated verification page** (`/verify/{campaignId}`):
```
Verify Draw #{id}

Commitment (before close):
  Account: {...}
  Slot: {seed_slot}
  Hash: {commitment_hash}
  Tx: [link]

Revealed (at settlement):
  Value: {32-byte hex}
  Sig: {signature}
  Tx: [link]

Computed winner:
  Hash({value}) % {ticket_count} = {winning_index}
  Ticket #{winning_index}
  Buyer: {buyer}
  Paid: {amount} SOL
  Tx: [link]

Status: ✓ Verified
```

### 3.2 Phase-by-Phase Rollout

**Phase 3 (MVP):**
- [ ] Program emits event with: `rand_account`, `randomness`, `winning_index`, `winner`
- [ ] Keeper logs commitment and settlement tx hashes
- [ ] Frontend stores these per campaign
- [ ] Landing page footer: simple claim + link to latest draw
- [ ] Campaign results: lists txs with Explorer links (manual construction)

**Phase 4 (Enhanced):**
- [ ] Verification page fetches on-chain data, verifies locally
- [ ] Runs `winning_index` function locally, checks against stored index
- [ ] Confirms treasury balance, winner balance
- [ ] Displays full evidence chain with timestamps

**Phase 5 (Mainnet Prep):**
- [ ] Audit landing page language for mainnet accuracy
- [ ] Add TEE attestation verification (if needed)
- [ ] Add finality indicators ("32 slots = final")
- [ ] Link to Switchboard's mainnet program id, docs

---

## Part 4: Switchboard-Specific Evidence Requirements

### 4.1 What Switchboard Provides (On-Chain)

| Data | Where | How to Access |
|------|-------|---------------|
| Commitment hash | Randomness account | `randomness.commitment` (Switchboard struct) |
| Revealed value | Randomness account | `randomness.value` (Switchboard struct) |
| Seed slot | Randomness account | `randomness.seed_slot` |
| TEE signature | Randomness account | `randomness.signature` (prove TEE signed it) |
| Reveal timestamp | Randomness account | `randomness.revealed_at` |

### 4.2 What Cryptoball Must Store & Emit

| Data | Where | Purpose |
|------|-------|---------|
| `rand_account` | Campaign account | Link to Switchboard account |
| `seed_slot` | Campaign account | Verify freshness |
| `committed_at` | Campaign account | Timestamp of commit_draw |
| `randomness` | Campaign account | Exact value used for index calculation |
| `winning_index` | Campaign account | Deterministic result |
| `winner` | Campaign account | Payout recipient |
| Event: SettledDraw | Transaction log | For indexers; contains all above |

### 4.3 Transaction Structure (Required for Evidence Chain)

**Commitment transaction (keeper-built):**
```
Instructions:
  0. Switchboard commit_random (creates randomness account, sets commitment)
Signers:
  Keeper (payer)
Result:
  Randomness account created with commitment hash stored
```

**Settlement transaction (keeper-built, same tx as reveal):**
```
Instructions:
  0. Switchboard reveal_random (posts value to randomness account)
  1. Cryptoball settle_draw (reads value, computes index, pays winner)
Signers:
  Keeper (payer)
Result:
  Randomness account now has revealed value
  Campaign moves to Settled
  Winner receives payout
  Event SettledDraw emitted
```

**Keeper must log both tx hashes** for later linking in UI.

---

## Part 5: Verification Checklist (Per Draw)

After each draw settles, run through this:

- [ ] **Commitment stored:** `campaign.seed_slot` is non-zero; `campaign.rand_account` is set
- [ ] **Reveal happened:** `campaign.randomness` is non-zero (all 32 bytes, not all zeros)
- [ ] **Index computed:** `campaign.winning_index` is in range [0, ticket_count)
- [ ] **Winner is correct:** `campaign.winner == Ticket[winning_index].buyer`
- [ ] **Payout receipted:** Winner wallet shows +{amount} SOL received in same tx as settle_draw
- [ ] **Treasury receipted:** Treasury shows +{fee} SOL
- [ ] **State machine:** Campaign state is Settled (not Open, not DrawCommitted, not Cancelled)
- [ ] **Atomicity:** Commitment, reveal, and settlement all in blockchain history; no gaps
- [ ] **Freshness:** `committed_at` < close_ts < settle_draw timestamp

**Test automation (Phase 4):**
```typescript
async function verifyDraw(campaignId: number) {
  const campaign = await fetchCampaign(campaignId);
  
  if (campaign.state !== "Settled") throw new Error("Not settled");
  if (campaign.randomness.every(b => b === 0)) throw new Error("No randomness");
  if (campaign.winning_index >= campaign.ticket_count) throw new Error("Index out of range");
  
  const ticket = await fetchTicket(campaignId, campaign.winning_index);
  if (ticket.buyer !== campaign.winner) throw new Error("Winner mismatch");
  
  const computedIndex = winningIndex(campaign.randomness, campaign.ticket_count);
  if (computedIndex !== campaign.winning_index) throw new Error("Index mismatch");
  
  console.log("✓ Draw verified");
}
```

---

## Part 6: Legal / Compliance Notes

**Disclaimer to add (Phase 5, if needed):**

```
Cryptoball uses Switchboard On-Demand VRF for randomness. 

Randomness is generated by Switchboard's infrastructure and posted to Solana's blockchain.
We cannot independently audit Switchboard's hardware, but we can verify:
  - The commitment was stored before the draw closed
  - The revealed value was posted on-chain
  - The winner was computed deterministically from that value
  - The payout was made automatically

On devnet, this is play money and subject to chain reorgs.
On mainnet, results are final after 32 slots (~13 seconds).

For detailed information, see [Switchboard docs](https://docs.switchboard.xyz)
and [our architecture](docs/verifiable-randomness-design.md).
```

**What we DON'T claim:**
- ✗ Switchboard's infrastructure is "hack-proof" or "tamper-proof"
- ✗ The randomness is "mathematically proven" (it's TEE-based, not ZK)
- ✗ We can prevent insider abuse (if Switchboard insider wanted to bias draws)
- ✗ The system is "decentralized" (it uses Switchboard's centralized TEE)

**What we DO claim:**
- ✓ The result is verifiable (commitment + reveal on-chain)
- ✓ The result is immutable once settled (Solana's ledger guarantee)
- ✓ The payout is automatic (same transaction)
- ✓ No refusal to settle; no hidden claims

---

## Summary Table: Claims vs. Evidence vs. Implementation

| Claim | Approved? | Evidence | Phase | Footer? |
|-------|-----------|----------|-------|---------|
| Winner randomly selected | ✓ | Randomness + index stored on-chain | 3 | Yes |
| Randomness verifiable on-chain | ✓ | Commitment + reveal txs | 3 | Yes |
| No retroactive changes | ✓ | State machine history | 3 | Yes |
| Automatic payout | ✓ | Two system transfers in same tx | 3 | Yes |
| Tickets are NFTs | ✓ | Core asset in wallet | 3 | Yes |
| You can verify locally | ✓ | Verification page + code | 4 | Yes |
| Proven by math alone | ✗ | N/A | — | No |
| Multiple oracles | ✗ | N/A | — | No |
| Impossible to predict | ~ | Technically true, misleading | — | No |
| Devnet results immutable | ✗ | N/A (devnet reorgable) | — | No |
| Switchboard guarantees settle | ~ | Dependent on Switchboard uptime | 3 | No |

---

## Action Items for Captain

- [ ] Approve the 6 approved claims
- [ ] Reject the 4 unapproved claims
- [ ] Decide: Include the legal disclaimer (yes/no)?
- [ ] Decide: Phase 3 or Phase 4 for verification page?
- [ ] Review footer language with marketing
- [ ] Coordinate with Switchboard on mainnet transition

---

**Document Status:** Ready for review.  
**Owner:** Engineering + Marketing (Phase 3 gate).
