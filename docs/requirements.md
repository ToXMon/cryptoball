# Cryptoball requirements (Phase 1, gate G1)

Status: **draft for captain sign-off** (human-first rule, `PRINCIPLES.md` Part C: this list is an AI draft the captain red-teams; overrides go in section 6).
Count: **88 atomic requirements** (IDs are stable; gaps are deliberate: R-70 is deferred, see section 4).

Lineage: the runbook's 73 drafts (`cryptoball-runbook/report.md` section 4.2) were superseded by the machine-checked v0.2 pack (87 requirements, `requirements-v0.2.md`). This file is v0.2 with every `[TBD-*]` resolved by the captain's recorded decisions (section 2). Net changes from v0.2: entry asset USDC to native **SOL** (no mint, no ATAs); **bonus ball** added (R-88, R-89); UI **English** (v0.2 assumed Spanish); fee/price/cap given devnet placeholder values; `[TBD-sponsor]` R-70 deferred.

Format: companion `examples/requirements/LEASH-atomic-requirements.md` (`ID | Requirement | Src | Where | Test`), atomicity rule from `knowledge/process/architecture-diagramming.md` Step 1 (one action, one state change, one account write or one CPI). Test = the negative test (what must fail) unless the row says "state assertion" or "happy path".
Atomicity exceptions kept on purpose (one account write or one property): R-13 R-29 R-30 R-33 R-41 R-52 R-57 R-61 R-71 R-73 R-83 (carried from v0.2, captain to confirm).

## 1. Actors and signers

| Actor | Role | Signs? |
|---|---|---|
| Player / buyer | Direct actor; buys tickets; payout and refund beneficiary | `buy_ticket` only. Never signs a payout or refund |
| Admin / operator | Config authority; creates campaigns; fee, treasury, pause | Admin instructions |
| Nominated admin | Accepts the admin role | `accept_admin` only |
| Upgrade authority | Only account allowed to run `initialize` | `initialize` only |
| Keeper / anyone | Permissionless: commit draw, settle, cancel, refund | Fee payer only; chooses no destination |
| Treasury | Stakeholder; receives the fee | Does not sign; wallet pinned in Config |
| Switchboard oracle (TEE) | Third party; writes the revealed randomness | Does not sign our instructions; program id pinned |
| Metaplex Core, System program | External CPI targets | Campaign / vault PDA sign via seeds |

## 2. Recorded decisions and constants (traceability to the captain's "defaults", 2026-10-02)

Economics are **devnet placeholders**, flagged as such, clamped at set-time by the hard caps in `programs/cryptoball/src/constants.rs`.

| ID | Decision | Value | Resolves | Requirements |
|---|---|---|---|---|
| D1 | Repository | private `ToXMon/cryptoball`, merge autonomy on | process | n/a |
| D2 | Payment | direct SOL payment inside the `buy_ticket` transaction (no Coinbase Commerce) | TBD-payment-rail | R-04 R-17 R-27 |
| D3 | Pick format | 5 distinct numbers 1..=69 plus 1 Cryptoball bonus ball 1..=26; up to 5 tickets per checkout; quick-pick | TBD-pick-format | R-21 R-25 R-26 R-88 R-35 R-36 |
| D4 | Entry price | 0.1 SOL (100_000_000 lamports), floor 2_000_000 | TBD-economics | R-15 |
| D5 | Winner rule | raffle-style, always settles, single winner per draw, one VRF-selected ticket; rule isolated in one unit (`winner.rs`); faithful jackpot-only is the documented upgrade | TBD-prize-tiers | R-46 R-47 |
| D6 | Campaign timing | per-campaign close timestamp (weekly shape; devnet campaigns may close in minutes) | TBD-campaign-model | R-13 R-14 R-23 R-37 |
| D7 | Randomness | permissionless settle consuming verified Switchboard On-Demand randomness | TBD-randomness | R-37..R-45 R-78 |
| D8 | Fee | 10 percent (1_000 bps), hard cap 20 percent (2_000), accrued in the vault, paid to treasury once at settlement | TBD-economics, runbook C6 | R-05 R-06 R-48 R-49 |
| D9 | Ticket cap | 1_000 tickets per campaign placeholder, hard cap 10_000 | TBD-economics | R-16 R-28 |
| D10 | Scope | devnet only, play money, English UI; mainnet returns to the captain | TBD / runbook C9 | R-66 R-74 R-82 |
| D11 | Deferred | Coinbase Commerce, live-streamed draws, metaverse, accounts, multi-asset campaigns | runbook section 7 | section 4 |

