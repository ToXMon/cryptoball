# Cryptoball architecture (Phase 2, gate G2)

Status: **draft for captain sign-off.** Requirements come first: this document implements `docs/requirements.md` (88 atomic requirements, ids `R-xx`). Risk level (companion `skills/safe-solana-builder`): **Critical** (custody vault, CPI to randomness provider and Core, admin keys). Devnet only, play money.

Companion files relied on: `PRINCIPLES.md` Parts A to D (threat questions, checklist, FYEO recurring findings, stack defaults), `knowledge/process/architecture-diagramming.md` (reference table, one owner per transition, traceability, MVP cut), `skills/solana-architect/SKILL.md` (the 14 required outputs, mapped in section 15), `examples/requirements/LEASH-atomic-requirements.md` (format), `knowledge/cohort/nfts-metaplex-core.md:41` (Anchor and mpl-core version caveat).
Other inputs: runbook `report.md`, `research-and-decisions.md` and `requirements-v0.2.md` (corrections win over chain-facts), chain-facts `report.md` (choices kept, details corrected), design `report.md` (frontend), and the 9 diagrams `docs/diagrams/D1..D9.svg` (adapted from the v0.2 pack: SOL instead of USDC, English, bonus ball, sponsor deferred).

## 1. Use-case summary

A weekly-shaped, raffle-style lottery. An admin creates a **campaign** with a close time. Players buy tickets with SOL (0.1 SOL placeholder): each ticket records 5 numbers from 1 to 69 plus a Cryptoball bonus ball from 1 to 26, and mints a Metaplex Core NFT receipt. After close, anyone commits a Switchboard On-Demand randomness request; later anyone settles with the revealed value. Settlement picks **one winning ticket**, pays 10 percent to the treasury and the rest to the winning ticket's buyer wallet in the same transaction. Nobody claims. If the draw cannot complete, anyone cancels and anyone refunds each ticket to its buyer.

Picked numbers are recorded on the ticket and NFT but do **not** decide the winner under the captain-decided raffle rule (section 7). The UI must say so.

## 2. Diagram index (one diagram per state change)

| Diagram | File | Covers |
|---|---|---|
| D1 overview | `docs/diagrams/D1-overview.svg` | Actors, client, services, program, third parties, flows |
| D2 accounts | `D2-accounts.svg` | Account map, seeds, pinned ids |
| D3 state machine | `D3-state-machine.svg` | Campaign and Ticket states, guards, owners |
| D4 buy_ticket | `D4-buy-ticket.svg` | Ticket absent to Active |
| D5 commit_draw | `D5-commit-draw.svg` | Open to DrawCommitted |
| D6 settle_draw | `D6-settle-draw.svg` | DrawCommitted to Settled, automatic payout |
| D7 cancel_campaign | `D7-cancel-campaign.svg` | Open or DrawCommitted to Cancelled |
| D8 refund_ticket | `D8-refund-ticket.svg` | Ticket Active to Refunded |
| D9 admin config | `D9-admin-config.svg` | initialize, update_config, nominate, accept |

Each diagram and each table row below cites `R-xx` ids; the full two-way map is `docs/requirements.md` section 5 and section 14 here.

## 3. Actors and signers (companion Part B Q1)

| Actor | Role | Signs |
|---|---|---|
| Player / buyer | Direct actor, payout and refund beneficiary | `buy_ticket` only; never a payout |
| Admin | Config authority, creates campaigns | `update_config`, `nominate_admin`, `create_campaign` |
| Nominated admin | Takes over the admin role | `accept_admin` |
| Upgrade authority | Deployer of the program | `initialize` only |
| Keeper / anyone | Permissionless liveness | Fee payer on commit_draw, settle_draw, cancel_campaign, refund_ticket; chooses no destination |
| Treasury | Stakeholder (wallet) | Does not sign; address stored in Config |
| Switchboard oracle (TEE) | Third party | Writes the revealed value to the randomness account; signs none of our instructions |
| Core program, System program | CPI targets | Campaign PDA or vault PDA sign through seeds |

