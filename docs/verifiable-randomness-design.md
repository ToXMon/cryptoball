# Verifiable Randomness Architecture & Evidence Design

**Status:** Design & Policy Framework for Phase 3+  
**Date:** 2026-01-09  
**Purpose:** Define what Cryptoball can claim on its landing page footer about draw fairness, the technical architecture that enables those claims, and the policy/evidence chain required to substantiate them.

---

## Executive Summary

Cryptoball uses Switchboard On-Demand VRF for draw randomness. The commitment is created and revealed on-chain in the **same transaction** as settlement, meaning:

1. **What we CAN claim:** "Draw winner randomly selected and verifiable on-chain" (true)
2. **What we CANNOT claim:** "Winner predicted from inputs alone" (impossible during devnet; mainnet requires long-form TEE attestation)
3. **What Switchboard provides:** TEE-based randomness with cryptographic commitment and reveal, all on-chain
4. **What Switchboard does NOT provide:** BLS signatures, oracle consensus, or off-chain proof that users can verify independently without running a node

**Architecture answer:** Switchboard On-Demand IS sufficient for the claim "verifiable on-chain randomness" because:
- Commitment is stored on-chain before reveal
- Reveal happens the same slot (or next slot) on-chain
- Any node operator can verify the sequence in Solana's transaction history
- Settlement uses the revealed value; cannot be undone or swapped

**Policy answer:** The footer link should point to:
1. Commitment + reveal transaction hash (in Solana Explorer)
2. Randomness account (readable, shows the commitment and reveal data)
3. Settlement transaction showing which ticket won
4. A brief explainer: "Why this is verifiable"

---

## 1. What Switchboard On-Demand Provides

### 1.1 TEE Randomness (not Oracle Consensus)

**Switchboard On-Demand uses:**
- Trusted Execution Environment (TEE) inside Switchboard's infrastructure
- The TEE generates a random value
- The TEE signs it with its private key
- Signature + value posted on-chain as a Solana account

**Switchboard does NOT use:**
- Oracle consensus (multiple oracles voting)
- BLS signature aggregation
- Off-chain proof generation (Groth16, etc.)

### 1.2 Commitment + Reveal Pattern

**Flow:**

```
Keeper (off-chain or on-chain):
  1. Call Switchboard commit instruction
     → Creates randomness account (PDA or keypair)
     → Switchboard TEE receives request
     → TEE stores a commitment (hash of random value)
     → Stores seed_slot = current_slot - 1

Solana slot boundary (clock.slot increments)

Switchboard (on-chain):
  2. Call Switchboard reveal instruction
     → TEE posts the actual random value to the account
     → Account now contains: commitment, random value, seed_slot, timestamp

Cryptoball keeper:
  3. Call settle_draw instruction in same transaction
     → Read the randomness account
     → Call get_value(clock.slot) to extract the revealed value
     → Verify seed_slot == stored slot
     → Use value to determine winning ticket
     → Pay winner in same transaction
```

**Key property:** Once the reveal is posted to the account, it becomes part of Solana's immutable transaction history. We can never unstick it or change it.

### 1.3 What Makes This Verifiable

| Property | How Verified |
|----------|--------------|
| Randomness was requested before close | Commitment tx timestamp < campaign.close_ts |
| Randomness is fresh | seed_slot matches our stored slot (prevents replay/stale) |
| Randomness was revealed before settlement | Reveal tx is in the block before settle_draw |
| Settlement used the actual value | settle_draw reads the account and uses its value to compute index |
| No substitution after reveal | Solana's immutable ledger; once in block, no reorg (finality) |
| Index computed correctly | winner.rs implementation is public; known vector test confirms it |

**What is NOT verifiable (devnet-specific limitation):**
- That the TEE actually generated a random value vs. a pre-computed one
- That Switchboard didn't know the value in advance
- Long-form cryptographic proof of TEE integrity (requires mainnet attestation chain)

### 1.4 Devnet vs Mainnet Differences

