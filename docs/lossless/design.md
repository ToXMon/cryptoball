# Cryptoball lossless architecture (revised after threat model)

Status: draft for captain sign-off. Supersedes the pre-threat-model sketch.
Threat model: `docs/lossless/threat-model.md`. Diagram: `docs/lossless/architecture.md`.
Companion: `skills/solana-architect` 14 outputs, `PRINCIPLES.md` Parts A-D.
Risk: Critical. Devnet only until the conservation test and the T-3 through T-10 negatives are green.

## 0. Use-case summary

Depositors put USDC into a vault. The program holds an allowlisted receipt (a pinned Kamino Earn vault share on mainnet, a fake accruing receipt on devnet) and keeps an idle USDC buffer. Yield above principal, plus sponsor top-ups, is the only prize. A draw snapshots share ranges, Switchboard reveals a word, and anyone can settle by presenting the one Deposit whose range contains the index. The program pays that owner. Principal is withdrawable except during the reveal window, and a venue queue becomes a ticket instead of a stuck vault.

Mega Millions numbers are display-only. They do not gate payout. That is the "no one wins" case, and it is not the product.

## 1. Yield and why the protocol can work

Pool Party hibernated because the prize was smaller than the work, Solend shut down, and nothing permissionless kept the crank running. PoolTogether V5 kept prizes visible by splitting liquidity into a rare grand prize and many frequent small prizes, and by letting any vault contribute yield into one pot. That split is the success mechanism. Chasing the highest APY is not.

Point-in-time, 4 Oct 2026, not for hardcoding:

- Solana lending is about $3.0b. Kamino Lend about $1.40b, Jupiter Lend about $1.32b. USDC supply on Kamino's deep market about 4.3%.
- Aave V3 USDC about 3.6%, near T-bill parity. Morpho sometimes pays more and moves more. syrupUSDC is private credit, a depeg risk, not a base asset.
- Kamino Earn shares (`kvUSDC-*`) are fungible. The exchange rate rises. Redeem is instant from a buffer plus free reserve liquidity, otherwise a FIFO queue. Fixed-rate sleeves are what make the queue common.

v1 venue: one Kamino Earn USDC vault with variable reserves only, no fixed-rate sleeve, no Multiply, no CLMM. Pin the vault and the receipt mint. Keep 10% of principal idle in our ATA so small withdraws never enter their queue.

Do not hold ONyc, sUSDai, commodity kicUSDC, or a PT. The extra points are credit, a queue, or a maturity. Any of those can break I-1 in practice.

Prize shape, taken from V5's retention lesson and cut to two buckets so the program stays small:

- 70% of the harvested week pays the weekly winner.
- 30% rolls into a grand pot paid every 4th draw.
- Fee cap 250 bps of yield, taken before the split. Crank tip cap 50 bps of the prize being paid, hardcoded.

At 5%, $1m USDC is about $960 a week before the split. Below $250k, organic yield is not a product. `sponsor_prize` is the cold-start. Optional later: match sponsor deposits 1:1 from the fee reserve, capped per draw, so a partner can buy a visible week without buying shares.

Cross-chain CCTP into Aave or Morpho is a phase-3 adapter behind the same receipt interface, and only if a Solana venue cannot fill withdraws. It is not how v1 gets a bigger number.

Success conditions, measurable: weekly prize above `min_prize` for four draws, withdraw success in one transaction above 95% by count, cancel unused because reveal landed inside the timeout, no shortfall. If those fail, the app goes withdraw-only on purpose instead of pretending.

## 2. Atomic requirements