Reveal timeout before an unrevealed draw may be cancelled: 3_600 s placeholder (`REVEAL_TIMEOUT_SECS`).

## 3. Requirements


### A. Config and authority

| ID | Requirement | Src | Where | Test |
|---|---|---|---|---|
| R-01 | The protocol shall create one global Config account (seed "config") on initialize. | Runbook C-init; FYEO first-come init | on-chain | 2nd initialize fails |
| R-02 | The protocol shall reject initialize unless it is signed by the program upgrade authority. | Runbook C-init; FYEO first-come init | on-chain | random signer initialize fails |
| R-03 | The protocol shall store the treasury wallet address in Config at initialize. | PRD Overview (fees to internal wallet); Dec D8 fee; FYEO-BANGER-02 | on-chain | state assertion |
| R-04 | The protocol shall denominate ticket price, vault balance, fee and prize in native SOL (lamports); no token accounts exist. | Dec D4 SOL entry asset | on-chain | no token/ATA account appears in any instruction's account list |
| R-05 | The protocol shall store the fee in basis points in Config at initialize. | Dec D8 10% fee; FYEO bounds, WAT-05 | on-chain | state assertion |
| R-06 | The protocol shall reject any fee above MAX_FEE_BPS whenever the fee is set. | Dec D8 10% fee; FYEO bounds, WAT-05 | on-chain | fee = MAX+1 fails (init and update) |
| R-07 | The protocol shall allow the admin to update the fee. | Dec D8 10% fee; FYEO bounds, WAT-05 | on-chain | non-admin update fails |
| R-08 | The protocol shall allow the admin to update the treasury address. | PRD Admin features; PRINCIPLES Part B | on-chain | non-admin update fails |
| R-09 | The protocol shall allow the admin to pause ticket sales. | PRD Admin features; PRINCIPLES Part B | on-chain | non-admin pause fails |
| R-10 | The protocol shall allow the admin to resume ticket sales. | PRD Admin features; PRINCIPLES Part B | on-chain | non-admin resume fails |
| R-11 | The protocol shall allow the admin to nominate a new admin. | PRD Admin features; PRINCIPLES Part B | on-chain | non-admin nominate fails |
| R-12 | The protocol shall require the nominee's signature to accept the admin role. | PRD Admin features; PRINCIPLES Part B | on-chain | accept without nominee signature fails |
| R-51 | The protocol shall reject initialize and any treasury update when the treasury wallet holds less than the rent-exempt minimum for an empty account. | PRD Launch (automatic payout); Dec D8 | on-chain | empty treasury wallet fails (a tiny fee could not otherwise be credited) |
| R-76 | The protocol shall emit an event on every Config mutation. | PRD Admin features; PRINCIPLES Part B | on-chain | parse event on each mutation |
| R-87 | The protocol shall allow commit_draw, settle_draw, cancel_campaign and refund_ticket while sales are paused. | PRD Admin features; PRINCIPLES Part B | on-chain | commit/settle/cancel/refund succeed while paused |

### B. Campaign

