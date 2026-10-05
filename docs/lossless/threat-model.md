# Cryptoball lossless threat model

Status: draft, evaluated before the revised design in `design.md`.
Companion: `PRINCIPLES.md` Part B, `knowledge/security/fyeo-audit-findings-catalog.md`, `knowledge/security/vulnerability-abundance.md`.
Scope: prize-savings vault on Solana. Devnet design, mainnet threat model. Not an audit.

Date: 2026-10-04.

## 1. Assets and invariants

Assets in scope: depositor principal, harvested prize balance, sponsor top-ups, fee balance, Switchboard request, adapter receipt tokens.

Invariants the design must make true, or the product claim is false:

- I-1. Prize payouts and protocol fees never decrease `principal_assets`.
- I-2. Sum of deposit shares equals `vault.share_supply`.
- I-3. Assets the adapter owes the vault, marked to the adapter's exchange rate, are at least `principal_assets`, or the vault is in `Shortfall` and cannot harvest or draw.
- I-4. A deposit that lands in the commit slot or later has zero weight in that draw.
- I-5. Settle pays `deposit.owner` of the share range that contains the winning index, and no one else.
- I-6. Admin cannot transfer principal. Admin can pause and, after a delay, change the adapter id only to an allowlisted program.
- I-7. A committed draw cannot block withdraws past the reveal timeout.

"Lossless" means I-1 holds inside this program. It does not mean the adapter, USDC, or an LST cannot impair principal. I-3 is how that impairment becomes visible instead of being paid out as a fake prize.

## 2. Actors and trust boundaries

| Boundary | Trusted for | Not trusted for |
| --- | --- | --- |
| Depositor wallet | Signing deposit and withdraw | Account metas, amounts, winner index |
| Anyone-crank | Paying fees, submitting the right accounts | Choosing the winner or the destination |
| Admin key | Pause, param bounds, adapter nomination | Moving principal, instant adapter swap |
| Upgrade authority | Program bytes | Day-to-day custody. Must be a multisig before mainnet |
| Switchboard enclave | Unpredictable bytes bound to a future slot | Liveness. Timeout path required |
| Yield adapter | Exchange rate and redeem of its own receipt | Arbitrary CPI, user-supplied program id |
| USDC mint | The token | Freeze and blacklist. Residual |
| Sponsor | Increasing the prize ATA | Receiving shares for that payment |

Every account in the instruction is attacker-controlled until owner, mint, and address checks pass.

## 3. Threats

Severity is exploit likelihood times exposure, not a count of findings. Exposure on mainnet is user principal.

### T-1. Adapter CPI substitution (critical)

Raw Kamino reserve deposit needs the reserve, lending market, cToken mint, liquidity supply, and a refresh. A substituted reserve or a second program id drains the vault in one instruction. FYEO class: unpinned external program id.

Change: v1 does not CPI a lending reserve. The vault holds one allowlisted receipt mint (`kvUSDC` from one pinned Kamino Earn vault, or the fake adapter on devnet). Deposit transfers USDC to the adapter program id stored on Config. Withdraw redeems that receipt. The program id is checked against Config. Remaining accounts cannot name a program.

### T-2. Admin points the adapter at themselves (critical)

A hot admin key is the whole TVL.

Change: adapter id is not a free pubkey. `queue_adapter` only accepts an id already in a fixed allowlist written at `initialize` (fake adapter, one Kamino Earn vault program). Apply waits one epoch. Admin rotation is nominate plus accept, both signatures. Upgrade authority is documented as Squads before mainnet. Pause does not unlock principal.

### T-3. Donation / inflation attack on shares (high)

A direct transfer into the principal ATA, or a receipt-token donation, inflates the exchange rate. The next depositor is minted too few shares. The attacker withdraws the rounding.

Change: share price uses `principal_assets` and `share_supply` from the ledger, not the raw token-account balance. Unsolicited token-account balance is not credited. First deposit mints 1:1 and locks a dead-share offset of 1_000 shares so the rate cannot be pushed to infinity on an empty vault. Rounding favors the vault on the way in and the vault on the way out.

### T-4. Flash-deposit to win the draw (high)

Kamino and Jupiter flash loans can mint a large deposit and withdraw in the same slot, around a commit.

Change: `eligible_after = commit_slot` is required, set to current slot + 1 at deposit. Commit snapshots `share_supply` and `prize_locked`. Withdraw is refused while `Committed`, so a deposit that counted cannot exit before settle or cancel. Weight is the snapshotted range, not a live balance read at settle.

### T-5. Settle iterates every depositor (high)

A vec of depositors is an unbounded account and a compute bomb. A crank who picks the winner off-chain without a proof pays their own wallet. FYEO class: unbounded `Vec`, missing owner checks.