No unlisted signer exists. The winner signs nothing at any point.

## 4. Account map and PDA design

All program-owned accounts carry the Anchor 8-byte discriminator. Bumps are stored at init and passed as `bump = account.bump` afterwards; the program never calls `find_program_address` on a user path (R-72). Global vs per-instance state is marked.

| Account | Owner | Seeds | Scope | Fields (see `programs/cryptoball/src/state.rs`) | Mutated only by |
|---|---|---|---|---|---|
| Config | cryptoball | `["config"]` | global | admin, pending_admin, treasury, fee_bps, paused, bump | initialize, update_config, nominate_admin, accept_admin |
| Campaign | cryptoball | `["campaign", id u64 LE]` | per draw | id, price_lamports, close_ts, max_tickets, ticket_count, fee_bps (snapshot), state, collection, rand_account, seed_slot, committed_at, randomness[32], winning_index, winner, bump, vault_bump | create_campaign, buy_ticket (count), commit_draw, settle_draw, cancel_campaign |
| Ticket | cryptoball | `["ticket", campaign, index u32 LE]` | per ticket | campaign, index, buyer, numbers[5], bonus, asset, status, bump | buy_ticket (create), refund_ticket (status) |
| Vault | System program | `["vault", campaign]` | per draw | lamports only (0 data bytes); owned by the system program, so the program signs transfers out with the vault seeds | buy_ticket (credit), settle_draw and refund_ticket (debit) |
| Core collection | Metaplex Core | keypair signer at create | per draw | update authority = Campaign PDA | create_campaign (CPI) |
| Core asset (ticket NFT) | Metaplex Core | fresh keypair signer at buy | per ticket | owner = buyer; collection; Attributes n1..n5, bonus | buy_ticket (CPI) |
| Randomness account | Switchboard On-Demand | keypair created by the keeper through the Switchboard SDK | per draw | read-only for us | Switchboard commit and reveal |
| Treasury | System program | n/a | global | a plain wallet; address equals `Config.treasury` | receives the fee |
| Faucet | cryptoball | `["faucet-v2"]` | global | dispensed (total ever paid out), pool_lamports (admin-set budget); created ONLY by initialize_faucet | initialize_faucet (create), claim_sol (dispensed), update_faucet_pool (pool_lamports) |
| Faucet vault | System program | `["faucet-vault"]` | global | lamports only; funded by a plain transfer from the deploy wallet | claim_sol (debit only) |
| ClaimRecord | cryptoball | `["claim", claimer]` | per wallet | claimer, claimed (lifetime total) | claim_sol |

Account space uses `InitSpace`; no `Vec` fields exist, so there are no unbounded collections (FYEO dos-resource). Ticket index equals `ticket_count` at purchase, so indexes are dense `0..count-1` and the winning index maps straight to a PDA.

The one `find_program_address` call in the program is the devnet faucet vault (`claim_sol`), whose vault account carries no bump of its own to read. No lottery path recomputes a PDA: every lottery PDA is seeds plus a stored bump (R-72).

**Why the vault is a bare system PDA.** The captain chose SOL. A zero-data system-owned PDA needs no token-account validation surface (mint, owner, delegate, close authority all disappear) and is trivially read from a public account (R-61). Rent: the first credit is the ticket price, which the floor constant keeps above the 890,880 lamport rent-exempt minimum for a zero-data account. The vault drains to zero at settlement or after the last refund, which is allowed.

## 5. Instruction set (companion Part B Q2: one owner per transition)

Legend: S = signer, W = writable. "Payer" S+W pays rent. Every account not in the PDA table is validated by an explicit address or owner constraint. `programs/cryptoball/src/lib.rs` carries these as stubs.