| ID | Requirement | Src | Where | Test |
|---|---|---|---|---|
| R-13 | The protocol shall allow the admin to create a campaign with an id, ticket price, close timestamp and max tickets. | Dec D6 per-campaign close; Dec D9 ticket cap | on-chain | non-admin create fails |
| R-14 | The protocol shall reject campaign creation when the close timestamp is not in the future. | Dec D6 per-campaign close; Dec D9 ticket cap | on-chain | close_ts <= now fails |
| R-15 | The protocol shall reject campaign creation when the ticket price is zero. | Dec D6 per-campaign close; Dec D9 ticket cap | on-chain | price 0 fails |
| R-16 | The protocol shall reject campaign creation when max tickets is zero or above MAX_TICKETS. | Dec D6 per-campaign close; Dec D9 ticket cap | on-chain | max 0 and MAX+1 fail |
| R-17 | The protocol shall use a system-owned vault PDA (seeds "vault", campaign) per campaign, which only the program can sign for. | Dec D4 SOL entry asset | on-chain | transfer out of the vault without Campaign-seed signing fails |
| R-18 | The protocol shall create one Metaplex Core collection per campaign via CPI. | PRD Overview (NFT confirmation); chain-facts 2.1 | on-chain | wrong Core program id fails |
| R-19 | The protocol shall initialize the campaign in state Open with ticket count zero. | Dec D6 per-campaign close; Dec D9 ticket cap | on-chain | state assertion |
| R-77 | The protocol shall snapshot the Config fee into the Campaign at creation. | Dec D8 10% fee; FYEO bounds, WAT-05 | on-chain | later Config fee change leaves campaign unchanged |
| R-20 | The protocol shall expose no instruction that changes a campaign's price, fee or close time after creation. | Dec D6 per-campaign close; Dec D9 ticket cap | on-chain (review) | grep: no handler mutates price/fee/close_ts |

### C. Ticket purchase

| ID | Requirement | Src | Where | Test |
|---|---|---|---|---|
| R-21 | The protocol shall allow a buyer to purchase one ticket by supplying exactly five numbers and one Cryptoball bonus ball. | Dec D3 pick format; PRD Ticket selection | on-chain | happy path |
| R-22 | The protocol shall reject a purchase when the campaign is not Open. | PRD Overview (buy tx); Part B | on-chain | buy after DrawCommitted fails |
| R-23 | The protocol shall reject a purchase at or after the close timestamp. | PRD Overview (buy tx); Part B | on-chain | buy at close_ts fails |
| R-24 | The protocol shall reject a purchase while sales are paused. | PRD Overview (buy tx); Part B | on-chain | buy while paused fails |
| R-25 | The protocol shall reject any picked number outside 1..=69. | Dec D3 pick format; PRD Ticket selection | on-chain | 0 and 70 fail |
| R-26 | The protocol shall reject picked numbers that are not strictly ascending. | Dec D3 pick format; PRD Ticket selection | on-chain | [5,5,..] and [9,3,..] fail |
| R-88 | The protocol shall reject a bonus ball outside 1..=26. | Dec D3 pick format; PRD Ticket selection | on-chain | 0 and 27 fail |
| R-27 | The protocol shall transfer the ticket price in lamports from the buyer to the campaign vault with a system-program transfer. | Dec D4 SOL entry asset | on-chain | insufficient lamports fails; vault delta == price |
| R-28 | The protocol shall reject a purchase when the ticket count equals max tickets. | PRD Overview (buy tx); Part B | on-chain | ticket max+1 fails |
| R-29 | The protocol shall create a Ticket account derived from the campaign and ticket index. | PRD Overview (buy tx); Part B | on-chain | reused index fails |
| R-30 | The protocol shall store buyer, numbers, bonus ball, index and Core asset address in the Ticket. | PRD Overview (buy tx); Part B | on-chain | state assertion |
| R-31 | The protocol shall increment the campaign ticket count with checked arithmetic. | PRD Overview (buy tx); Part B | on-chain | count near u32::MAX fails |
| R-32 | The protocol shall mint one Core asset to the buyer with the numbers and bonus ball as an Attributes plugin. | PRD Overview (NFT confirmation); chain-facts 2.1 | on-chain | wrong Core id fails; attributes asserted |
| R-33 | The protocol shall complete payment, Ticket creation and asset mint atomically in one transaction. | PRD Overview (buy tx); Part B | on-chain | forced CPI failure -> vault+count unchanged |
| R-34 | The protocol shall emit a TicketPurchased event. | PRD Overview (buy tx); Part B | on-chain | parse event |
| R-35 | The client shall generate quick-pick numbers from a cryptographically secure random source in ascending order. | Dec D3 pick format; PRD Ticket selection | client | UI test |
| R-36 | The client shall allow at most five cartons per checkout. | Dec D3 pick format; PRD Ticket selection | client | UI test |