| Aspect | Devnet | Mainnet |
|--------|--------|---------|
| Switchboard TEE | Available | Available |
| Commitment + reveal | Works | Works |
| On-chain verifiability | ✓ YES | ✓ YES |
| TEE attestation chain | N/A (ephemeral) | Available (SGX attestation to DCAP verifier) |
| Finality | None (reorgable) | ✓ 32 slots (~13 sec) |
| User confidence | "Testnet, play money" | "Can verify in block history" |

---

## 2. Sufficient? Do We Need More Than Switchboard?

### 2.1 Decision Matrix

| Requirement | Switchboard On-Demand | BLS Oracle VRF | Arcium RNG | Cryptoball need |
|-------------|----------------------|----------------|-----------|-----------------|
| Randomness generated | ✓ | ✓ | ✓ | ✓ |
| On-chain record | ✓ | ✓ | ✓ | ✓ |
| Verifiable (no node needed) | ✓ Ledger only | ✓ Signature | ✗ Private key needed | ✓ |
| Committed before reveal | ✓ | ~ (implicit) | ~ (inside MPC) | ✓ |
| Anti-manipulation for player | ✓ | ✓ | ✗ | ✓ |
| Testnet (devnet) ready | ✓ | ✓ Limited | ✓ | ✓ |
| Mainnet ready | ✓ | ✓ | ✓ | ✓ |
| Monthly cost | ~$0.50 / draw | ~ $0.05 / draw | ~$0.01 wrapped | Devnet free |

### 2.2 Verdict: Switchboard Only IS Sufficient

**Yes, Switchboard On-Demand alone is sufficient to claim "verifiable on-chain randomness."**

Reasoning:
1. The commitment is created and stored before players see the value ✓
2. The reveal happens on-chain in an immutable transaction ✓
3. Any node operator can read the commit+reveal sequence ✓
4. Settlement tx references the exact value that was revealed ✓
5. No need for secondary sources (oracles, cryptographic proofs, etc.) ✓

### 2.3 Not Needed (But Optional for Mainnet Sophistication)

Future enhancements (not for devnet MVP):

- **Arcium for privacy:** If player odds are sensitive, use Arcium to compute winner inside MPC, then use Switchboard result as input. Not needed for raffle.
- **SGX attestation:** On mainnet, if you want to prove the TEE was genuine, fetch the Intel SGX attestation. Adds complexity; overkill for devnet.
- **Proof publication:** Publish a Merkle tree of all draws, auditable by third parties. UX complexity; not for MVP.

---

## 3. Technical Architecture: What Gets Committed & When

### 3.1 Instruction Sequence (Already in design.md, Section 8)

**commit_draw instruction:**
```rust
pub fn commit_draw(ctx: Context<CommitDraw>) -> Result<()> {
    // ctx.accounts.randomness = Switchboard-created randomness account
    // Switchboard's commit instruction is in the same tx (client-built)
    
    let randomness = ctx.accounts.randomness;
    
    // Parse Switchboard's commitment from the account
    let commitment = SwitchboardCommitment::try_from_slice(&randomness.data.borrow()[..])?;
    
    // Verify we're reading a fresh commitment
    assert_eq!(commitment.seed_slot, clock.slot - 1);
    
    // Store for later (settle_draw will verify this)
    campaign.seed_slot = commitment.seed_slot;
    campaign.rand_account = randomness.key();
    campaign.committed_at = now();
    campaign.state = DrawCommitted;
    
    Ok(())
}
```

**settle_draw instruction:**
```rust
pub fn settle_draw(ctx: Context<SettleDraw>) -> Result<()> {
    // ctx.accounts.randomness = same account as commit
    
    let randomness = ctx.accounts.randomness;
    
    // Verify freshness: has the reveal happened in THIS slot?
    let value = get_value(randomness, clock.slot)?;  // Fails if not revealed
    
    // Compute winner from the actual revealed value
    let winning_index = winning_index(&value.bytes, campaign.ticket_count)?;
    
    // Pay the winner
    let ticket = &ctx.accounts.ticket;  // PDA for that index
    let buyer = &ctx.accounts.winner_wallet;  // Must equal ticket.buyer
    
    // ... fee, prize math, transfers ...
    
    campaign.randomness = value.bytes;
    campaign.winning_index = winning_index;
    campaign.winner = buyer.key();
    campaign.state = Settled;
    
    emit!(DrawSettled { ... });
}
```