| # | Instruction | Args | Accounts | Preconditions and effects | Reqs |
|---|---|---|---|---|---|
| 1 | `initialize` | treasury, fee_bps | upgrade_authority S+W, config W (init), program, program_data, treasury, system | `upgrade_authority == program_data.upgrade_authority_address`; `fee_bps <= MAX_FEE_BPS`; treasury holds at least the rent-exempt minimum; admin := signer; emit ConfigChanged | R-01..R-06, R-51, R-76 |
| 2 | `update_config` | fee_bps?, treasury?, paused? | admin S, config W, treasury? | `has_one = admin`; same bounds as initialize; emit ConfigChanged. Does not touch live campaigns (fee is snapshotted) | R-06..R-10, R-51, R-76 |
| 3 | `nominate_admin` | nominee | admin S, config W | `has_one = admin`; sets pending_admin; emit | R-11, R-76 |
| 4 | `accept_admin` | none | nominee S, config W | `pending_admin == Some(nominee)`; admin := nominee; pending := None; emit | R-12, R-76 |
| 5 | `create_campaign` | id, price_lamports, close_ts, max_tickets | admin S+W (payer), config, campaign W (init), collection S+W, core_program, system | `price >= MIN_TICKET_PRICE`; `close_ts > now`; `0 < max_tickets <= MAX_TICKETS`; fee_bps := Config.fee_bps; CPI Core `CreateCollectionV2` (update authority = Campaign PDA); state Open, count 0; emit | R-13..R-19, R-77 |
| 6 | `buy_ticket` | numbers[5], bonus | buyer S+W, config, campaign W, ticket W (init), asset S+W, collection W, vault W, core_program, system | Open; `now < close_ts`; not paused; `count < max`; numbers strictly ascending in 1..=69; bonus in 1..=26; system transfer price buyer to vault; init Ticket (index = count); CPI Core `CreateV2` (owner = buyer, collection, Attributes); count += 1 checked; emit TicketPurchased; atomic | R-21..R-34, R-88 |
| 7 | `commit_draw` | none | payer S, campaign W, randomness (read) | Open; `now >= close_ts`; `count > 0`; randomness owner == pinned Switchboard devnet id; parsed `seed_slot == clock.slot - 1`; not yet revealed; store key, seed_slot, committed_at; state DrawCommitted; emit. Same tx must contain Switchboard's commit instruction | R-37..R-42 |
| 8 | `settle_draw` | none | payer S+W, config, campaign W, randomness (read), ticket (read), vault W, treasury W, winner_wallet W (= ticket.buyer), system | DrawCommitted; randomness key and seed_slot equal stored; `get_value(clock.slot)` succeeds (so reveal ran in the same tx, otherwise revert); `winner::winning_index`; supplied Ticket is the PDA for that index and `winner_wallet == ticket.buyer`; fee/prize math; two PDA-signed system transfers; store randomness, index, winner; state Settled; emit | R-43..R-54, R-78 |
| 9 | `cancel_campaign` | none | payer S, campaign W | (Open, `now >= close_ts`, count 0) or (DrawCommitted, `now > committed_at + REVEAL_TIMEOUT_SECS`); state Cancelled; emit | R-55, R-56, R-60 |
| 10 | `refund_ticket` | none | payer S, campaign, ticket W, vault W, buyer_wallet W (= ticket.buyer), system | Cancelled; ticket Active; PDA-signed transfer of `campaign.price` to buyer; status Refunded; emit | R-58, R-59, R-79, R-80 |
| 11 | `initialize_faucet` | pool_lamports, starting_dispensed | admin S+W (payer), config, faucet W (init), faucet_vault W, system | `has_one = admin`; `0 < pool_lamports <= INITIAL_POOL_LAMPORTS`; `starting_dispensed <= pool_lamports`; creates the ONLY faucet ledger; emit FaucetConfigured. DEVNET ONLY (D10) | - |
| 12 | `update_faucet_pool` | pool_lamports | admin S, config, faucet W | `has_one = admin`; `pool_lamports >= faucet.dispensed`; this is what makes a refill restore service. DEVNET ONLY | - |
| 13 | `claim_sol` | amount | claimer S+W, claim_record W (init_if_needed), faucet W, faucet_vault W, system | Ledger already exists - NO creation path; `0 < amount <= MAX_CLAIM_LAMPORTS`; `claimed + amount <= MAX_CLAIM_LIFETIME_LAMPORTS`; `dispensed + amount <= faucet.pool_lamports`; vault keeps its rent-exempt minimum; PDA-signed transfer to the SIGNER; emit SolClaimed. DEVNET ONLY | - |