Change: each Deposit stores `range_start` and `shares`. Ranges partition `[0, share_supply)`. Settle does not loop. The crank passes one Deposit. The program checks `range_start <= winning_index < range_start + shares`, owner matches, and pays that owner. Withdraw uses swap-remove with the tail deposit so ranges stay contiguous. Pages are not required for the check.

### T-6. Withdrawal queue locks the vault (high)

Kamino Earn serves instant withdraws from a buffer plus free reserve liquidity. The rest enters a per-reserve FIFO. A 100% utilized reserve reverts the instant leg. If our withdraw CPI expects atomic USDC, a utilization spike fails every withdraw, which is how a "lossless" app starts to look custodial.

Change: two-step withdraw. `request_withdraw` burns shares and either fills from the vault's own idle buffer or opens a `WithdrawTicket`. `claim_withdraw` pulls from the adapter when liquidity exists. The idle buffer target is 10% of principal, capped, so small exits never touch the venue. Draws do not depend on the queue. A ticket still counts as a liability against `principal_assets` until it pays.

### T-7. Harvest pays a prize out of principal (high)

A stale or attacker-supplied exchange rate lets harvest treat principal as yield. Accounting drift, FYEO class.

Change: harvest reads the receipt balance and the adapter exchange-rate account in the same transaction, both owner-checked. Yield = `receipt_value - principal_assets - outstanding_tickets`. If that is negative, status becomes `Shortfall`, harvest returns 0, draws are refused. Fee is taken from the harvested amount only, after the subtraction.

### T-8. Switchboard withhold or swap (medium)

Oracle never reveals, or the crank substitutes a different randomness account.

Change: Draw stores the randomness account address at commit. Settle requires that address and `seed_slot == draw.seed_slot`. After `REVEAL_TIMEOUT` anyone calls `cancel_draw`. Cancel does not move principal and unlocks withdraws. Prize stays in the prize ATA for the next draw. No slot-hash-only fallback. A leader can bias a raw slot hash.

### T-9. Same-draw grief and empty crank (medium)

Commit with a dust prize spends a Switchboard fee larger than the prize. A paused or abandoned crank is how Pool Party went withdraw-only.

Change: `min_prize` gate. Crank receives a bounded tip from the prize (cap 50 bps, hardcoded), so settle is worth paying for. Commit, settle, and cancel stay permissionless. Admin pause cannot block cancel or withdraw.

### T-10. Sponsor mints influence (medium)

A sponsor who receives shares for a prize top-up buys the draw they just funded.

Change: `sponsor_prize` is a token transfer into the prize ATA. It does not mint shares and does not update `principal_assets`.

### T-11. Init front-run and re-init (medium)

FYEO class: first-come initialize.

Change: `initialize` signer must be the program upgrade authority. Config is not closeable. Vault init is admin-only and seed-unique per mint.

### T-12. Token account confusion (medium)

Wrong mint, wrong owner, a delegate set on the user ATA.

Change: `transfer_checked`, mint equals `vault.mint`, user ATA owner is the signer, delegate is none, vault ATAs are the canonical ATAs of the vault PDA.

### T-13. Cross-chain and leveraged yield (critical if added)

CCTP attestations can stall. Wrapped USDC is not USDC. Multiply and CLMM can lose principal. A withdrawal queue on a fixed-rate sleeve plus a bridge is two locks.

Change: out of v1. The allowlist has no bridge program. Design refuses an adapter whose redeem is not same-asset.

### T-14. Upgrade and freeze residual (accepted)

A malicious upgrade replaces the program. USDC freeze blacklists the vault ATA. Switchboard enclave plus a slot leader is the randomness residual.

Change: Squads on the upgrade authority, a published upgrade delay, events on every mutation, no claim that the product is risk-free. UI copy has to say venue risk in one sentence.

## 4. What the evaluation changed

The previous draft settled by walking deposits, CPI'd the venue loosely, and treated withdraw as always atomic. Those three do not survive this model.

Kept: Switchboard commit/settle/cancel, fee only on yield, sponsor pot, pause that cannot trap funds, internal shares instead of a permanent-delegate mint, one asset per vault.

Added: receipt-mint adapter, dead-share offset, snapshotted ranges, O(1) winner check, two-step withdraw, idle buffer, shortfall status, crank tip, allowlist plus epoch delay.

Rejected after evaluation: exact 5-of-69 payout (no winner is the common case), cross-chain v1, leveraged vaults, marginfi, Save/Solend, holding the prize inside the yield venue.

## 5. Test obligations

Each threat gets a negative LiteSVM test before a devnet adapter is wired.

- T-3 donation does not change share price.
- T-4 deposit in the commit slot has no range in the snapshot.
- T-5 wrong Deposit account fails settle.
- T-6 partial fill opens a ticket and does not burn the liability.
- T-7 shortfall blocks harvest and commit.
- T-8 mismatched randomness account fails.
- T-10 sponsor transfer does not mint shares.
- Conservation: principal out + prize out + fee + crank tip = assets in + sponsor in, under the fake adapter.