- R-01. The protocol shall initialize Config once, signed by the upgrade authority, with the adapter allowlist.
- R-02. The protocol shall store admin, treasury, Switchboard program id, fee bps, min prize, and buffer target on Config.
- R-03. The protocol shall reject fee bps above 250 and crank tip bps above 50.
- R-04. The protocol shall nominate a new admin only when the current admin signs.
- R-05. The protocol shall accept admin only when the nominated key signs.
- R-06. The protocol shall create one Vault per mint with a principal ATA, a prize ATA, a grand ATA, and a receipt ATA, all owned by the vault PDA.
- R-07. The protocol shall mint shares 1:1 against principal on deposit, after a 1_000 dead-share offset on the first deposit.
- R-08. The protocol shall append that deposit's range at `share_supply` and then increase supply.
- R-09. The protocol shall set `eligible_after` to the current slot plus one.
- R-10. The protocol shall send deposited USDC to the idle buffer, then to the adapter only above the buffer target.
- R-11. The protocol shall ignore token-account donations when computing the share price.
- R-12. The protocol shall swap-remove a withdrawing deposit with the tail deposit so ranges stay contiguous.
- R-13. The protocol shall refuse withdraw while a draw is Committed.
- R-14. The protocol shall fill a withdraw from the idle buffer first.
- R-15. The protocol shall open a WithdrawTicket instead of failing when the adapter cannot fill the rest.
- R-16. The protocol shall keep a ticket as a liability against principal until `claim_withdraw` pays it.
- R-17. The protocol shall harvest only `receipt_value - principal_assets - tickets` into the prize and grand ATAs.
- R-18. The protocol shall set Shortfall and refuse harvest and commit when that remainder is negative.
- R-19. The protocol shall take the fee from harvested yield only.
- R-20. The protocol shall accept a sponsor transfer into the prize ATA and mint no shares.
- R-21. The protocol shall commit a draw only when the weekly prize is at least `min_prize` and status is Open.
- R-22. The protocol shall snapshot `share_supply` and the randomness account on the Draw.
- R-23. The protocol shall settle only the Deposit whose snapshotted range contains the winning index.
- R-24. The protocol shall pay that deposit's owner from the prize ATA, plus the grand ATA on every 4th settle.
- R-25. The protocol shall pay the crank tip to the settle fee payer, capped.
- R-26. The protocol shall cancel a committed draw after the reveal timeout without moving principal.
- R-27. The protocol shall apply an adapter change only from the allowlist and only after one epoch.
- R-28. The protocol shall let admin pause deposits and commits without blocking withdraw, claim, settle, or cancel.
- R-29. The protocol shall emit an event on every mutation above.

## 3. Actors and signers

| Actor | Signs | Does not sign |
| --- | --- | --- |
| Depositor | deposit, request_withdraw, claim_withdraw | payout |
| Sponsor | sponsor_prize, as payer | none |
| Admin | nominate, set_params, queue_adapter, pause | principal transfer |
| Nominated admin | accept_admin | none |
| Upgrade authority | initialize | later instructions |
| Anyone | harvest, commit_draw, settle_draw, cancel_draw | destination choice |
| Treasury | nothing | receives fee |
| Switchboard | nothing on-chain | reveal into the stored account |
| Adapter | nothing | CPI callee, id must match allowlist |

## 4. Account map

| Account | Owner | Purpose |
| --- | --- | --- |
| Config | program | admin, pending admin, treasury, switchboard program, allowlist, fee, tip, min prize, buffer bps, paused |
| Vault | program | mint, receipt mint, principal_assets, share_supply, tickets_outstanding, draw_index, status, bump |
| Deposit | program | owner, shares, range_start, eligible_after, bump |
| Draw | program | status, commit_slot, seed_slot, randomness account, supply_snapshot, prize_locked, grand_locked |
| WithdrawTicket | program | owner, assets, filled |
| Principal / prize / grand ATAs | token program | idle USDC, weekly prize, rolling grand |
| Receipt ATA | token program | adapter shares owned by the vault PDA |

## 5. PDA seeds

Bump stored, re-derived, never taken from the instruction.

- `["config"]`
- `["vault", mint]`
- `["deposit", vault, owner]`
- `["draw", vault, draw_index_le]`
- `["ticket", vault, owner]`