### D. Draw (Switchboard) and settlement

| ID | Requirement | Src | Where | Test |
|---|---|---|---|---|
| R-37 | The protocol shall allow anyone to commit the draw only at or after the close timestamp. | Dec D7 permissionless VRF; FYEO-BANGER-03, WAT-10 | on-chain | commit before close_ts fails |
| R-38 | The protocol shall reject commit_draw when the campaign has zero tickets. | Dec D7 permissionless VRF; FYEO-BANGER-03, WAT-10 | on-chain | commit with 0 tickets fails |
| R-39 | The protocol shall reject a randomness account not owned by the Switchboard On-Demand devnet program id pinned in the build. | Dec D7 permissionless VRF; FYEO-BANGER-03, WAT-10 | on-chain | fake randomness account (right size) fails |
| R-40 | The protocol shall reject a randomness account whose seed slot is not the previous slot or that is already revealed. | Dec D7 permissionless VRF; FYEO-BANGER-03, WAT-10 | on-chain | stale seed_slot / already revealed fails |
| R-41 | The protocol shall store the randomness account address and seed slot in the Campaign. | Dec D7 permissionless VRF; FYEO-BANGER-03, WAT-10 | on-chain | state assertion |
| R-42 | The protocol shall move the Campaign from Open to DrawCommitted on commit_draw. | Dec D7 permissionless VRF; FYEO-BANGER-03, WAT-10 | on-chain | commit twice fails |
| R-43 | The protocol shall allow anyone to settle only when the Campaign is DrawCommitted. | PRD Transparency Q; FYEO-WAT-07 | on-chain | settle before commit fails; settle twice fails |
| R-44 | The protocol shall reject settlement when the randomness account or seed slot differs from the stored values. | PRD Transparency Q; FYEO-WAT-07 | on-chain | swapped randomness account fails |
| R-45 | The protocol shall obtain the 32-byte revealed value from the randomness account. | PRD Transparency Q; FYEO-WAT-07 | on-chain | state assertion with known vector |
| R-78 | The protocol shall reject settlement when the randomness has not yet been revealed. | PRD Transparency Q; FYEO-WAT-07 | on-chain | settle before reveal fails |
| R-46 | The protocol shall derive the winning ticket index as the revealed value (u128) modulo the ticket count. | Dec D5 raffle winner rule | on-chain | known value -> known index; distribution test |
| R-47 | The protocol shall reject settlement unless the supplied Ticket account is the PDA for the derived index. | Dec D5 raffle winner rule | on-chain | wrong Ticket account fails |
| R-48 | The protocol shall compute the fee as pool times fee bps over 10,000, rounded down, with checked u128 math. | PRD Launch (automatic payout); Dec D8 | on-chain | overflow price*count fails; rounding vector |
| R-49 | The protocol shall transfer the fee from the vault to the treasury wallet stored in Config. | PRD Overview (fees to internal wallet); Dec D8 fee; FYEO-BANGER-02 | on-chain | wrong treasury account fails; second fee transfer impossible |
| R-50 | The protocol shall transfer the remaining pool from the vault to the winning ticket's buyer wallet. | PRD Launch (automatic payout); Dec D8 | on-chain | destination != Ticket.buyer fails |
| R-52 | The protocol shall store the revealed value, winning index and winner in the Campaign. | PRD Transparency Q; FYEO-WAT-07 | on-chain | state assertion |
| R-53 | The protocol shall move the Campaign from DrawCommitted to Settled exactly once. | PRD Transparency Q; FYEO-WAT-07 | on-chain | second settle fails |
| R-54 | The protocol shall emit a DrawSettled event. | PRD Transparency Q; FYEO-WAT-07 | on-chain | parse event |