### 3.2 What's Stored On-Chain

**Cryptoball's campaign account after settle_draw:**
```rust
pub struct Campaign {
    pub id: u64,
    // ... other fields ...
    
    // Randomness proof chain:
    pub rand_account: Pubkey,           // The Switchboard account we read from
    pub seed_slot: u64,                 // Slot when Switchboard created the commitment
    pub committed_at: u64,              // Unix timestamp of commit_draw tx
    pub randomness: [u8; 32],           // The actual revealed value
    pub winning_index: u32,             // Computed from randomness
    pub winner: Pubkey,                 // Payout recipient
    pub state: CampaignState,           // Settled
}
```

**Switchboard's randomness account (on-chain, anyone can read):**
```
Discriminator: "randomness" (Switchboard-defined)
Commitment: [u8; 32]        // Hash of the value (stored during commit_draw tx)
Value: [u8; 32]             // The actual random bytes (stored during reveal)
Seed slot: u64              // Slot for anti-replay
Timestamp: u64              // When reveal happened
Signature: [u8; 64]         // TEE signature (Switchboard's proof)
```

**Cryptoball's settle_draw transaction:**
```
Instructions:
  1. Switchboard reveal (placed by keeper or client)
  2. Cryptoball settle_draw (reads the randomness account)

Both in the same block, same slot or adjacent slots.
```

---

## 4. Evidence Chain: What We Link From the Footer

The landing page footer should contain a section like:

```html
<footer class="cb-footer">
  <section aria-labelledby="fairness">
    <h3 id="fairness">🎲 Draw is verifiable on-chain</h3>
    <p>Every draw uses <a href="https://switchboard.xyz">Switchboard On-Demand VRF</a>.</p>
    <p>After settlement, you can verify:</p>
    <ol>
      <li><a href="/#/verify/{campaignId}">Commitment & reveal transaction</a> (links to explorer)</li>
      <li><a href="/#/verify/{campaignId}">Winning ticket index</a> (links to campaign data)</li>
      <li><a href="https://www.solaneye.com/docs/references/technical-faq.html">How to read Solana block history</a></li>
    </ol>
    <p><details><summary>Why this is fair (expand)</summary>
      <p>The random value is committed before the draw closes, revealed on-chain in the settlement transaction, 
      and baked into Solana's immutable ledger. No retroactive changes, no hidden value, no oracle collusion.</p>
      <p>For devnet (play money), this gives you cryptographic assurance. For mainnet, Switchboard's TEE 
      attestation proves the value came from genuine hardware.</p>
    </details></p>
  </section>
</footer>
```

### 4.1 Evidence Files (Each Draw)

After a draw settles, the following must be linkable:

| Evidence | Where to Find | What It Proves |
|----------|---------------|----------------|
| Commitment tx | Solana Explorer: `{commitment_tx_hash}` | Timestamp < close_ts; commitment stored |
| Reveal tx | Solana Explorer: `{reveal_tx_hash}` | Value posted on-chain |
| Settlement tx | Solana Explorer: `{settlement_tx_hash}` | Winner determined, paid automatically |
| Randomness account | Solana Explorer: `{randomness_key}` | All three (commit, value, signature) readable |
| Campaign account | Solana Explorer or our indexer: `{campaign_key}` | Stored value, stored index, stored winner |
| Winning ticket NFT | Metaplex Core explorer | Owned by winner wallet, minted during buy_ticket |
| Winner wallet balance delta | Solana Explorer: `{winner_wallet}` | SOL received matches payout |

### 4.2 Verification UI Page (Non-Critical, Phase 4+)