Pause (R-09, R-10) is a Config flag read only by `buy_ticket`; commit, settle, cancel and refund ignore it (R-87), so funds can never be trapped by a paused or lost admin.

There is no `close_campaign`: settled and cancelled accounts remain as public receipts (out of scope, requirements section 4). The task brief listed it; it is the one instruction from the brief not built, deliberately.

Fee and prize math (R-48, R-71): `pool = price * ticket_count` as checked u64 (ledger, not vault balance, so stray donations cannot move the split); `fee = (pool as u128 * fee_bps as u128 / 10_000) as u64` (floor); `prize = pool - fee`. Both transfers are signed with the vault seeds `["vault", campaign, vault_bump]`. Surplus lamports sent to the vault by third parties stay there (known issue, section 12).

## 6. State machine (D3)

```
Campaign:  (absent) --create_campaign--> Open --commit_draw--> DrawCommitted --settle_draw--> Settled (absorbing)
                                          |                        |
                                          +--cancel_campaign-------+--> Cancelled (absorbing)
Ticket:    (absent) --buy_ticket--> Active --refund_ticket--> Refunded (absorbing)
```

| Transition | Single owning instruction | Guard |
|---|---|---|
| absent to Open | create_campaign | admin; price, close_ts, max_tickets bounds |
| Open to DrawCommitted | commit_draw | now >= close_ts; count > 0; fresh Switchboard randomness |
| DrawCommitted to Settled | settle_draw | key and seed match; revealed; ticket PDA = derived index |
| Open to Cancelled | cancel_campaign | now >= close_ts; count 0 |
| DrawCommitted to Cancelled | cancel_campaign | now > committed_at + REVEAL_TIMEOUT_SECS |
| Ticket absent to Active | buy_ticket | Open; before close; not paused; not sold out |
| Ticket Active to Refunded | refund_ticket | campaign Cancelled; once |
| Config absent to present; fee, treasury, pause; pending_admin; admin rotation | initialize; update_config; nominate_admin; accept_admin | upgrade authority; admin; admin; nominee |

Settled and Cancelled have no outgoing transition (R-57). A settled campaign's other tickets stay Active: only the winner is paid. Sales close at `close_ts` and the draw is committed after it, so nobody can buy knowing the randomness (R-37).

## 7. Winner determination: the swappable unit

**Contract.** `programs/cryptoball/src/winner.rs` is the only module that decides who wins. Today it exposes `winning_index(revealed: &[u8; 32], ticket_count: u32) -> Result<u32>` and implements (R-46): `u128::from_le_bytes(revealed[0..16]) % ticket_count`. Modulo bias for a uniform 128-bit value and N up to 2^32 is below N/2^128, about 1e-29, so no rejection loop is needed. (This replaces the chain-facts `derive_lottery_numbers` sketch, which used a wrong rejection bound and an unneeded 5-of-69 number draw.) Phase 3 adds a known-vector unit test and a distribution test.

**Why one winner, always settles.** With 5-of-69 plus a bonus ball, most draws would have no exact-match ticket. The captain chose the raffle rule: a draw always settles, always pays one wallet, fits one transaction, needs no tally pass.

**The swap (documented upgrade, not built): faithful jackpot-only.** Replace `winner.rs` and the payout step of `settle_draw`:

| Piece | Raffle (now) | Jackpot-only (later) |
|---|---|---|
| Drawn value | 1 index | 5 numbers (unbiased range reduction without replacement) plus bonus 1..=26, stored in Campaign |
| Winner(s) | the ticket at the index | every ticket whose 5 numbers (and bonus per the chosen rule) match; needs a bounded tally of candidates, so winners are discovered off-chain and proven on-chain per ticket |
| Settlement | one tx pays everything | `settle_draw` stores the drawn numbers and flips to Settled; a permissionless `payout_ticket` pays each matching ticket pro rata to `ticket.buyer` (the runbook C3 design), with a no-winner path (rollover or refund) |
| Ticket status | Active only | adds Paid |
| Unchanged | create, buy, commit, cancel, refund, config, vault, NFT mint | |