### E. Recovery

| ID | Requirement | Src | Where | Test |
|---|---|---|---|---|
| R-55 | The protocol shall allow anyone to cancel an Open campaign with zero tickets after its close timestamp. | Runbook C3/E (funds never trapped) | on-chain | cancel with tickets (not stuck) fails |
| R-56 | The protocol shall allow anyone to cancel a DrawCommitted campaign after the reveal timeout has elapsed. | Runbook C3/E (funds never trapped) | on-chain | cancel before timeout fails |
| R-57 | The protocol shall treat Settled and Cancelled as absorbing states. | Runbook C3/E (funds never trapped) | on-chain | every ix on terminal state fails except refund |
| R-58 | The protocol shall allow anyone to refund one Ticket's price from the vault to its stored buyer wallet on a Cancelled campaign. | Runbook C3/E (funds never trapped) | on-chain | refund on Settled/Open fails; wrong destination fails |
| R-59 | The protocol shall mark a refunded Ticket Refunded. | Runbook C3/E (funds never trapped) | on-chain | state assertion |
| R-79 | The protocol shall reject a second refund of the same Ticket. | Runbook C3/E (funds never trapped) | on-chain | second refund fails |
| R-60 | The protocol shall emit an event on campaign cancellation. | Runbook C3/E (funds never trapped) | on-chain | parse event |
| R-80 | The protocol shall emit an event on ticket refund. | Runbook C3/E (funds never trapped) | on-chain | parse event |

### F. Client, keeper and transparency

| ID | Requirement | Src | Where | Test |
|---|---|---|---|---|
| R-61 | The protocol shall keep campaign, ticket, winner, randomness value and vault balance readable from public accounts without our API. | PRD Checking results / Transparency Q | on-chain (review) | decode accounts with IDL only |
| R-62 | The client shall list campaigns with their prize pool. | PRD Checking results / Transparency Q | client | UI test |
| R-81 | The client shall show a countdown to each campaign's close time. | PRD Checking results / Transparency Q | client | UI test |
| R-63 | The client shall let a user look up tickets by wallet address or purchase signature. | PRD Checking results / Transparency Q | client | UI test |
| R-64 | The client shall show the winning ticket and its numbers on the results page. | PRD Checking results / Transparency Q | client | UI test |
| R-84 | The client shall link the results page to the randomness account on the Explorer. | PRD Checking results / Transparency Q | client | UI test |
| R-65 | The client shall connect a wallet through wallet-adapter (Phantom first). | PRD Wallet integration; Dec D10 devnet, English | client | UI test |
| R-66 | The client shall show a devnet banner. | PRD Wallet integration; Dec D10 devnet, English | client | UI test |
| R-82 | The client shall block transactions when the wallet cluster is not devnet. | PRD Wallet integration; Dec D10 devnet, English | client | UI test |
| R-67 | The client shall refetch on-chain state after every confirmed transaction. | PRD Wallet integration; Dec D10 devnet, English | client | UI test |
| R-68 | The client shall present all user-facing text in English (MVP; localisation is follow-up work). | PRD Wallet integration; Dec D10 devnet, English | client | UI test: no untranslated keys |
| R-83 | The client shall format money, numbers and dates through Intl (en-US). | PRD Wallet integration; Dec D10 devnet, English | client | UI test |
| R-69 | The client shall map every program error code to an English message. | PRD Wallet integration; Dec D10 devnet, English | client | UI test: every CryptoballError variant has copy |
| R-89 | The client shall display the entry price (0.1 SOL), the 10 percent fee and a 'devnet play money' notice at checkout. | PRD Wallet integration; Dec D10 devnet, English | client | UI test |
| R-75 | The keeper script shall call commit_draw once a campaign has closed. | PRD Launch (automatic payout); Runbook C3 | keeper | UI test |
| R-85 | The keeper script shall call settle_draw once the randomness is revealed. | PRD Launch (automatic payout); Runbook C3 | keeper | UI test |
| R-86 | The keeper script shall call cancel_campaign when a campaign is cancellable. | PRD Launch (automatic payout); Runbook C3 | keeper | UI test |