One Deposit per owner per vault. A second deposit adds to the tail range. draw_index increments on settle and cancel.

## 6. Instruction set

| Instruction | Owner of the transition |
| --- | --- |
| initialize | Creates Config and the allowlist. |
| nominate_admin / accept_admin | Rotates admin. |
| set_params | Writes fee, min prize, buffer bps, all clamped. |
| queue_adapter / apply_adapter | Nominates, then after one epoch copies an allowlisted id. |
| create_vault | Creates Vault and the four ATAs. |
| deposit | Mints the tail range, pulls USDC, tops up the adapter above the buffer. |
| request_withdraw | Burns the range via swap-remove, pays from buffer or opens a ticket. |
| claim_withdraw | Fills an open ticket from the adapter. Does not mint shares. |
| harvest | Splits positive yield into prize, grand, and fee. Sets Shortfall otherwise. |
| sponsor_prize | Moves USDC into the prize ATA. |
| commit_draw | Snapshots supply and the Switchboard account. Locks the prize figure. |
| settle_draw | Checks one Deposit range, pays owner and crank. |
| cancel_draw | Unlocks withdraws after timeout. |
| pause | Flips the flag. |

## 7. State machine

`Open -> Committed -> Open` on settle. `Committed -> Open` on cancel. `Open -> Shortfall` on a negative harvest, and `Shortfall -> Open` only when a later harvest reads value at or above liabilities. Pause is a flag, not a state. WithdrawTicket is `Open -> Paid`.

## 8. CPI plan

Token program via `TokenInterface`, `transfer_checked`. Switchboard program id equality-checked; randomness account address equality-checked. Adapter program id equality-checked against the live allowlisted id. No remaining-account program ids. No Jupiter in v1. No bridge.

## 9. Token plan

USDC in. Internal shares, not a new mint, so there is no permanent delegate. Receipt mint is the adapter's existing share mint, stored and checked. Metaplex Core receipt deferred. No Token-2022 transfer fee.

## 10. Security

See the threat model. Owner and signer checks, canonical bumps, checked arithmetic, u128 mul-div, rounding toward the vault, dead shares, no arbitrary CPI, init gated, terminal draw accounts not reused, events on every mutation. Upgrade authority to Squads before mainnet. UI must not say risk-free.

## 11. Stack

Anchor 0.32.x to match the deployed Cryptoball toolchain. LiteSVM for conservation and the negative list in the threat model. `@solana/kit` for new client code. Existing web3.js app can call the new instructions.

## 12. Traceability

| Req | Instruction |
| --- | --- |
| R-01 to R-05, R-27, R-28 | initialize, nominate, accept, queue/apply, pause, set_params |
| R-06 | create_vault |
| R-07 to R-11 | deposit |
| R-12 to R-16 | request_withdraw, claim_withdraw |
| R-17 to R-19 | harvest |
| R-20 | sponsor_prize |
| R-21 to R-25 | commit_draw, settle_draw |
| R-26 | cancel_draw |
| R-29 | event on each |

## 13. MVP cut

In: USDC, fake adapter, buffer, two-bucket prize, sponsor, O(1) settle, two-step withdraw, Switchboard, pause.

Deferred: SOL/jitoSOL vault, CCTP, tier counts beyond two, sponsor matching, Core NFT, 5-of-69 payout, auto-rotation across Kamino and Jupiter.

## 14. Implementation order

1. Sign off this file and the threat model.
2. Fake adapter that accrues a fixed bps and can be told to shortfall or to partial-fill.
3. Config, vault, deposit, swap-remove withdraw, conservation test.
4. Harvest, sponsor, shortfall.
5. Commit, settle, cancel, crank tip, range negative tests.
6. Ticket path.
7. One devnet Kamino Earn vault, variable reserves only.
8. Frontend with venue-risk copy and a prize countdown. Withdraw-only switch if shortfall lasts a day.