Everything outside `winner.rs` and `settle_draw` stays as designed. The numbers a player picks are already stored (ticket and NFT), so the upgrade needs no data migration.

## 8. CPI plan (companion Part B Q3: what the attacker controls)

| CPI | From | To | Signer | Program id (pinned in `constants.rs`, checked by `Program<>` or address constraint, never read from accounts) |
|---|---|---|---|---|
| `CreateCollectionV2` | create_campaign | Metaplex Core | collection keypair (client), Campaign PDA as update authority via `invoke_signed` where required | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` (verified executable on devnet) |
| `CreateV2` + Attributes | buy_ticket | Metaplex Core | asset keypair (client), buyer as payer and owner, Campaign PDA as collection update authority | same |
| System `transfer` | buy_ticket | System | buyer | `11111111111111111111111111111111` |
| System `transfer` x2 | settle_draw | System | vault PDA seeds | same |
| System `transfer` | refund_ticket | System | vault PDA seeds | same |
| Read only | commit_draw, settle_draw | Switchboard randomness account | none | devnet `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2` (verified executable on devnet; mainnet `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv`, out of scope) |

The Switchboard commit and reveal instructions are **not CPI'd** by our program: they sit beside ours in the same transaction (client or keeper builds `[commitIx, commit_draw]` and `[revealIx, settle_draw]`), which is what lets `get_value(clock.slot)` succeed. The chain-facts "callback" and "BLS proof" description was wrong: Switchboard randomness is TEE commit/reveal (research-and-decisions section 1). Marketing copy must not say "mathematically provable".

## 9. Token and asset plan

| Item | Choice | Note |
|---|---|---|
| Entry asset | Native SOL, lamports | Captain decision. No mint, no ATA, no token program anywhere; `transfer_checked` and Token-2022 concerns do not apply |
| Ticket NFT | Metaplex Core asset, one per ticket, in a per-campaign collection | Owner = buyer, **a receipt, transferable**. Payout reads `Ticket.buyer`, never the NFT owner (runbook C4). Attributes `n1..n5`, `bonus`; name `Cryptoball #<index>`; ASCII keys; uri is a static metadata file, never trusted |
| Excluded | Compressed NFTs, Token Metadata, USDC | Nothing in the MVP needs them |

## 10. Recommended stack and verified pins (spike results, 2026-10-02)

| Piece | Pin | Evidence |
|---|---|---|
| Anchor | `anchor-lang = "=0.32.1"`; CLI 0.32.1 per `Anchor.toml` (installed locally: avm has 0.32.1 available; the machine default is 0.30.1, so run `avm use 0.32.1`) | Only version inside every dependency's range (mpl-core `anchor` feature supports `^0.31.1` and `^0.32.1`). Anchor 1.2.0 is stable but mpl-core cannot target it |
| mpl-core | `=0.12.1`, `default-features = false`, `features = ["anchor-0-32"]` | Default features include `borsh-v1`, which is mutually exclusive with `anchor` in `kaigan`. Disabling defaults fixes `cargo check` |
| switchboard-on-demand | `=0.13.0`, `default-features = false`, `features = ["solana-v2", "devnet"]` | The crate's `anchor` feature fails to compile with Anchor 0.32.1 / 0.31.1 (conflicting `AnchorDeserialize` impls and missing `solana_program::sysvar` modules, reproduced on 0.11.3, 0.12.1, 0.13.0). `solana-v2` works with `cargo check`, `cargo test` and `cargo build-sbf`. The `devnet` feature bakes the devnet id at compile time; the crate's runtime `SB_ENV` check does not exist on-chain |
| Rust | stable for `cargo check/test`; `cargo build-sbf` (platform-tools v1.54, rustc 1.89.0) | Build succeeds. `build-sbf` prints stack-frame warnings from mpl-core's `Asset`/`Collection` deserializers (4.2 to 4.5 KB frames). Mitigation: use only the CPI builders and never deserialize Core accounts in the program. Re-check at B4b |
| Pinned ids test | `programs/cryptoball/src/constants.rs` test | Asserts our constants equal the ids shipped in the pinned crates: `cargo test` passes |
| Client | `@solana/web3.js` 1.98.0 and `@coral-xyz/anchor` 0.31.1 for the keeper (Switchboard TS SDK requires them); web app: React 19 + Vite + wallet-adapter | Matches Switchboard's version matrix |
| Tests | `ts-mocha` + chai in `tests/` (scaffolded); LiteSVM and devnet in phase 3 | `litesvm` 0.17.0 current on crates.io |
| Hosting | any static host | Not part of the evidence bundle |