### G. Non-functional

| ID | Requirement | Src | Where | Test |
|---|---|---|---|---|
| R-71 | The protocol shall use checked arithmetic on every money and counter path. | PRINCIPLES Part B; Dec D10 devnet-only | on-chain (review) | boundary values fail, never wrap |
| R-72 | The protocol shall return typed errors instead of panicking on user-controlled input. | PRINCIPLES Part B; Dec D10 devnet-only | on-chain (review) | fuzzed inputs never abort |
| R-73 | The protocol shall pin the Switchboard (devnet), Metaplex Core and system program ids and never read them from instruction accounts. | PRINCIPLES Part B; Dec D10 devnet-only | on-chain | attacker program id fails |
| R-74 | The system shall operate on devnet only in the MVP. | PRINCIPLES Part B; Dec D10 devnet-only | process | n/a (process) |

## 4. Out of scope (MVP)

| Item | Why | Was |
|---|---|---|
| Coinbase Commerce / any custodial checkout | Off-chain custody cannot be atomic with the mint (runbook C7) | PRD "easy option" |
| Fee sponsor / fee-payer relayer (Kora) and embedded-wallet onboarding | Funding and fee rails deferred, devnet play money | v0.2 R-70 `[TBD-sponsor]` |
| Fiat on-ramp, local payment rails, USDC / SPL tokens | SOL only for MVP | v0.2 D1 |
| Live-streamed drawings, metaverse | Verifiable VRF plus public accounts answers transparency | PRD Checking results |
| Accounts, email confirmations | Wallet plus NFT receipt plus signature lookup (R-63) | PRD User accounts |
| Multi-asset campaigns (BTC / XRP) | One asset (SOL) first | PRD examples |
| Exact-match / tiered prizes, rollover | Documented upgrade of the winner unit (design.md section 7) | runbook TBD-prize-tiers option A/B |
| `close_campaign` (rent reclaim of settled accounts) | Settled accounts are the public receipts; devnet rent is free; add with mainnet | task brief instruction list |
| Admin web UI, wallet notification panel | Admin ops are rare and scriptable | runbook section 7 |
| Spanish / other localisation | Follow-up work | v0.2 R-68 |
| Compressed NFTs, Token-2022 | Nothing in the PRD needs them | runbook section 7 |
| Mainnet, KYC / geofencing, licensing, pilot geos, marketing | Legal gate, returns to the captain | runbook C9 |
| Trident fuzz campaign, external audit | Required before mainnet, not for devnet MVP | runbook section 7 |

## 5. Traceability: requirements to design elements, both directions

Elements are the boxes in `docs/diagrams/*.svg` (D1 overview, D2 accounts, D3 state machine, D4 buy, D5 commit, D6 settle, D7 cancel, D8 refund, D9 admin) and the sections of `docs/design.md`. Forward = every R-xx appears in column 3 of section 5.1 at least once; backward = every element row in 5.2 cites at least one R-xx (or is marked deferred). Machine-checked when this file was generated: 0 unmapped requirements, 0 unmapped elements.

### 5.1 Requirement to elements