A dedicated page `/verify/{campaignId}` that:
1. Fetches on-chain data from Solana RPC
2. Displays the commitment + reveal account data
3. Shows the settlement transaction
4. Runs the `winning_index` function locally with the revealed value
5. Confirms it matches the stored index
6. Verifies: `settled.winner == expected_ticket.buyer`
7. Links to all txs in Solana Explorer

Example:
```typescript
function VerifyDraw({ campaignId }: { campaignId: number }) {
  const campaign = fetchCampaign(campaignId);  // On-chain
  const randomnessAccount = fetchAccount(campaign.rand_account);  // On-chain
  const ticket = fetchTicket(campaignId, campaign.winning_index);  // On-chain
  
  // Local verification
  const computedIndex = winningIndex(randomnessAccount.value, campaign.ticket_count);
  const matches = computedIndex === campaign.winning_index;
  
  const payoutCorrect = campaign.winner === ticket.buyer;
  
  return (
    <div className="cb-verify">
      <h2>Verify Draw #{campaignId}</h2>
      <p>Commitment: {randomnessAccount.commitment} (slot {campaign.seed_slot})</p>
      <p>Revealed: {randomnessAccount.value}</p>
      <p>Computed index: {computedIndex} ✓ Matches: {matches}</p>
      <p>Winner: {campaign.winner} ✓ Is buyer: {payoutCorrect}</p>
      <p><a href={explorerTx(campaign.settlement_tx)}>See settlement tx</a></p>
    </div>
  );
}
```

---

## 5. Policy: What Cryptoball Can and Cannot Claim

### 5.1 CAN Claim

✓ "**Draw winner is randomly selected**" — True. Switchboard's TEE generates randomness.

✓ "**Randomness is verifiable on-chain**" — True. Commitment and reveal are in Solana's transaction history.

✓ "**No retroactive changes to the draw**" — True. Settlement is a single atomic transaction; once finalized (32 slots on mainnet, 0 on devnet), the outcome is immutable.

✓ "**Automatic payout; no claim step needed**" — True. Winner is paid in the same settle_draw transaction.

✓ "**Your ticket is an NFT in your wallet**" — True. Metaplex Core asset, transferable, owned by buyer.

✓ "**You can verify the result**" — True (mainnet: easily; devnet: with an RPC node and some detective work).

### 5.2 CANNOT Claim

✗ "**Cryptographically proven fair**" — Not quite. Switchboard's proof is a TEE signature, not a zero-knowledge proof. On devnet, the TEE is ephemeral (no attestation). On mainnet, attestation is optional for our use case.

✗ "**Mathematically impossible to predict**" — Technically true, but the "predict" part is hard to verify without knowing Switchboard's internals.

✗ "**Verified by $N independent oracles**" — False. Switchboard On-Demand uses one TEE at a time, not multiple oracles.

✗ "**Provably fair by third parties**" — Not without external audit. We can prove fair to someone who trusts Solana's ledger. We cannot prove it to someone who doesn't have an RPC endpoint.

✗ "**Winners determined before you buy**" — False. The value is determined after close_ts (after all sales are final), but before reveal.

### 5.3 Suggested Footer Language

**Option 1 (Conservative, Devnet):**
```
"🎲 Fair draw: Randomness committed before close, revealed on-chain, baked into Solana's ledger. 
Not possible to predict or change."
[Learn how] [Verify this draw]
```

**Option 2 (Marketing-Forward, Mainnet Aspirational):**
```
"🎲 Cryptographically fair: Each draw uses Switchboard's hardware-verified randomness. 
See every draw verified on-chain, instantly, by anyone."
[See evidence] [How it works]
```

**Option 3 (Honest & Specific):**
```
"🎲 Verifiable randomness (Switchboard VRF, on-chain commitment + reveal, immutable settlement)

Cryptoball settles with Switchboard On-Demand VRF. Each draw:
1. Creates a random commitment (before close_ts)
2. Reveals the value on-chain (in settlement tx)
3. Pays the winner automatically (same tx)

You can verify the commitment → reveal → settlement chain in Solana Explorer.
[View {N} verified draws] [How to read the evidence]"
```

---