Program id: the scaffold uses a freshly generated placeholder id; the keypair was not committed. Phase 3 runs `anchor keys sync` and records the real id in the README receipts table.

## 11. Threat model (companion Part B; runbook lottery seeds)

Part B answers:

1. **Actors and signers**: section 3. Every signer explicit.
2. **State and owners**: sections 4 to 6. Each transition has exactly one owning instruction (D3).
3. **What the attacker controls**: every passed account. Validation: owner program or `Program<>` for externals, seeds and stored bump for PDAs, address equality against stored or derived values for the treasury, the winner wallet, the randomness key and the Ticket. `UncheckedAccount` appears only for the Core asset, collection, treasury and winner/buyer wallets, each with a written `/// CHECK:` reason (phase 3).
4. **Blast radius of privileged keys**: admin can pause sales, set fee within the hard cap and change the treasury, and create campaigns. It **cannot** move vault funds, change a live campaign's price, fee or close time (R-20, R-77), change a draw, or block settle, cancel or refund (R-87). The upgrade authority can replace the program on devnet; that single-key limitation is a mainnet gate (multisig and timelock), recorded in `docs/known-issues.md` at phase 5.

Lottery and funds threats:

| # | Threat | Mitigation | Reqs | Negative test |
|---|---|---|---|---|
| T1 | Grinding or buying after seeing the result | Sales close at close_ts; commit only after; randomness requested after close; seed_slot freshness | R-23, R-37, R-40 | buy at close_ts fails; stale seed_slot fails |
| T2 | Fake randomness account (FYEO-BANGER-03) | Owner must equal the pinned devnet Switchboard id; discriminator and size via `parse` | R-39, R-73 | right-size fake account fails |
| T3 | Swapped or stale randomness at settle (FYEO-WAT-07, WAT-10) | Stored key and seed_slot compared; `get_value(clock.slot)` rejects anything not revealed this slot | R-44, R-45, R-78 | swapped account; settle before reveal fail |
| T4 | Advisory randomness (value computed but not used) | The stored `randomness` is the input of `winning_index`; one function, one test vector | R-46, R-52 | known vector gives known index |
| T5 | Committer sees the reveal off-chain and declines to settle, or settler front-runs | Settle is permissionless; no re-commit instruction; cancel plus refund after timeout. Accepted residual risk: aborting costs the draw but gains nothing | R-43, R-56, R-58 | commit twice fails; cancel before timeout fails |
| T6 | Treasury redirection (FYEO-BANGER-02) | Fee goes only to `Config.treasury`; update is admin-only and bounded | R-49, R-08 | wrong treasury account fails |
| T7 | First-come initialize | Only the program upgrade authority may run it; Config seed is unique | R-01, R-02 | random signer fails; second init fails |
| T8 | Mid-sale parameter changes (FYEO-WAT-05) | No instruction mutates price, close_ts or fee after creation; fee snapshotted | R-20, R-77 | later Config fee change leaves campaign unchanged |
| T9 | Unbounded iteration | No loops over tickets; settle derives one index and takes one Ticket account | R-47, R-28 | n/a (structure) |
| T10 | NFT owner differs from buyer | Payout and refund read `Ticket.buyer` | R-50, R-58 | transferred NFT still pays the buyer |
| T11 | Payout destination chosen by caller | `winner_wallet`/`buyer_wallet` must equal `ticket.buyer` | R-50, R-58 | wrong destination fails |
| T12 | Double settle, double fee, double refund | State guards; Settled absorbing; Ticket Refunded | R-53, R-57, R-79 | each repeated call fails |
| T13 | Arithmetic overflow, rounding | Checked u64, u128 for the fee, floor | R-31, R-48, R-71 | boundary values fail, never wrap |
| T14 | Admin plays and times campaigns to bias | Admin cannot influence randomness or the index; accepted: admin may buy tickets (open lottery) | R-37, R-46 | n/a |
| T15 | Rent-exempt breakage on transfers to empty accounts | Price floor 2,000,000 lamports; treasury must hold the rent-exempt minimum when set | R-15, R-51 | price below floor fails |
| T16 | Arbitrary CPI target | Program ids pinned; typed `Program<>` | R-73 | attacker program id fails |
| T17 | Panics on user input | Typed errors, no `unwrap`/`expect` on user paths | R-72 | fuzzed inputs never abort |
| T18 | Faucet drains the lottery, or one wallet drains the faucet | The faucet vault PDA's derivation contains no campaign key, so `vault_pay` and every ticket/prize/refund path cannot reach it. Per-claim and per-wallet-lifetime ceilings are program constants, never instruction arguments; the pool budget is admin-set and hard-backed by the vault balance | - | `08_faucet.test.ts`: caps, wallet/vault separation, settlement unchanged |
| T20 | Faucet bricked by a squatted ledger PDA | The ledger and its vault are created only by the admin-signed `initialize_faucet`; `claim_sol` references the ledger with no `init`/`init_if_needed` path, so no user call can create, initialise or write it | D10 | `08_faucet.test.ts`: squat attempts leave the ledger bytes intact; claim fails before init, works after |
| T21 | Per-wallet claim record squatted | `ClaimRecord` stays `init_if_needed` because it is keyed by the claimer's own key: squatting one address costs 0.0009 SOL and can only deny that one wallet. Accepted for a devnet faucet; an admin close/re-init path is the upgrade if it ever matters | D10 | documented residual, untested |
| T19 | Faucet abused on a real-money deployment | Accepted for devnet, where SOL is worthless and unauthenticated. Mainnet gate: `claim_sol` and every constant under the faucet block must be deleted before a mainnet deploy, because there is no identity behind a wallet and the caps are Sybil-weak (many wallets = many caps) | D10 | n/a (deployment gate, not a test) |

