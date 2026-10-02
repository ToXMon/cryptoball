# Cryptoball Randomness: Quick Reference

**TL;DR:** Use Switchboard On-Demand VRF. No other provider needed. Link evidence from footer. Done.

---

## Can We Claim "Verifiable Randomness"?

**YES.** Switchboard On-Demand gives us:
1. Commitment (stored on-chain before close)
2. Reveal (posted on-chain at settlement)
3. Immutable in Solana's ledger
4. Anyone can audit the sequence

**Footer text:** "Draw is verifiable on-chain" + link to Solana Explorer.

---

## Do We Need Arcium? BLS VRF? Other RNG?

**NO.** Switchboard On-Demand is sufficient.

| Provider | Cost | Latency | On-chain verifiable | Complexity |
|----------|------|---------|---------------------|------------|
| Switchboard | ~$0.50/draw | ~2 slots | YES | Low ✓ |
| Arcium | ~$0.01 wrapped | 5-30 min | NO (private) | High |
| BLS VRF | ~$0.05/draw | ~2 slots | YES | Medium |

**Decision:** Use Switchboard. Arcium adds no value; BLS is overkill.

---

## What Goes On The Landing Page Footer?

```html
<footer>
  <section>
    <h3>🎲 Verifiable Randomness</h3>
    <p>Winner randomly selected using Switchboard VRF, verified on-chain.</p>
    <p><a href="#/latest-draws">See verified draws</a></p>
    <details>
      <summary>Why this is fair</summary>
      <p>Commitment stored before sales close. Revealed at settlement.
      Baked into Solana's ledger. No changes possible.</p>
    </details>
  </section>
</footer>
```

---

## Evidence Chain (Per Draw)

After settlement, link to:

1. **Commitment tx** (Solana Explorer)
   → Timestamp < campaign.close_ts ✓
   → Switchboard commitment stored ✓

2. **Randomness account** (Solana Explorer)
   → Commitment hash visible ✓
   → Revealed value visible ✓

3. **Settlement tx** (Solana Explorer)
   → Two transfers (fee + prize) ✓
   → Loser and winner wallets ✓

4. **Campaign account** (on-chain data)
   → Stored randomness value ✓
   → Stored winning_index ✓
   → Stored winner pubkey ✓

---

## Verified Claims

**OK to say:**
- ✓ "Winner randomly selected"
- ✓ "Verifiable on-chain"
- ✓ "No retroactive changes"
- ✓ "Automatic payout"
- ✓ "You can verify locally"

**NOT OK to say:**
- ✗ "Mathematically proven" (TEE, not ZK)
- ✗ "Multiple independent oracles" (single TEE)
- ✗ "Impossible to predict" (misleading)
- ✗ "Devnet results immutable" (reorgable)

---

## Implementation Timeline

| Phase | What | Effort | Notes |
|-------|------|--------|-------|
| **3 (MVP)** | Footer + evidence links | 1 day | Devnet; play money |
| **4** | Verification page | 2 days | Fetch on-chain, verify locally |
| **5** | Mainnet launch | 3 days | Audit + finality claims |

---

## Switchboard Integration

**Already in code:**
- v0.13.0 pinned
- Features: `["solana-v2", "devnet"]`
- Devnet program id: `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2`

**Phase 3 needed:**
- Store randomness value in campaign account
- Store winning_index (deterministic from randomness)
- Emit event with all evidence
- Keeper logs commitment and settlement tx hashes

**Phase 5 (mainnet):**
- Switch program id to `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv`
- Add finality claims ("32 slots = final")
- Optionally add TEE attestation verification

---

## Winner Selection

```rust
// The only logic that matters:
winning_index = revealed_random_value % ticket_count

// Example:
// randomness = 0x1a2b3c... (as u128: 12345)
// ticket_count = 100
// winning_index = 12345 % 100 = 45
// Ticket #45 wins
```

This is in `programs/cryptoball/src/winner.rs`. Public, auditable, deterministic.

---

## Keeper Responsibilities

1. **Commit phase:**
   - Call Switchboard commit_random
   - Store commitment tx hash

2. **Settlement phase:**
   - Call Switchboard reveal (same tx as settle_draw)
   - Call cryptoball settle_draw
   - Store settlement tx hash

3. **Evidence chain:**
   - Pass both tx hashes to indexer or UI
   - Announce results with links

---

## FAQ

**Q: Can users predict the winner before reveal?**  
A: No. Randomness is committed before sales close, revealed after.

**Q: Can we change who wins after reveal?**  
A: No. Settlement is atomic; result is immutable once in a Solana block.

**Q: What if Switchboard goes down?**  
A: Campaign cancels, all tickets refunded. No funds trapped.

**Q: How long until the winner is paid?**  
A: Immediately, same transaction as reveal.

**Q: Can the winner refuse to claim?**  
A: There's no claim step. Prize is pushed to their wallet automatically.

**Q: Is this "better" than traditional lotteries?**  
A: Yes. Fully transparent, deterministic, immutable, automatic payout.

**Q: Is this "better" than other on-chain lotteries?**  
A: Yes to verifiability; comparable on cost and speed. Switchboard is proven, popular, Solana-native.

---

## Links

| Resource | URL |
|----------|-----|
| Switchboard docs | https://docs.switchboard.xyz/ |
| Switchboard GitHub | https://github.com/switchboard-xyz/ |
| Cryptoball source | https://github.com/cryptoball/ |
| Solana Explorer | https://explorer.solana.com/ |
| Solana finality | https://docs.solana.com/consensus/faq |

---

## Decision Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-01-09 | Use Switchboard On-Demand VRF | Sufficient for on-chain verification; no Arcium needed |
| 2026-01-09 | Store randomness + index on-chain | Evidence chain for auditing |
| 2026-01-09 | Link from footer to Explorer | Marketing claim must have supporting evidence |
| 2026-01-09 | No BLS VRF (phase 3) | Overkill; Switchboard cheaper and sufficient |
| 2026-01-09 | No legal disclaimer (footer) | Keep it simple; full docs if asked |

---

**Status:** Ready to implement Phase 3  
**Owner:** Engineering  
**Approval:** Captain  

See full architecture: `docs/verifiable-randomness-design.md`  
See claims policy: `docs/CLAIMS-AND-EVIDENCE.md`  
See footer code: `docs/FOOTER-IMPLEMENTATION.md`