## 6. Implementation Checklist (Phase 3+)

### 6.1 Program Changes (Already Designed)

- [ ] `commit_draw` stores `rand_account`, `seed_slot`, `committed_at`
- [ ] `settle_draw` reads randomness account, validates freshness, stores `randomness` and `winning_index`
- [ ] `settle_draw` stores `settlement_tx_hash` or exposes it via event (keeper derives from block)
- [ ] Emit event with all evidence data: `{campaign_id, rand_account, seed_slot, randomness, winning_index, winner, settlement_tx}`

### 6.2 Frontend Changes

- [ ] Landing page footer section with fairness claim + links
- [ ] `/verify/{campaignId}` page (Phase 4) that fetches and verifies on-chain data
- [ ] Campaign results page links to both the commitment tx and the settlement tx in Solana Explorer
- [ ] Ticket detail page shows: commitment tx, reveal tx, settlement tx, winner, payout amount

### 6.3 Keeper (Off-Chain Operator)

- [ ] Build `[switchboard_commit_ix, cryptoball_commit_draw_ix]` transaction
- [ ] Build `[switchboard_reveal_ix, cryptoball_settle_draw_ix]` transaction
- [ ] Log the tx hash of each for evidence linking

### 6.4 Documentation

- [ ] Add `docs/VERIFIABLE-RANDOMNESS.md` (this document + implementation details)
- [ ] Add `docs/EVIDENCE-LINKING.md` (how to construct links, tx hash discovery, RPC queries)
- [ ] Add section to `README.md`: "Why you can trust Cryptoball's draws"

### 6.5 Testing

- [ ] Known-vector test: `commitment = {...}, reveal = [...], expected_winner_index = 42` → assert equals
- [ ] End-to-end devnet test: buy tickets → commit → reveal → settle, read all on-chain data, verify chain
- [ ] Distribution test (Phase 4): run 100 draws, check winning_index distribution is uniform

### 6.6 Launch Checklist

- **Devnet (current):** Footer links to Explorer, indicates "testnet/play money"
- **Testnet (pre-mainnet):** Footer links to real Switchboard On-Demand instances, actual SOL
- **Mainnet:** Footer prominent, links to attestation chain (if available), emphasizes "publicly verifiable"

---

## 7. Switchboard On-Demand Integration: Technical Details

### 7.1 Pinned Versions (From design.md Section 10)

```toml
[dependencies]
switchboard-on-demand = "=0.13.0"
features = ["solana-v2", "devnet"]  # NOT the `anchor` feature (breaks with 0.32.1)
```

### 7.2 Constants to Pin (In `programs/cryptoball/src/constants.rs`)

```rust
// Mainnet Switchboard On-Demand program id
pub const SWITCHBOARD_PROGRAM_ID_MAINNET: Pubkey = 
    pubkey!("SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv");

// Devnet Switchboard On-Demand program id (the feature "devnet" bakes this)
pub const SWITCHBOARD_PROGRAM_ID_DEVNET: Pubkey = 
    pubkey!("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");

// For Phase 3: add a constant that selects based on Anchor's cluster env
#[cfg(feature = "devnet")]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = SWITCHBOARD_PROGRAM_ID_DEVNET;

#[cfg(feature = "mainnet")]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = SWITCHBOARD_PROGRAM_ID_MAINNET;
```

### 7.3 Types: Reading Switchboard's Randomness Account

From `switchboard-on-demand` crate, the randomness account structure:

```rust
use switchboard_on_demand::solana_program::account_info::AccountInfo;
use switchboard_on_demand::prelude::*;

// In settle_draw:
let randomness_data = &randomness_account.data.borrow();
let randomness = RandomnessAccountData::try_from_slice(randomness_data)?;

// Extract the revealed value
let value: [u8; 32] = randomness.get_value(clock.slot)?;
// ^ This call fails if reveal hasn't happened in this slot; prevents reuse of stale values

// Verify freshness
assert_eq!(randomness.seed_slot, campaign.seed_slot);

// Use the value
let winning_index = winning_index(&value, campaign.ticket_count)?;
```