## 12. Open risks and the spike gate

Unmeasured items (runbook G2.5 devnet spike, before phase 3 builds on them):

1. Transaction size and compute of `settle_draw` (Switchboard reveal accounts plus ours); may need an address lookup table.
2. Transaction size and compute of `buy_ticket` with Core `CreateV2` and Attributes; five tickets per checkout may need five transactions (R-36 stays; batching is a UX detail).
3. `commit_draw` must sit in the same transaction as Switchboard's commit; `settle_draw` with reveal.
4. Per-ticket rent for the Ticket and Core asset (the chain-facts numbers conflict); the 0.1 SOL placeholder price is far above any quoted figure.
5. Core `CreateCollectionV2`/`CreateV2` CPI under Anchor 0.32.1 (compiles; the `build-sbf` stack warnings need a runtime check).
6. Treasury rent: if the treasury wallet is later drained below the rent-exempt minimum, a sub-minimum fee transfer would fail and block settlement. Mitigation for phase 3: skip the fee transfer when `fee == 0` and treat a failed fee credit as an error only if the treasury balance is below the minimum; revisit with the lifecycle test (B9). Treasury is admin-set, so this is self-inflicted rather than an attacker path.

Known issues carried (go to `docs/known-issues.md`): single admin and upgrade key on devnet; surplus lamports donated to a vault stay there; Switchboard trust model is TEE plus slashing, not pure cryptography; picked numbers do not influence the winner; lottery licensing is out of scope for devnet play money (mainnet returns to the captain).