| ID | Elements |
|---|---|
| R-01 | initialize, Config |
| R-02 | Upgrade authority, initialize |
| R-03 | Treasury (stakeholder), initialize, Config |
| R-04 | initialize, Config |
| R-05 | initialize, Config |
| R-06 | initialize, update_config |
| R-07 | Operator / admin, update_config |
| R-08 | Operator / admin, update_config |
| R-09 | Operator / admin, update_config |
| R-10 | Operator / admin, update_config |
| R-11 | Operator / admin, nominate_admin |
| R-12 | Nominated admin, accept_admin |
| R-51 | Treasury (stakeholder), initialize, update_config, settle_draw, Config, Treasury wallet (system account) |
| R-76 | initialize, update_config, nominate_admin, accept_admin |
| R-87 | Campaign state machine |
| R-13 | Operator / admin, create_campaign |
| R-14 | create_campaign |
| R-15 | create_campaign |
| R-16 | create_campaign |
| R-17 | create_campaign, Vault (system PDA) |
| R-18 | create_campaign, Core collection (per campaign), Metaplex Core |
| R-19 | create_campaign, Campaign |
| R-77 | create_campaign, Campaign |
| R-20 | Campaign |
| R-21 | Player / buyer, buy_ticket |
| R-22 | buy_ticket |
| R-23 | buy_ticket |
| R-24 | buy_ticket |
| R-25 | buy_ticket |
| R-26 | buy_ticket |
| R-88 | buy_ticket |
| R-27 | buy_ticket, Vault (system PDA), System program |
| R-28 | buy_ticket |
| R-29 | buy_ticket, Ticket |
| R-30 | buy_ticket, Ticket |
| R-31 | buy_ticket |
| R-32 | NFT metadata (static), buy_ticket, Core asset = ticket NFT, Metaplex Core |
| R-33 | buy_ticket |
| R-34 | buy_ticket |
| R-35 | Web app (Next.js) |
| R-36 | Web app (Next.js) |
| R-37 | Keeper / anyone, commit_draw |
| R-38 | commit_draw |
| R-39 | commit_draw, Randomness account, Switchboard On-Demand |
| R-40 | Switchboard oracle (TEE), commit_draw, Randomness account |
| R-41 | commit_draw, Campaign, Randomness account |
| R-42 | commit_draw, Campaign state machine |
| R-43 | Keeper / anyone, settle_draw |
| R-44 | settle_draw, Randomness account |
| R-45 | Switchboard oracle (TEE), settle_draw, Randomness account |
| R-78 | settle_draw, Randomness account |
| R-46 | settle_draw |
| R-47 | settle_draw |
| R-48 | settle_draw |
| R-49 | Treasury (stakeholder), settle_draw, Treasury wallet (system account), System program |
| R-50 | settle_draw, System program |
| R-52 | settle_draw, Campaign |
| R-53 | settle_draw, Campaign state machine |
| R-54 | settle_draw |
| R-55 | Keeper / anyone, cancel_campaign |
| R-56 | Keeper / anyone, cancel_campaign |
| R-57 | Campaign state machine |
| R-58 | Keeper / anyone, refund_ticket, System program |
| R-59 | refund_ticket, Ticket |
| R-79 | refund_ticket |
| R-60 | cancel_campaign |
| R-80 | refund_ticket |
| R-61 | RPC + DAS read, Config, Campaign, Ticket, Vault (system PDA) |
| R-62 | Web app (Next.js), RPC + DAS read |
| R-81 | Web app (Next.js) |
| R-63 | Web app (Next.js), RPC + DAS read |
| R-64 | Web app (Next.js) |
| R-84 | Web app (Next.js) |
| R-65 | Player / buyer, Wallet seam |
| R-66 | Web app (Next.js) |
| R-82 | Web app (Next.js) |
| R-67 | Web app (Next.js) |
| R-68 | English copy + Intl formatting |
| R-83 | English copy + Intl formatting |
| R-69 | English copy + Intl formatting |
| R-89 | Web app (Next.js) |
| R-75 | Keeper script (tsx) |
| R-85 | Keeper script (tsx) |
| R-86 | Keeper script (tsx) |
| R-71 | Cross-cutting rules (NFR) |
| R-72 | Cross-cutting rules (NFR) |
| R-73 | Switchboard On-Demand, Metaplex Core, System program, Cross-cutting rules (NFR) |
| R-74 | Cross-cutting rules (NFR) |