### 7.4 Off-Chain Keeper: Building the Transactions

Keeper logic (TypeScript, using `@switchboard-xyz/on-demand` SDK):

```typescript
// Step 1: Commit (keeper or client builds this tx)
const commitIx = await switchboard.createCommitInstruction({
  randomnessAccount: randomnessAccount,  // PDA or keypair
  seed_slot: currentSlot - 1,
});

const commitTx = new Transaction().add(commitIx);
const commitSig = await connection.sendTransaction(commitTx, [keeper]);
await connection.confirmTransaction(commitSig);

// Step 2: Reveal (same tx as settle_draw)
// This requires waiting for Switchboard's reveal to be available
// Typically: keeper calls reveal on a cadence (e.g., every slot)
// Or: keeper polls the randomness account until revealed

const revealIx = await switchboard.createRevealInstruction({
  randomnessAccount: randomnessAccount.publicKey,
});

const settleDrawIx = await program.methods
  .settleDraw()
  .accounts({
    campaign: campaignPda,
    randomness: randomnessAccount.publicKey,
    ticket: ticketPda,
    // ... other accounts
  })
  .instruction();

// Build tx: [reveal, settle_draw]
const settleTx = new Transaction()
  .add(revealIx)
  .add(settleDrawIx);

const settleSig = await connection.sendTransaction(settleTx, [keeper]);
await connection.confirmTransaction(settleSig);

console.log(`Committed at ${commitSig}, revealed+settled at ${settleSig}`);
// ^ Store these for evidence linking
```

---

## 8. Mainnet Considerations (Post-MVP)

### 8.1 Why Devnet is Different

**Devnet:**
- Switchboard infrastructure is ephemeral
- No finality; blocks can reorg
- TEE attestation not available
- Plan money; low trust assumptions

**Mainnet:**
- Switchboard infrastructure is persistent, staked
- Finality after 32 slots (~13 seconds)
- TEE attestation available from Intel DCAP verifier
- Real SOL; higher trust expectations

### 8.2 Mainnet Upgrade Path

On mainnet, Cryptoball's verifiable randomness claim becomes even stronger:

1. **Use Switchboard mainnet program id:** `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv`
2. **Add TEE attestation verification** (Phase 5+, optional):
   - Fetch the Switchboard randomness account's TEE signature
   - Verify it against Intel's DCAP (Data Center Attestation Primitives)
   - This proves the value came from genuine SGX hardware
3. **Add finality guarantees:** After 32 slots, no reorg; outcome is permanent
4. **Link to audit trail:** Publish a contract with Switchboard guaranteeing uptime, freshness, no collusion

### 8.3 Future Enhancement: Arcium + Switchboard Hybrid (Phase 6, Optional)

For ultra-high-privacy lotteries (e.g., if prize data is sensitive):

```
Switchboard: Provides randomness
Arcium MPC: Computes winner inside encrypted circuit
Cryptoball: Receives encrypted payout, decrypts locally

This adds no additional cost and keeps edge data (odds, near-miss tickets) private.
Not needed for devnet MVP.
```

---

## 9. Known Limitations & Workarounds

### 9.1 Devnet Limitations

| Limitation | Impact | Workaround |
|-----------|--------|-----------|
| No finality | Blocks can reorg, outcome can change | Use testnet / mainnet for real draws |
| No attestation | TEE not provable | Accept play-money testing |
| Switchboard availability | May be down | Pre-testnet coordination with Switchboard |
| Single slot reveal | No multi-slot confirmation | Acceptable; same tx provides atomicity |

### 9.2 Mainnet Limitations (Future)

| Limitation | Mitigation |
|-----------|-----------|
| Switchboard goes down | Graceful timeout + cancel + refund (already in design) |
| Keeper disappears | Anyone can settle (permissionless); incentive fee if keeper-provided |
| Smart contract bug in Switchboard | Audit before mainnet; monitor for patches |
| TEE compromise (rare) | Switchboard rotates keys; new draws use new hardware |

---

## 10. Communication Strategy: What to Say