AI red-team and override log (G2): the pre-review findings 1 to 7 in `research-and-decisions.md` section 5 are all carried above (items 1 to 4 here, item 5 compile check done, item 6 resolved by the captain's raffle decision, item 7 covered by T10 and T11). Overrides against v0.2: USDC to SOL, Spanish to English, sponsor deferred, bonus ball added. A fresh-context red-team of this document is still due before phase 3 (runbook gate G2); the captain's override log lives in `docs/requirements.md` section 6.

## 13. Events (R-34, R-54, R-60, R-76, R-80)

`ConfigChanged`, `CampaignCreated`, `TicketPurchased`, `DrawCommitted`, `DrawSettled`, `CampaignCancelled`, `TicketRefunded`, plus the devnet faucet's `FaucetConfigured` and `SolClaimed` (`programs/cryptoball/src/events.rs`). Every state change emits one.

The faucet instructions (rows 11-13) carry no R-xx because `docs/requirements.md` is the frozen, machine-checked v0.2 pack and re-cutting it is a separate, deliberate act. They are specified here and in the README instead, and are devnet-only.

## 14. Traceability (both directions)

- **Requirement to element**: `docs/requirements.md` section 5.1 (every R-xx to at least one instruction, account, client piece or rule).
- **Element to requirement**: `docs/requirements.md` section 5.2 (every box in D1..D9 and every account, instruction and external program cites at least one R-xx; the deferred sponsor and on-ramp boxes are marked deferred).
- **Instruction to requirements**: the last column of section 5 here.

Result when generated: 88 requirements, 0 unmapped requirements, 0 unmapped elements.

## 15. Companion architect outputs, mapped

| # | Required output | Where |
|---|---|---|
| 1 | Atomic requirements | `docs/requirements.md` |
| 2 | Actor and signer map | section 3 |
| 3 | Use-case summary | section 1 |
| 4 | Account map | section 4, D2 |
| 5 | PDA design | section 4 |
| 6 | Instruction set | section 5 |
| 7 | State machine | section 6, D3 |
| 8 | CPI plan | section 8 |
| 9 | Token and asset plan | section 9 |
| 10 | Security considerations | section 11 |
| 11 | Recommended stack | section 10 |
| 12 | Traceability table | section 14 |
| 13 | MVP scope cut | section 16 |
| 14 | Implementation order | section 17 |

## 16. MVP scope cut

Built in the MVP: sections 5 to 8 as specified. Cut and why: see `docs/requirements.md` section 4 (Coinbase Commerce, sponsor, fiat, accounts, streaming, metaverse, multi-asset, tiers and rollover, `close_campaign`, admin UI, localisation, mainnet). Nothing in this document is absent from the PRD, the recorded decisions or an R-xx.

## 17. Implementation order (phase 3, one instruction at a time, tests after each)

| Step | Build | Reqs |
|---|---|---|
| B0 | Spike G2.5 (section 12) | measured numbers |
| B1 | initialize | R-01..R-06, R-51 |
| B2 | update_config, nominate_admin, accept_admin | R-06..R-12, R-76 |
| B3 | create_campaign (Core collection CPI) | R-13..R-19, R-77 |
| B4 | buy_ticket without the NFT, then with the Core mint | R-21..R-34, R-88 |
| B5 | cancel_campaign, refund_ticket (before the draw, so funds are never trapped) | R-55..R-60, R-79, R-80 |
| B6 | commit_draw | R-37..R-42 |
| B7 | settle_draw and `winner.rs` | R-43..R-54, R-78 |
| B8 | Lifecycle and conservation test (`vault_in = fee + prize`) on LiteSVM, then devnet | all |
| B9 | Keeper script, frontend (design report: Prime Time tokens, then 3D ticket and ball drop) | R-35, R-36, R-61..R-69, R-75, R-81..R-86, R-89 |