### 5.2 Element to requirements

| Element | Kind | Signs? | Requirements |
|---|---|---|---|
| Player / buyer | actor | signs buy_ticket only; never signs payout | R-21 R-65 |
| Operator / admin | actor | signs admin instructions | R-07 R-08 R-09 R-10 R-11 R-13 |
| Nominated admin | actor | signs accept_admin | R-12 |
| Upgrade authority | actor | signs initialize only | R-02 |
| Keeper / anyone | actor | fee payer only; chooses no destination | R-37 R-43 R-55 R-56 R-58 |
| Treasury (stakeholder) | actor | does not sign; address pinned in Config | R-03 R-49 R-51 |
| Switchboard oracle (TEE) | actor | 3rd party; writes randomness account | R-40 R-45 |
| Web app (Next.js) | client |  | R-35 R-36 R-62 R-63 R-64 R-66 R-67 R-81 R-82 R-84 R-89 |
| English copy + Intl formatting | client |  | R-68 R-69 R-83 |
| Wallet seam | client |  | R-65 |
| Keeper script (tsx) | service |  | R-75 R-85 R-86 |
| Fee sponsor (Kora) [optional] | deferred |  | deferred (none) |
| RPC + DAS read | service |  | R-61 R-62 R-63 |
| NFT metadata (static) | service |  | R-32 |
| Fiat on-ramp (post-MVP) | deferred |  | deferred (none) |
| initialize | ix |  | R-01 R-02 R-03 R-04 R-05 R-06 R-51 R-76 |
| update_config | ix |  | R-06 R-07 R-08 R-09 R-10 R-51 R-76 |
| nominate_admin | ix |  | R-11 R-76 |
| accept_admin | ix |  | R-12 R-76 |
| create_campaign | ix |  | R-13 R-14 R-15 R-16 R-17 R-18 R-19 R-77 |
| buy_ticket | ix |  | R-21 R-22 R-23 R-24 R-25 R-26 R-27 R-28 R-29 R-30 R-31 R-32 R-33 R-34 R-88 |
| commit_draw | ix |  | R-37 R-38 R-39 R-40 R-41 R-42 |
| settle_draw | ix |  | R-43 R-44 R-45 R-46 R-47 R-48 R-49 R-50 R-51 R-52 R-53 R-54 R-78 |
| cancel_campaign | ix |  | R-55 R-56 R-60 |
| refund_ticket | ix |  | R-58 R-59 R-79 R-80 |
| Config | pda |  | R-01 R-03 R-04 R-05 R-51 R-61 |
| Campaign | pda |  | R-19 R-20 R-41 R-52 R-61 R-77 |
| Ticket | pda |  | R-29 R-30 R-59 R-61 |
| Vault (system PDA) | pda |  | R-17 R-27 R-61 |
| Core collection (per campaign) | ext |  | R-18 |
| Core asset = ticket NFT | ext |  | R-32 |
| Randomness account | ext |  | R-39 R-40 R-41 R-44 R-45 R-78 |
| Treasury wallet (system account) | ext |  | R-49 R-51 |
| Switchboard On-Demand | ext |  | R-39 R-73 |
| Metaplex Core | ext |  | R-18 R-32 R-73 |
| System program | ext |  | R-27 R-49 R-50 R-58 R-73 |
| Campaign state machine | state |  | R-42 R-53 R-57 R-87 |
| Cross-cutting rules (NFR) | state |  | R-71 R-72 R-73 R-74 |

## 6. Review log

| Step | Status |
|---|---|
| Self-check (IDs unique, one action per row, every row has a negative test, every `[TBD]` resolved) | done at generation: 0 open TBDs |
| Captain red-team pass (G1) | **open**: record overrides below, one line each (id, decision, reason) |
| AI red-team of design.md (G2) | see design.md section 12 |

Overrides: none yet.