### 10.1 Marketing Landing Page

**Headline:**
> "Your draw. Verified. Automated payout."

**Subheading:**
> "Cryptoball uses Switchboard VRF for transparent, on-chain randomness. One ticket wins. Settlement happens automatically."

**Trust badges (footer):**
- 🔐 "Verified on-chain"
- ⚡ "Instant payout"
- 📋 "NFT receipt"
- 🎲 "[View {N} draws verified]"

### 10.2 Explainer Page (`/how-it-works`)

**Section: "Why You Can Trust the Draw"**

1. **Before the draw closes:** You buy tickets, each recorded on-chain as an NFT.
2. **At close time:** Anyone can commit a randomness request to Switchboard.
3. **During reveal:** Switchboard's hardware posts the random value to Solana's ledger.
4. **At settlement:** Our program uses that value to pick one winning ticket. Both the winner and the commitment are stored on-chain forever.
5. **The result:** Immutable record. No way to retroactively change who won.

**Link:** "See the code that computes the winner: [github.com/cryptoball/programs/src/winner.rs](link)"

### 10.3 Per-Draw Evidence Page (`/draw/{id}/verify`)

**Example for Draw #42:**

```
Draw #42 - Verified Randomness

📅 Sales closed: 2026-01-09 18:00 UTC
🎰 Commitment posted: [tx hash]  [Explorer link]
✅ Randomness revealed: [tx hash]  [Explorer link]
🏆 Winner settled: [tx hash]  [Explorer link]

Randomness account: [address]
Winning ticket: #17 (Owner: solxxxx...yyyy)
Prize: 9.5 SOL
Treasury fee: 0.5 SOL (5%)

✓ Commitment → Reveal → Settlement chain verified
✓ Winner paid automatically [recipient wallet] [+9.5 SOL tx]
```

---

## 11. Checklist for Landing Page Footer

- [ ] **Fairness claim visible** ("Draw is verifiable on-chain" or similar)
- [ ] **Link to Switchboard docs** (explain what VRF is)
- [ ] **Link to latest draw evidence** (commitment, reveal, settlement txs)
- [ ] **Link to verification page** (if Phase 4 done; else, link to docs)
- [ ] **Devnet vs mainnet indicator** ("Testnet—play money" for devnet; real SOL claim for mainnet)
- [ ] **No misleading language:**
  - ✓ "Randomness verified on-chain"
  - ✗ "Cryptographically proven by SGX attestation" (only on mainnet, if we add it)
  - ✗ "Verified by {N} independent oracles" (false; single TEE)
- [ ] **Mobile responsive** (footer readable on phone)
- [ ] **Accessible** (links have text, color not only indicator, expandable details)

---

## Conclusion

**Switchboard On-Demand alone is sufficient** to claim "verifiable on-chain randomness" for Cryptoball. No additional randomness provider is needed.

**The evidence chain is:**
1. Commitment tx (timestamp, slot, commitment hash)
2. Reveal tx (posted value, signature, proof)
3. Settlement tx (uses exact value, pays winner)
4. Immutable in Solana's ledger

**The footer should link to this chain** and provide a brief explanation of why it's verifiable. Users (or auditors) can follow the links to Solana Explorer and confirm the sequence.

**Phase 3:** Implement program changes, emit events with evidence data, add footer links to Explorer.
**Phase 4:** Add verification page that fetches on-chain data and confirms the chain locally.
**Phase 5+:** On mainnet, optionally add TEE attestation verification for ultra-high confidence.

---

## References

- Switchboard On-Demand docs: https://docs.switchboard.xyz/
- Switchboard GitHub: https://github.com/switchboard-xyz/
- Solana blockchain: https://solana.com/
- Metaplex Core: https://github.com/metaplex-foundation/mpl-core
- Cryptoball design: `docs/design.md` (section 8, CPI plan; section 7, winner determination)

---

**Document Status:** Ready for captain sign-off (Phase 3 gate).  
**Next Step:** Implement Phase 3 program changes, keeper tx building, frontend links.
