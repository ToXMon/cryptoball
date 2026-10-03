# Cryptoball

Crypto lottery on Solana. Anchor program + React frontend. **Devnet-only MVP, play money, no real funds.**

Raffle-style: players buy tickets with SOL (5 numbers from 1-69 plus a Cryptoball bonus ball from 1-26, up to 5 tickets per checkout, quick-pick available). Each ticket mints a Metaplex Core NFT receipt. After the campaign closes, anyone commits and then settles a Switchboard On-Demand randomness draw; one ticket wins, 10 percent goes to the treasury and the program pays the winner's wallet (`ticket.buyer`, never the NFT owner) in the same transaction. No claim step.

## Status

Phases 1 to 2 (requirements, architecture, scaffold), the frontend phase and the Phase 3 program build: all instructions implemented (`initialize`, `update_config`, `nominate_admin`, `accept_admin`, `create_campaign`, `buy_ticket`, `commit_draw`, `settle_draw`, `cancel_campaign`, `refund_ticket`, `claim_sol`), each with happy-path and negative tests on LiteSVM (`tests/0*.test.ts`) plus a lifecycle and conservation test. `claim_sol` is a devnet-only capped SOL faucet with no server behind it; see "Devnet SOL faucet" below. `settle_draw` also derives the 5-of-69 plus Cryptoball display numbers (`winner::winning_numbers`, unbiased rejection sampling, fails closed instead of falling back to modulo); `initialize` takes the treasury as an account; `close_campaign` is still not built (design.md section 5).
The program is **live on devnet** (receipts below) and the web app talks to it for real: `app/src/program.ts` builds `buy_ticket` / `refund_ticket` instructions against the deployed program id and the devnet RPC. The web app also offers a **passkey wallet** (`app/src/passkeyWallet.ts`): a Wallet Standard wallet whose ed25519 key is derived on the player's device from a WebAuthn passkey PRF output via [mera](https://mera.category.xyz) 0.2.0. It is a plain keypair, not a smart account; installed wallets (Phantom and friends) remain as a second path in the same dialog.
`settle_draw` reads the value the oracle persisted in the randomness account, so settlement is not bound to the exact reveal slot; it must still land inside the same window `cancel_campaign` uses (see the receipts' operational notes). Build order is `docs/design.md` section 17.

| Doc | What |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 88 atomic requirements, decisions traceability, out-of-scope list |
| [docs/design.md](docs/design.md) | Account map, PDA seeds, instructions, state machine, CPI plan, threat model, swappable winner unit |
| [docs/diagrams/](docs/diagrams/) | D1-D9 architecture diagrams (SVG) |

## Devnet SOL faucet (devnet only)

A capped, on-chain drip so a player can get devnet SOL without a server. **Devnet only, play money.**
`claim_sol` must never exist on a real-money deployment (design.md T19).

- **Permissionless.** Anyone on devnet can claim, not just the captain's friends. Devnet SOL is worthless.
- **Ceilings, all enforced on-chain and none of them client-settable:**
  - `MAX_CLAIM_LAMPORTS` = `110_000_000` (0.11 SOL) per claim - program constant, **adjustable**, redeploy to retune.
  - `MAX_CLAIM_LIFETIME_LAMPORTS` = `330_000_000` (0.33 SOL) per wallet, cumulative - program constant, **adjustable**.
  - `pool_lamports`, the total the admin has budgeted, lives in program state and is changed by
    `update_faucet_pool`. **Adjustable with no redeploy.**
- **Pool arithmetic, stated plainly.** A 1.0 SOL pool against a 0.33 SOL lifetime ceiling serves about
  **three wallets to three tickets each, or nine wallets to one ticket each.** The pool, not the caps,
  is the real constraint on how many friends can play.
- **The hard backstop is the vault balance, not the constants.** Whatever ceiling is set, `claim_sol`
  also refuses to leave the vault below its rent-exempt minimum (`FaucetEmpty`).
- **Sybil-weak on purpose.** There is no identity behind a wallet, so a determined caller can claim from
  many wallets. That is accepted for a devnet faucet.
- **Money separation.** The faucet vault is a bare system PDA seeded `["faucet-vault"]`, whose derivation
  contains no campaign key. Ticket proceeds, prizes and refunds are structurally unreachable.

### Instructions

| Instruction | Signer | Args | Effect |
|---|---|---|---|
| `initialize_faucet` | **admin** (gated by `Config.admin`) | `pool_lamports`, `starting_dispensed` | Creates the ledger. The **only** path that can. |
| `update_faucet_pool` | **admin** | `pool_lamports` | Raises the budget. This is what makes a refill work. |
| `claim_sol` | anyone | `amount` | Pays the signer from the vault, if all three ceilings allow. |

**Why the ledger is admin-created.** It used to be created by `claim_sol` via `init_if_needed` at a
publicly derivable PDA. That was a real vulnerability: a third party could squat the address with a
plain 0.0009 SOL transfer and permanently brick the faucet for everyone, stranding the vault's SOL,
because no user-reachable instruction would ever have created it again. Now `claim_sol` references the
ledger with no creation path at all. Regression tests cover it (design.md T20).

*Residual, stated rather than hidden:* a lamport transfer to the ledger PDA in the window before the
admin's first `initialize_faucet` would block that one-time init. The remedy is a seed bump via upgrade.
Once initialised the ledger's data is untouchable: a lamport transfer to the PDA changes only lamports,
because only the program can write `dispensed` or `pool_lamports`. Proven on devnet below.

### `claim_sol` wiring (UI lane)

Args: `amount: u64` lamports, `1..=110_000_000`.

| # | Account | Writable | Signer | Notes |
|---|---|---|---|---|
| 1 | `claimer` | yes | **yes** | connected wallet; pays the tx fee and, on its first claim, the rent of its `claim_record` PDA. Also the payment target. |
| 2 | `claimRecord` | yes | no | PDA `["claim", claimer]`, created if missing |
| 3 | `faucet` | yes | no | PDA `["faucet-v2"]`; holds `dispensed` and `pool_lamports` |
| 4 | `faucetVault` | yes | no | PDA `["faucet-vault"]`, the funded SOL |
| 5 | `systemProgram` | no | no | `11111111111111111111111111111111` |

Event `SolClaimed { claimer, amount, lifetime_claimed, pool_dispensed }`.

| Error code | Number | Message |
|---|---|---|
| `ClaimTooLarge` | 6019 | Claim amount is zero or above the per-claim maximum |
| `ClaimLifetimeCap` | 6020 | This wallet has reached its lifetime faucet cap |
| `FaucetDrained` | 6021 | The faucet pool is exhausted |
| `FaucetEmpty` | 6022 | The faucet vault holds less than the claim amount |
| `BadAccount` | 6011 | Account does not match the derived address |

**A wallet at zero SOL cannot claim.** The first claim creates its `claim_record` PDA and the claimer
pays that rent (about 0.0016 SOL) plus the tx fee. Devnet SOL for gas has to come from elsewhere
(faucet.solana.com, or an existing wallet); the 0.11 SOL itself always comes from the faucet. Ask for
the gas top-up before showing the button, or send it from a warm wallet.

**In the app.** The funding card (`Get devnet SOL`, on the checkout and in the wallet dialog) now has a
`Claim 0.11 SOL` button that calls `claim_sol` through the connected wallet, with the external faucet
kept as the secondary way out. The button reads the faucet ledger and this wallet's claim record first,
so it never offers more than the pool has left or than the lifetime allowance, and a cap that is already
spent shows the program's own words (`ERROR_COPY`: `ClaimLifetimeCap`, `FaucetDrained`, ...) instead of
raw RPC text. A drained pool shows `FaucetDrained` and leaves the external faucet as the answer.

### PDAs (devnet, program `GtdcPM3...`)

| Account | Seeds | Address |
|---|---|---|
| `faucet` | `["faucet-v2"]` | [`7izC4mjxqEskF2XxVugBXSuz5Y7hUG7ENRX9YCkhpXHn`](https://explorer.solana.com/address/7izC4mjxqEskF2XxVugBXSuz5Y7hUG7ENRX9YCkhpXHn?cluster=devnet) |
| `faucet-vault` | `["faucet-vault"]` | `BgtBRka9TEQa5revD2D1A46mG9rppXRqHF5F6h3tNyt` |


### Faucet receipts (devnet, 2026-10-03)

Deploy wallet `9ACfknzt...` balance: **6.54267132** SOL before this work, **5.395798880** SOL after. The
difference is the 1.0 SOL vault top-up below, the two dust transfers to the test wallets, the claim fees
and the programdata top-up for the new build (2.591435 SOL, up from 2.50133612).

| Item | Value |
|---|---|
| Program upgrade tx (admin-created ledger + refill) | [`uALRH5rGrTLtZaNNNe81rCLVer8KXFhgArB3AzXRktxq41yyff7F5fYWHkFiJpJ5R2KXnSfAJ2oLZ3iWvzHd6ZD`](https://explorer.solana.com/tx/uALRH5rGrTLtZaNNNe81rCLVer8KXFhgArB3AzXRktxq41yyff7F5fYWHkFiJpJ5R2KXnSfAJ2oLZ3iWvzHd6ZD?cluster=devnet) |
| `initialize_faucet` tx | [`5zYF2Si9HUYmAgAtoaJtyrzgTVy5wjEpi5vNnXJp59Sm6CUkcw3VAk8DGz6JSuujTJEu6Au95md4fs3Jr5zjxoQ4`](https://explorer.solana.com/tx/5zYF2Si9HUYmAgAtoaJtyrzgTVy5wjEpi5vNnXJp59Sm6CUkcw3VAk8DGz6JSuujTJEu6Au95md4fs3Jr5zjxoQ4?cluster=devnet) |
| Ledger after init | `dispensed = 330000000` (carried forward from the retired v1 ledger), `pool = 1000000000` |
| Vault after the run | `340000000` lamports (1.0 funded, 0.33 spent by the v1 proof, 0.33 by this one) |

Squat attempt, after the ledger was created - the published attack. Transfer tx
[`2vegSF48JTBjyFub3Yv9pFc7bieHjGTtocZSpf6SpgN4ZBcRqTMa2vM2hbiYj337f7eqehumXP5DDSYwD89fjthW`](https://explorer.solana.com/tx/2vegSF48JTBjyFub3Yv9pFc7bieHjGTtocZSpf6SpgN4ZBcRqTMa2vM2hbiYj337f7eqehumXP5DDSYwD89fjthW?cluster=devnet)
landed, and **the ledger's bytes were byte-for-byte unchanged** - `dispensed` and `pool` untouched,
because only the program can write them.

Claims from a brand-new address, `3kQuDPPfW9ubhwUCAJ3f2SVWCSvya3LiCrTfetpjdGDG`, dusted with 0.02 SOL of
gas from the deploy wallet (the devnet airdrop was rate limited):

| Claim | Result | Tx |
|---|---|---|
| 0.11 SOL, fresh wallet | **succeeds** (0.02 -> 0.129100920 SOL) | [`3nFTqzVNybVsVUdgi3vYhnr1oY81BFVehDYUVtuaNCujYdnuqMoAnQwmA6bBnDpJeUf4H2dJAPbZGN2Z5kgDFd53`](https://explorer.solana.com/tx/3nFTqzVNybVsVUdgi3vYhnr1oY81BFVehDYUVtuaNCujYdnuqMoAnQwmA6bBnDpJeUf4H2dJAPbZGN2Z5kgDFd53?cluster=devnet) |
| 0.5 SOL, over the per-claim maximum | **rejected**, `ClaimTooLarge` (6019) | [`4yiEd1nqtXtu9JFpQmQoJESEtbUj3kjDWohVhzWg52w7gHh5XXZ8gMdvRhjFqfb7WEUYRP1HWp8VPqBLpbfULCTo`](https://explorer.solana.com/tx/4yiEd1nqtXtu9JFpQmQoJESEtbUj3kjDWohVhzWg52w7gHh5XXZ8gMdvRhjFqfb7WEUYRP1HWp8VPqBLpbfULCTo?cluster=devnet) |
| 0.11 SOL, second | succeeds | [`4MVGaCNU1wn5Xhu9Hymp7JBt2n3MJSaDX2iKBqmKLf8uKTzwxG2UA6PM5pUX4BSHXokiPXdcFvgnum92LcNNwzXL`](https://explorer.solana.com/tx/4MVGaCNU1wn5Xhu9Hymp7JBt2n3MJSaDX2iKBqmKLf8uKTzwxG2UA6PM5pUX4BSHXokiPXdcFvgnum92LcNNwzXL?cluster=devnet) |
| 0.11 SOL, third (lifetime 0.33) | succeeds | [`2doHX1iVB2Taakx5fLuprJY6NG9H4S4LkPfNccqY8L835acXTUmcEcWthL3KuNAyXvndmybkBYLQZvv3Gv8tWHJF`](https://explorer.solana.com/tx/2doHX1iVB2Taakx5fLuprJY6NG9H4S4LkPfNccqY8L835acXTUmcEcWthL3KuNAyXvndmybkBYLQZvv3Gv8tWHJF?cluster=devnet) |
| 0.01 SOL, over the lifetime ceiling | **rejected**, `ClaimLifetimeCap` (6020) | [`3syFCESbnPnVKToVMYmbu1BatMd54YonGLAs4qwbJvDQvZdpxcQxSX9pKnQFEwXSiVCL4buQUF3oddTrbcqnkMgR`](https://explorer.solana.com/tx/3syFCESbnPnVKToVMYmbu1BatMd54YonGLAs4qwbJvDQvZdpxcQxSX9pKnQFEwXSiVCL4buQUF3oddTrbcqnkMgR?cluster=devnet) |

| **In-app claim**: the app's own client path, `claimGate` -> `claimSol` (`claim_sol` tag derived from the program's own name), from a throwaway keypair dusted with 0.02 SOL | **succeeds** (0.02 -> 0.129100920 SOL); ledger `dispensed` 660,000,000 -> 770,000,000, claim record `claimed = 110000000` | [`5JewNt4msXBKURTST1sDoU8i5LJj2RMZ9bxbLAuSCFVQwG9hhCKkSu7eGewTfcRGirNy1Ns33Lygm7gT5cWnXFap`](https://explorer.solana.com/tx/5JewNt4msXBKURTST1sDoU8i5LJj2RMZ9bxbLAuSCFVQwG9hhCKkSu7eGewTfcRGirNy1Ns33Lygm7gT5cWnXFap?cluster=devnet) |

Claim delta check: 110,000,000 - 109,100,920 = 899,080 lamports = 894,080 (rent of the 48-byte
`claim_record`, the cluster's own `getMinimumBalanceForRentExemption`) + 5,000 tx fee. The vault only
existed from a prior run, so this claim paid no second account's rent.

**Ticket money untouched.** Campaign 1's vault
[`7iSvSBMT7fzk1Rei32AEaVpmhry2TvCQFEG6H8kdyJU5`](https://explorer.solana.com/address/7iSvSBMT7fzk1Rei32AEaVpmhry2TvCQFEG6H8kdyJU5?cluster=devnet)
read `100000000` lamports immediately before the five claims and `100000000` immediately after.

Superseded history: the first upgrade (`5SSnfgMjMPHKP2dBjfL9U96KxkvHgPhYmbz26RZiQUKR3EL4PpFbYGGjT6ndtuAxECXSZrZ3efZ5Fy4G63tUL8xM`)
added `claim_sol` with the v1 ledger and the griefable `init_if_needed` path. It was live for about
three hours and is replaced by the upgrade above.

### Refilling the faucet (two steps, no redeploy)

The ceiling only moves through `update_faucet_pool`, so a bare transfer alone does **not** reopen a
drained faucet. Do both:

```
# 1. add SOL to the vault (this alone changes nothing about the ceiling)
solana transfer --url devnet --keypair ~/.tape/cryptoball-deploy.json \
  BgtBRka9TEQa5revD2D1A46mG9rppXRqHF5F6h3tNyt <SOL_AMOUNT>

# 2. raise the budget to the new target total
#    update_faucet_pool(pool_lamports = <new total in lamports>)
```

`pool_lamports` is the cumulative target, not an increment, and may never be set below what has already
been dispensed. Raising it above `INITIAL_POOL_LAMPORTS` is allowed - that is the point of a refill.

### Follow-up recommendation (not a code change)

**Should the per-wallet lifetime ceiling be 0.33 SOL or 0.11 SOL?** The captain's words were "0.11 per
claim per wallet", which the code honours as the per-claim drip; the 0.33 lifetime ceiling was added on
top as a Sybil mitigation and approved as a sensible default. Narrowing it to 0.11 would raise the
usable wallets per 1.0 SOL pool from ~3 to ~9 at one ticket each. Carried to the captain as an explicit
question; the code keeps 0.33 until that answer lands.
#### Deploying to devnet: what actually happened

Operational history, because the obvious command does not work and repeating it wastes hours.

`solana program deploy` failed twice with **`Error: Data writes to account failed: Custom error: Max
retries exceeded`** (after ~35 and ~60 minutes). Not the program's fault:

- The deploy wallet needs about **2.75 SOL for a 509 KB build** at once, because the loader stages the
  binary in a *buffer* account holding rent for its whole size (2.591394360 SOL here) until the upgrade
  lands. That rent comes back on success and is **stranded on failure** - two orphan buffers,
  2.50133612 SOL each, had to be reclaimed with `solana program close <buffer> --keypair <dev wallet>`
  (the buffer's authority is the deploy wallet, so no separate key is needed). Nothing was left stuck.
- `api.devnet.solana.com` rate limits by IP. The CLI's buffer writes plus signature-status polling trip
  the limit, the writes start failing, and it exhausts its retries. It is also load balanced, so a
  blockhash from one node frequently fails preflight on another ("Blockhash not found").
- A dedicated QuickNode devnet endpoint fixes the rate limiting but **caps RPC request bodies**: both
  `--use-rpc` and `--use-tpu-client` fail with `413 Request Entity Too Large` on the write path *and* on
  the final upgrade transaction. A paid endpoint is necessary but not sufficient on its own.

**What works:** `scripts/write-buffer.js` creates the loader buffer and fills it itself - 850 bytes per
transaction, two trivial loader instructions (`InitializeBuffer`, `Write`), a configurable gap between
writes. It asks the cluster for the rent-exempt minimum via `getMinimumBalanceForRentExemption` rather
than hardcoding a lamports-per-byte rate, because that rate has already drifted once on this cluster and
a stale constant silently under-funds the buffer. 601 chunks took **~38 min against QuickNode**
(`GAP_MS=250`) versus ~46 min against the public endpoint at `GAP_MS=2000`. Then:

```
export RPC=<your devnet https endpoint>
RPC=$RPC GAP_MS=250 node scripts/write-buffer.js target/deploy/cryptoball.so /tmp/faucet-buffer.json
solana program deploy target/deploy/cryptoball.so \
  --program-id GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC \
  --keypair ~/.tape/cryptoball-deploy.json --buffer /tmp/faucet-buffer.json --max-len 509952
```

The CLI finds the buffer already full, so it writes nothing and only performs the upgrade. Two gotchas
worth knowing: QuickNode 413s on the final upgrade tx too (do that single step against
`api.devnet.solana.com`), and a stale blockhash there fails with `Program was deployed in this block
already` - just retry.

Budget **2.75 SOL** per upgrade and keep `scripts/write-buffer.js` in your back pocket. The floor is
observable: the programdata account must stay rent-exempt for the new size (2.591435 SOL at 509,952
bytes). `scripts/faucet-proof.js` regenerates the claim receipts above.


## Layout

```
programs/cryptoball/   Anchor program (instructions, state, events, errors, constants, winner.rs)
tests/                 ts-mocha + LiteSVM: harness.ts, one test file per instruction, lifecycle; fixtures/mpl_core.so = devnet Core binary
app/                   React + Vite player app (Prime Time design, 3D ticket, draw-night ball drop); src/tokens.css = design tokens; src/program.ts = devnet program adapter (builds Anchor instructions); src/passkeyWallet.ts = passkey (Wallet Standard) wallet
docs/                  requirements, design, diagrams
ops/                   open-game.mjs (open a campaign), cancel-refund.mjs (cancel + refund a stuck campaign), admin.mjs (admin handover), schedule.sh (launchd rolling schedule), cryptoball.idl.json (committed IDL of the deployed program)
scripts/                write-buffer.js (devnet upgrade, chunked buffer upload), faucet-proof.js (claim receipts)
```

## Toolchain (pinned)

| Piece | Version |
|---|---|
| anchor-lang / CLI | 0.32.1 (`avm use 0.32.1`) |
| mpl-core | 0.12.1 (`default-features = false`, feature `anchor-0-32`) |
| switchboard-on-demand | 0.13.0 (`default-features = false`, features `solana-v2`, `devnet`) |
| Keeper SDK | `@solana/web3.js` 1.98.0 (Switchboard TS SDK requirement) |

Why these features: `docs/design.md` section 10.

## Run

```
cargo test -p cryptoball          # pinned-id check
cargo build-sbf --manifest-path programs/cryptoball/Cargo.toml
anchor build && pnpm install && pnpm test   # LiteSVM suite (needs target/deploy/cryptoball.so)
cd app && pnpm install && pnpm dev   # also: pnpm test (pure-logic check), pnpm build
node --test ops/*.test.mjs  # ops guardrails (limits, duplicate, staggering, admin guards, cancel eligibility, IDL), no chain
```

## Devnet RPC endpoint

The app and the ops tooling talk to **one** devnet endpoint, a dedicated QuickNode plan:

```
https://hardworking-broken-field.solana-devnet.quiknode.pro/ec3c0ae727818aaaead289ef2e844d4df1411e75/
```

- **Where it lives.** `DEVNET_RPC` in `app/src/program.ts` is the single app constant; `Wallet.tsx`
  imports it rather than repeating the string. `ops/open-game.mjs` defaults to the same URL and
  honours `RPC_URL` (or `CRYPTOBALL_RPC`) as an override, so `ops/schedule.sh` and local runs both
  use it without extra configuration. `app/src/check.ts` fails if `api.devnet.solana.com` reappears
  in any of those files, or if `app/public/_site.json` stops listing this endpoint.
- **`app/public/_site.json` `connect_origins`.** The deployed page cannot reach the network unless
  the origin is listed there, and it ships with the **build** - a missed origin means a silently
  dead page, not a build error. It carries the `https` origin and the matching `wss` origin (the
  QuickNode endpoint was verified to accept a real WebSocket upgrade: `slotSubscribe` opened and
  returned a notification).
- **The token is public by design.** The app is a public static site, so the URL - token included -
  is visible to anyone who opens the page. Treat it as a public value: never put anything secret in
  it, and watch the plan's request quota rather than assuming it is unlimited.

**Why a dedicated endpoint exists.** The free public `api.devnet.solana.com` rate-limited us: HTTP
429s through the day, failed pipeline test runs, and a program upload that had to be written by hand
in chunks. A dedicated endpoint removes that as a failure mode; the retry-with-backoff guardrail in
the ops tool stays, because any endpoint can rate-limit a burst.

## Ops: opening a game

One command opens one campaign against the deployed devnet program, as the admin
(`~/.tape/cryptoball-deploy.json`, or `$ANCHOR_WALLET`). **Manual path first, because it is the
fallback that makes the scheduler safe:**

```
node ops/open-game.mjs --price 0.1 --duration 10 --cap 1000     # opens it, in seconds
node ops/open-game.mjs --price 0.1 --duration 10 --cap 1000 --dry-run   # plan only, sends nothing
```

It prints the campaign address, the close time in UTC, the tx signature with an Explorer link, and
the measured devnet cost; the same receipt is appended as one line to `ops/log/open-game.log`.
Flags: `--price <SOL>` (program floor 0.002; the agreed tiers are 0.01 / 0.1 / 1 - parameters, not
policy), `--duration <hours>` or `auto`, `--cap <n>` (program max 10000), `--id <n>`, `--allow-duplicate`.

**No Rust toolchain on the host.** The program IDL is committed at `ops/cryptoball.idl.json`, and
both ops tools read that copy first (`target/idl/cryptoball.json` is only a fallback for a working
tree that has built the program). So on a plain Ubuntu host it is `git clone`, `pnpm install`,
`node ops/open-game.mjs` - no anchor, no cargo-build-sbf, no cold compile. The copy is the IDL of
the deployed program `GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC`, taken from the on-chain IDL
account published at deploy (`BgERvSGr6d4jDr53jaKF8eXqimgdFwVSTMc4ekR4o7c`); `loadIdl()` fails
loudly if the file is missing, unreadable, or not that program's IDL, so this cannot silently
regress into needing a toolchain.

Guardrails, all of them before anything is signed:

- **Program limits.** A price below `MIN_TICKET_PRICE_LAMPORTS` or a cap outside `1..MAX_TICKETS` is
  refused with the reason (the smallest prize would not cover vault rent / cap too high).
- **No double-booking.** If a campaign is already `Open` at the same price and its close window
  lands within 2 h of the requested one, it refuses and names that campaign. `--allow-duplicate`
  overrides; `--dry-run` shows the plan and what it would have refused.
- **No silent half-campaign.** Every RPC call retries with backoff (RPC endpoints answer 429 a
  lot, so a rate limit is reported, never assumed). If `create_campaign` fails, the tool re-reads
  the chain and logs the exact state it stopped in: whether the campaign account exists, whether
  the Core collection exists, and whether a signature came back.
- Id is always the next free id (from `getProgramAccounts`), so a failed attempt never poisons the
  next one.

### Wallet model and admin handover

Every ops tool signs with `$ANCHOR_WALLET`, or `~/.tape/cryptoball-deploy.json` when that is unset.
The signer must be the on-chain **admin**, because `create_campaign` requires it. Honest version of
the recommendation: **the VPS should not hold the funded deploy key.** Nominate a dedicated opener
key through the program itself, then hand admin back - a remote host then holds a key that can open
games and nothing else. Do these in order:

```
# 0. on the funded host, with the current admin key:
node ops/admin.mjs status                                    # who is admin, is anyone pending
node ops/admin.mjs nominate <opener-pubkey>                  # signed by the CURRENT admin

# 1. move the opener keypair to the VPS (e.g. ~/.tape/cryptoball-opener.json, chmod 600) and:
ANCHOR_WALLET=~/.tape/cryptoball-opener.json node ops/admin.mjs accept   # signed by the NOMINEE

# 2. confirm who holds what, from anywhere:
node ops/admin.mjs status                                    # admin=<opener>, pending=none
```

`nominate` is signed by the current admin and `accept` by the nominee; the tool refuses before
signing anything if the signer is not the right party for that step (and says who should be). Each
step prints the admin state before and after, plus the tx signature and an Explorer link. It never
prints a secret key - only public keys. To hand admin back, run the same two commands with the
opener key as the current admin and the deploy key as the nominee. `pending=none` means no
nomination is outstanding.

### Rolling schedule

`ops/schedule.sh` runs the same command on a fixed interval with `--duration auto`, which rotates
6 / 10 / 14 hours by wall-clock slot so closes never all land at once. **It is macOS launchd only**
- it writes `~/Library/LaunchAgents/site.cryptoball.open-game.plist` and calls `launchctl`, so it
does nothing on an Ubuntu host. On Linux, use cron: one fixed entry, no launcher logic needed,
because `--duration auto` already staggers closes 6/10/14h by wall-clock slot.

```
ops/schedule.sh install 6          # writes and loads ~/Library/LaunchAgents/site.cryptoball.open-game.plist
ops/schedule.sh status             # plist, launchctl state, last 5 log lines
ops/schedule.sh now --dry-run      # one tick, sends nothing
ops/schedule.sh start              # kick a tick now, interval keeps running
ops/schedule.sh stop               # unload the job (plist stays; 'install' reloads it)
ops/schedule.sh uninstall          # unload and delete the plist
ops/schedule.sh log                # follow the receipts
SCHEDULE_PRICE=0.01 ops/schedule.sh install 6   # price/cap fixed at install time
```

#### Linux / VPS: cron

On an Ubuntu host there is no launchd, so the portable path is a single cron entry that runs the
same command every 6 h (`crontab -e`; the entry exports `ANCHOR_WALLET` itself, so cron does not
need an interactive login):

```
0 */6 * * * cd /home/opadmin/cryptoball && ANCHOR_WALLET=/home/opadmin/.tape/cryptoball-opener.json /usr/bin/node ops/open-game.mjs --price 0.1 --duration auto --cap 1000 >> ops/log/cron.log 2>&1
```

- **Interval**: `0 */6 * * *` = every 6 h. Change the `*/6` for a different cadence; `--duration
  auto` keeps the closes staggered whatever the interval is.
- **Logs**: `ops/log/open-game.log` gets one line per run (`OPENED {...}` / `DRYRUN` / `REFUSED
  <why>` / `FAILED <why> state=...`), and cron's own stdout+stderr goes to `ops/log/cron.log`.
- **Did it run?** `tail -5 ops/log/open-game.log`, or `grep -c OPENED ops/log/open-game.log` for a
  count, or `systemctl status cron` / `journalctl -u cron` for the scheduler itself. If the log is
  silent, cron is not firing - run the command by hand once, exactly as cron runs it, to see the
  error.
- **First check on a new host**: run the same command with `--dry-run` first (plan and cost, sends
  nothing), then without it.
- **RPC**: the line above uses the dedicated QuickNode default from `Devnet RPC endpoint` above; a
  different endpoint is `RPC_URL=...` in front of the command.

Every run appends one line to `ops/log/open-game.log` (`OPENED {...}` with address, close time,
signature and cost; `DRYRUN`; `REFUSED <why>`; `FAILED <why> state=<what exists on chain>`), so a
silent unattended failure is not possible - check `ops/schedule.sh status`.

#### Armed on this host (2026-10-03), and how to turn it off

The job is installed and has fired for real:

| Item | Value |
|---|---|
| plist | `~/Library/LaunchAgents/site.cryptoball.open-game.plist` (label `site.cryptoball.open-game`) |
| Cadence | `StartInterval` 21600 s = **every 6 h**, `RunAtLoad` false |
| Price / cap / duration | 0.1 SOL, cap 1000, `--duration auto` (rotates 6 / 10 / 14 h by wall-clock slot) |
| ROOT it runs from | `/Users/tolushekoni/agent-workspace/projects/cryptoball` - set with `CRYPTOBALL_ROOT`, because the plist hardcodes ROOT and a disposable worktree would leave the job firing a path that no longer exists |
| Logs | `ops/log/open-game.log` (one receipt line per run), `ops/log/scheduler.log` (stdout/stderr of the tick), `ops/log/launchd.{out,err}.log` (launchd's own capture) |
| Turn it off | `ops/schedule.sh stop` (unload, plist stays) or `ops/schedule.sh uninstall` (unload and delete) |
| Run one now | `ops/schedule.sh now --dry-run` (plan only) or `ops/schedule.sh start` (kickstart through launchd, interval keeps running) |

At one campaign per 6 h with 6 / 10 / 14 h close windows, two or three campaigns are open at any
time and no two closes land in the same 2 h bucket.

**Burn rate: 0.002956400 SOL per campaign, every 6 h = 0.0118256 SOL/day (~0.35 SOL per 30 days,
~4 campaigns/day).** At that rate the current deploy-wallet balance lasts about 460 days, and
devnet airdrops are the real constraint long before the arithmetic.

Two bugs were found and fixed while arming it, both of which produced exactly the failure the
brief warns about - a job that loads and never runs:

1. **`set -e` + `command -v node`.** launchd starts jobs with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.
   `command -v node` found nothing, returned non-zero, and `set -e` killed the script before it
   printed anything or created a log - the job sat "loaded", `last exit code = 1`, and both log
   files empty. `schedule.sh` now resolves node from the usual prefixes (or `SCHEDULE_NODE`) and
   says so plainly on stderr if it truly cannot.
2. **`ROOT` pointing at a checkout with no `node_modules`.** The tick ran and died with
   `ERR_MODULE_NOT_FOUND: '@coral-xyz/anchor'`. `pnpm install --frozen-lockfile` in that checkout
   fixed it (`node_modules/` and `ops/log/` are gitignored, so the repo stays clean).

To verify a job is really firing, do not trust `launchctl list` - it is happy with a job that has
never executed. Kick it and read the receipt:

```
launchctl kickstart -k "gui/$UID/site.cryptoball.open-game"
tail -3 /Users/tolushekoni/agent-workspace/projects/cryptoball/ops/log/scheduler.log
grep OPENED /Users/tolushekoni/agent-workspace/projects/cryptoball/ops/log/open-game.log | tail -3
launchctl print "gui/$UID/site.cryptoball.open-game" | grep -E "runs =|last exit"
```

Note that the label is one per user: any other lane installing `site.cryptoball.open-game` on this
host replaces this job, and two jobs would double-open campaigns.

**Two follow-ups that this does not solve.**

- **Nothing sweeps a draw once it closes.** The opener opens games; nothing commits, retries the
  Switchboard reveal, settles, or cancels-and-refunds. That is exactly why campaign 3 stranded a
  buyer for 15 h: the timeout path works and is now one command (`node ops/cancel-refund.mjs --id
  <n>`), but nothing calls it. Adding one launchd job (or one more branch in `run_tick`) that
  walks expired `Open` campaigns to `commit_draw`, then `settle_draw`, then falls back to
  `cancel-refund.mjs` after the reveal timeout closes the loop. Left out here on purpose: it moves
  money unattended, so it wants its own review.
- **`CAMPAIGN_IDS` in `app/src/program.ts` is a hardcoded list**, so every campaign the scheduler
  opens is invisible on the site until the list is bumped and `tape deploy` runs. Discovering ids
  from the chain (`getProgramAccounts` + the campaign discriminator, which `ops/open-game.mjs`
  already does) would make the lobby self-updating. Listed `[1..8]` now; the scheduler is opening
  campaign 9 at the next tick.

### Cost, honestly

Measured on devnet for campaign 4 (receipt below): **0.0029564 SOL per campaign**
= campaign account rent 1,742,440 + Metaplex Core collection rent 1,203,960 + tx fee 10,000
(the vault PDA holds 0 lamports until tickets are bought). Devnet balance after that run:
5.519705 SOL, so **~1,867 campaigns** before the deploy wallet is empty. That is the real ceiling:
every 6 h (4/day) is ~467 days of unattended running, every 2 h (12/day) ~155 days, every 1 h
(24/day) ~78 days. Devnet SOL is faucet-limited long before that, so the binding constraint is
airdrops, not the arithmetic - but the arithmetic is the answer to "how much of this can run
unattended".

## Site (tape.site)

Live build: <https://6ssmjmenn4d22yvgirrbdpc3h4u4pmkggp4uxpj3h52cnlnu2bdq.tape.site/> - same tape (label and host never change, so existing passkeys keep working). Redeploy with `tape deploy app/dist/index.html` against that tape's keypair; never `tape create`.

## Receipts (devnet)

Cluster: devnet. Never mainnet. Explorer links are `https://explorer.solana.com/<what>/<id>?cluster=devnet`.
Toolchain for the deployed build: anchor-cli 0.32.1, solana-cli 4.2.2, cargo-build-sbf 4.1.0 (platform-tools v1.54, rustc 1.89.0).

| Item | Value |
|---|---|
| Program ID | [`GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC`](https://explorer.solana.com/address/GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC?cluster=devnet) |
| Cluster | devnet |
| Deploy tx | [`4JLGKSiRdpr5j7Xg2XUQyu56ZQ3CF8Q9JKNFA3iZfC2ebDHXjWHsrCuVreeep2byNMwSjZPNCLH5Nt3d5yj8sq4Y`](https://explorer.solana.com/tx/4JLGKSiRdpr5j7Xg2XUQyu56ZQ3CF8Q9JKNFA3iZfC2ebDHXjWHsrCuVreeep2byNMwSjZPNCLH5Nt3d5yj8sq4Y?cluster=devnet) |
| On-chain IDL account | [`BgERvSGr6d4jDr53jaKF8eXqimgdFwVSTMc4ekR4o7c`](https://explorer.solana.com/address/BgERvSGr6d4jDr53jaKF8eXqimgdFwVSTMc4ekR4o7c?cluster=devnet) |
| Upgrade authority / treasury | [`9ACfknztv9UqJLLccZnBgjxFNbkNZERMwJbikj4dait7`](https://explorer.solana.com/address/9ACfknztv9UqJLLccZnBgjxFNbkNZERMwJbikj4dait7?cluster=devnet) (devnet placeholder wallet; `Config.fee_bps` = 1000) |
| initialize tx | [`5o8E3nEZoPEGsBgevLfQp3QaeJ9eGvWGJxC2Ex5DPz4ouzoi5SUD2cLj3z7Z5okyAm5d5VtRxRdWvC8ds8vFzAAD`](https://explorer.solana.com/tx/5o8E3nEZoPEGsBgevLfQp3QaeJ9eGvWGJxC2Ex5DPz4ouzoi5SUD2cLj3z7Z5okyAm5d5VtRxRdWvC8ds8vFzAAD?cluster=devnet) (`Config` PDA `ECehTFBNuFQZrfHTWMcUWiMCbwF6KvHbXCxzMa6JPFwf`) |
| Site redeploy (merged main, live program + passkey wallet) | 2026-10-02T21:14Z via `tape deploy app/dist/index.html` on tape `HTzCcSXy5sWncaPuVbySqMAG4FCs7EkttpGRLR1urycJ` (id 816, epoch 245, expires ~2026-10-13). Served `assets/index-CXWQxE6U.js` carries `GtdcPM3...`; `_site.json` ships with the devnet RPC origins; verified in-browser: page loads with no console errors (only a favicon 404), campaign 1 renders 0.09 SOL / 5 of 69 from devnet, the wallet dialog offers the passkey wallet alongside installed ones, and `https://api.devnet.solana.com` answers from the page origin. A real passkey ceremony was not run in headless Chrome. `--prune` could not delete the stale old chunk (tape rejected the delete); the orphan is unreferenced. |
| Site republish (merged main: QuickNode RPC + faucet helper) | 2026-10-03T03:07Z via `tape deploy app/dist/index.html` on the SAME tape `HTzCcSXy5sWncaPuVbySqMAG4FCs7EkttpGRLR1urycJ` (id 816, label `6ssmjmenn4d22yvgirrbdpc3h4u4pmkggp4uxpj3h52cnlnu2bdq`, so the host and every existing passkey are unchanged). URL: <https://6ssmjmenn4d22yvgirrbdpc3h4u4pmkggp4uxpj3h52cnlnu2bdq.tape.site/>. Verified: served `assets/index-B2SX2SA1.js` contains the QuickNode devnet endpoint and zero occurrences of `api.devnet.solana.com`, and carries `GtdcPM3...`; `/_site.json` served live lists the QuickNode `https` + `wss` origins in `connect_origins`. In-browser: page loads with no console errors except the usual favicon 404, campaign 1 renders 0.09 SOL / 5 of 69 fetched over a 200 POST to the QuickNode origin, the wallet dialog offers the passkey wallet, and `getAccountInfo` for the program through that endpoint returns an executable BPF account. NOT verified in-browser: the faucet card itself (both funding surfaces render only once a wallet is connected, and a real passkey ceremony needs a real device) and a separate create-vs-sign-in passkey split - this build has one `Cryptoball Passkey` button that creates or unlocks. Its strings (`Open Solana devnet faucet`, `Copy address`) are present in the live bundle, and `app` `pnpm test` passes. |
| Site republish (merged main #13 + #14: campaign discovery, finished-draw results with proof, in-app SOL claim, armed schedule) | 2026-10-03T13:50Z via `tape deploy app/dist/index.html` on the SAME tape `HTzCcSXy5sWncaPuVbySqMAG4FCs7EkttpGRLR1urycJ` (id 816, label `6ssmjmenn4d22yvgirrbdpc3h4u4pmkggp4uxpj3h52cnlnu2bdq`; no `--label`, no new tape, so the host and every existing passkey are unchanged). URL: <https://6ssmjmenn4d22yvgirrbdpc3h4u4pmkggp4uxpj3h52cnlnu2bdq.tape.site/>. Built from merged main (`app` `pnpm build` + `pnpm test` green). Verified: served `assets/index-DhupNfXl.js` carries `GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC` and the QuickNode endpoint with zero occurrences of `api.devnet.solana.com`; `/_site.json` served live lists the QuickNode `https` + `wss` origins in `connect_origins`. In-browser (Chrome, page origin): home page is not blank and lists all 8 devnet campaigns (#7, #8, #5, #6 open; #4, #3, #2, #1 closed) with prices and per-draw copy; a finished draw page (`#/results/3`) renders the state, tickets sold, pool, close/commit times and the `Proof this draw was fair` block (randomness account, seed slot, reveal value, settle/draw-tx and draw-account links, all clickable), not a bare state word; campaign data is fetched over 200 POSTs to the QuickNode origin; `getAccountInfo` for the program through that endpoint returns an executable BPF account owned by `BPFLoaderUpgradeab1e`; the faucet ledger reads `dispensed = 770000000`, `pool = 1000000000` (0.23 SOL claimable) and the faucet vault holds 0.23 SOL; **no console errors** (only a DevTools a11y hint that the ticket-lookup field has no id/name). NOT verified in-browser, and honestly so: the in-app `Claim 0.11 SOL` button and the external-faucet fallback, because both funding surfaces render only once a wallet is connected and a real passkey ceremony needs a real device; and the settled-draw result page (winning numbers, winner, prize, treasury fee), because **no campaign on devnet is settled yet** - #1 and #4 are closed but not committed to randomness and #2 and #3 were cancelled, so there is no settled draw to render. The live bundle does carry that page's strings (`Drawn numbers`, `Paid to`, `Treasury fee`, `Proof this draw was fair`) and the claim card's (`0.11 SOL`, `Open Solana devnet faucet`), so the code is shipped; it is unexercised. The previous chunk `assets/index-B2SX2SA1.js` still answers 200 (no `--prune`, as before); it is unreferenced by `index.html`. |

### Campaign 4 (opened by the ops tool, `ops/open-game.mjs`)

| Item | Value |
|---|---|
| Campaign / vault | [`FrqfHBZZXFbcMmmNNxQrEa6v6iKUZmLY6TPGC23EMbNq`](https://explorer.solana.com/address/FrqfHBZZXFbcMmmNNxQrEa6v6iKUZmLY6TPGC23EMbNq?cluster=devnet) / `5tJFojqskJB5WYawL7fZp26idtaeKibiM7MAaMsChJve` |
| Core collection | `864AF5VajM9pn9F81iieBRpBLcGnyXMCy11H6rJSwutm` |
| Parameters | 0.1 SOL, cap 1000, closes 2026-10-03T12:20:45Z (opened 2026-10-03T02:20:45Z) |
| create_campaign tx | [`3BWhYTCvZsuv2t6Xqq35p6KLZj9HrQSexL6iX45BCNdMcW2ddjGewSHEDocDuj42Ua3w7p5k82ZwTqCzkhhDbvP2`](https://explorer.solana.com/tx/3BWhYTCvZsuv2t6Xqq35p6KLZj9HrQSexL6iX45BCNdMcW2ddjGewSHEDocDuj42Ua3w7p5k82ZwTqCzkhhDbvP2?cluster=devnet) |
| Cost to the deploy wallet | 0.002956400 SOL (2,956,400 lamports), measured by balance delta |

Opened by `node ops/open-game.mjs --price 0.1 --duration 10 --cap 1000` on the deployed program.
At the time it was opened the web app could not see it: `CAMPAIGN_IDS` in `app/src/program.ts`
listed `[1]` only, and that list was player-facing app policy, not ops. `open-game` prints the
reminder on every open. **Both are now gone**: the app discovers campaigns from the chain
(`getProgramAccounts` filtered by the campaign account discriminator, verified against
`ops/cryptoball.idl.json`), so a newly scheduled campaign is visible without touching or
redeploying the app.

### Campaigns 5, 6, 7 (opened by hand so players have something to buy)

Four campaigns existed and none of them was playable. These three went out minutes later, at the
agreed tiers, with staggered close windows so no two land together.

| id | price | cap | closes (UTC) | campaign | create_campaign tx |
|---|---|---|---|---|---|
| 5 | 0.01 SOL | 1000 | 2026-10-03T23:55:44Z (12 h) | [`9VDiikwWXAShF4SFujcw4t1oDrDPVFBy531E4HfctaP7`](https://explorer.solana.com/address/9VDiikwWXAShF4SFujcw4t1oDrDPVFBy531E4HfctaP7?cluster=devnet) | [`GGwTwmsNm9xHaYKKxn2Ybdw6FNGGcxm8rKXG1EBR6SdyJWPDiZosv1XuRYEdL3bP8yE6riNxETaQ8HSPKdktTy3`](https://explorer.solana.com/tx/GGwTwmsNm9xHaYKKxn2Ybdw6FNGGcxm8rKXG1EBR6SdyJWPDiZosv1XuRYEdL3bP8yE6riNxETaQ8HSPKdktTy3?cluster=devnet) |
| 6 | 0.1 SOL | 1000 | 2026-10-04T11:55:47Z (24 h) | [`AMi5YG69N9sToftohxWRubMenY27AfU5DBLTVBYSD9Qv`](https://explorer.solana.com/address/AMi5YG69N9sToftohxWRubMenY27AfU5DBLTVBYSD9Qv?cluster=devnet) | [`ThfqcmcCacD6B5dXDd9LSUQB9AEA6QteuiMCnMVoC7g46gNpB9anFeK3zGxtDnwz6yBY7EZkGZUNSW6R9SRfrJx`](https://explorer.solana.com/tx/ThfqcmcCacD6B5dXDd9LSUQB9AEA6QteuiMCnMVoC7g46gNpB9anFeK3zGxtDnwz6yBY7EZkGZUNSW6R9SRfrJx?cluster=devnet) |
| 7 | 1 SOL | 1000 | 2026-10-03T19:55:53Z (8 h) | [`AtBH73Z9PMAAe3hpjDpikyuQc7dLSU9yoDVkyxGcgVNb`](https://explorer.solana.com/address/AtBH73Z9PMAAe3hpjDpikyuQc7dLSU9yoDVkyxGcgVNb?cluster=devnet) | [`2EfczUJjYdYmhzxEG9wwaNGeaUn9dvMHtMXXNFidncaydTQVi855LmA1Rj9sCg74mevSayhJVH7uFFkP31CFtA5X`](https://explorer.solana.com/tx/2EfczUJjYdYmhzxEG9wwaNGeaUn9dvMHtMXXNFidncaydTQVi855LmA1Rj9sCg74mevSayhJVH7uFFkP31CFtA5X?cluster=devnet) |

Each cost **0.002956400 SOL** (2,956,400 lamports), measured by balance delta - same figure as
campaign 4. Campaign 8 (below) was opened by the scheduler, not by hand.

### Campaign 8 (opened by the rolling schedule, through launchd)

Proof that the armed launchd job actually sends, not just that it loaded.

| Item | Value |
|---|---|
| Campaign / vault | [`EEwGQaB8S5tzMRjHgzG2Po8Fwjv8U1D3AveUALWdwQ6t`](https://explorer.solana.com/address/EEwGQaB8S5tzMRjHgzG2Po8Fwjv8U1D3AveUALWdwQ6t?cluster=devnet) / `1248ZXJwbT4MX2qVBCF7vjJ2e36TMB8Cc9VSfSze9tkx` |
| Parameters | 0.1 SOL, cap 1000, closes 2026-10-03T22:06:33Z (`--duration auto` = 10 h slot) |
| create_campaign tx | [`4JLxybS6GxBxGYwoa9ZytrHcsr4MLmhXCdB8HYLw6Ys2gfBTAnQPnpor2PvHQRzvWLxNNNkdr616NTwDhVN5ht1w`](https://explorer.solana.com/tx/4JLxybS6GxBxGYwoa9ZytrHcsr4MLmhXCdB8HYLw6Ys2gfBTAnQPnpor2PvHQRzvWLxNNNkdr616NTwDhVN5ht1w?cluster=devnet) |
| Opened by | `launchctl kickstart gui/$UID/site.cryptoball.open-game` at 2026-10-03T12:06:33Z |
| Log line | `/Users/tolushekoni/agent-workspace/projects/cryptoball/ops/log/scheduler.log`, receipt line in `ops/log/open-game.log` |

### Campaign 3 (was stranded: DrawCommitted, never revealed) - resolved and refunded

Campaign 3 sat `DrawCommitted` for ~15 h past its close with one ticket sold and nobody moving it.
**Diagnosis, read from chain, not inferred:** `committed_at` = 2026-10-02T21:00:15Z, `seed_slot`
= 506762740, randomness account `2vCjqRLqUYLPDm25Hcaf3fRv5o5YGDe56ff5EeG3ik3a`. That account is on
chain (480 bytes, owner `Aio4gaXj...` = Switchboard On-Demand devnet) with **`reveal_slot = 0`** and
an all-zero `value`: the oracle never revealed. It now also holds a *later* `seed_slot`, so
`settle_draw`'s `require(r.seed_slot == c.seed_slot)` can never be satisfied for this campaign
either - **settlement was impossible, cancel-and-refund was the only way out.** The commit itself
was fine and landed after close, as designed; there was no timeout sweep on this host, which is why
a resolvable draw sat for 15 h (named follow-up below).

New tool: `ops/cancel-refund.mjs` cancels a campaign once the program allows it and refunds every
`Active` ticket, printing a receipt per transaction. It is permissionless work - the same two
instructions anyone could send - wrapped with the guardrails that make it safe to run blind:
`--dry-run` first, the eligibility gate explained before signing, and a skipped/already-cancelled
campaign reported instead of forced.

```
node ops/cancel-refund.mjs --id 3 --dry-run   # plan, sends nothing
node ops/cancel-refund.mjs --id 3             # cancel + refund, receipts with Explorer links
```

| Item | Value |
|---|---|
| cancel_campaign tx | [`2PVuRe2S83afT4FkaXw3ChYVWkZdQEZMkCqAmLxzGQtsEQAuhJrZNbmzvCnfCB8QHKSZYL3fbEhiP2f2rcumEsVg`](https://explorer.solana.com/tx/2PVuRe2S83afT4FkaXw3ChYVWkZdQEZMkCqAmLxzGQtsEQAuhJrZNbmzvCnfCB8QHKSZYL3fbEhiP2f2rcumEsVg?cluster=devnet) (eligible 15 h after the deadline: `DrawCommitted` + `now > committed_at + 3600`) |
| refund_ticket tx (campaign 3, ticket `HhgJfrvTUVxRFwug6MwpgWJgV1H9byGpxYwgQmDGpTCH`) | [`2pykChR8m8MPKCD4WqmQXLvaco3rt4jcUuC7H4qrxqjJRw3fxJtt8c4Z8iFw6nUbcyb7NoGRC1RS2dw2wYfmf7v2`](https://explorer.solana.com/tx/2pykChR8m8MPKCD4WqmQXLvaco3rt4jcUuC7H4qrxqjJRw3fxJtt8c4Z8iFw6nUbcyb7NoGRC1RS2dw2wYfmf7v2?cluster=devnet) |
| Buyer | [`9ACfknztv9UqJLLccZnBgjxFNbkNZERMwJbikj4dait7`](https://explorer.solana.com/address/9ACfknztv9UqJLLccZnBgjxFNbkNZERMwJbikj4dait7?cluster=devnet) (the deploy wallet had bought its own ticket - so the refund returned 0.1 SOL to the same wallet that paid it) |
| Buyer balance delta, measured around the refund tx | **+99,995,000 lamports = 0.099995 SOL** (0.1 SOL ticket price less the 5,000-lamport tx fee) |
| Cost to run the rescue | 0.000005 SOL (cancel) + 0.000000 SOL net for the refund tx (it paid 0.1 SOL back out) |

Read back from chain after: campaign 3 `Cancelled`, ticket #0 `Refunded`, no `Active` ticket left.

### Campaign 1 (state `Open`, close time 11 h in the past) - not a purchase bug

| Item | Value |
|---|---|
| Campaign | [`6kKKygfjE9fd91grKMX9ydyj27c7JYcHMGUqWhBBPbEh`](https://explorer.solana.com/address/6kKKygfjE9fd91grKMX9ydyj27c7JYcHMGUqWhBBPbEh?cluster=devnet) |
| State / close | `Open`, close_ts 2026-10-03T00:51:53Z, 1 ticket sold |

`Open` and "past `close_ts`" are both true at once, and both halves are handled by design:

- **The program refuses the purchase.** `buy_ticket` starts with `require!(clock.unix_timestamp <
  camp.close_ts, E::SalesClosed)`, so a player cannot buy into an expired campaign - the chain is
  the guard, not the UI.
- **The app refuses to show it.** `fetchCampaigns` returns campaigns that are `Open` *or* have
  tickets, and both the lobby and the draw card filter on `state === "Open" && closeTs * 1000 >
  Date.now()`, so an expired-open campaign is not offered as playable and cannot be reached by the
  buy flow. `ERROR_COPY.SalesClosed` covers it if one slips through.
- **It is not stuck money.** `commit_draw` only needs `Open` + `now >= close_ts` + at least one
  ticket, all of which hold, so campaign 1 can still be committed and settled normally whenever an
  oracle answers.

So: **no bug, no fix, nothing to change in the program or the app.** `Open` is the account's draw
state, not a sales-open flag, and it is deliberately kept so the campaign stays drawable after
sales close.

**Named follow-up, fixed in PR #14.** The draw detail page (`app/src/pages.tsx`, the `c.state === "Open"` branch of `Results`) used to render `Sales close in` plus a countdown for any `Open` campaign, so a *directly linked* expired campaign showed a negative countdown and "The draw happens after sales close." Nothing was buyable from there, but it read as though it were. It now uses the same `state === "Open" && closeTs > now` predicate the lobby uses, and an expired-but-uncommitted draw says so in words ("Sales have closed. This draw has not been committed to randomness yet, so there is no winner and nobody has been paid.") with no pick button.

### Campaign 1 (open, for players)

| Item | Value |
|---|---|
| Campaign / vault | [`6kKKygfjE9fd91grKMX9ydyj27c7JYcHMGUqWhBBPbEh`](https://explorer.solana.com/address/6kKKygfjE9fd91grKMX9ydyj27c7JYcHMGUqWhBBPbEh?cluster=devnet) / `7iSvSBMT7fzk1Rei32AEaVpmhry2TvCQFEG6H8kdyJU5` |
| Core collection | `J6qssje9zpPiDnt5svAhyxvLzSfeGjB6xZeupqNWuHQV` |
| create_campaign tx | [`2JZxsxjNNR7nYUNNX2wYH7qNni9gNMoA3U9etsPwX1DsRVVoy5nhoR8iwgmQNYHq6SRkwezZzWgMycjivLqeFs6R`](https://explorer.solana.com/tx/2JZxsxjNNR7nYUNNX2wYH7qNni9gNMoA3U9etsPwX1DsRVVoy5nhoR8iwgmQNYHq6SRkwezZzWgMycjivLqeFs6R?cluster=devnet) |
| buy_ticket tx from the passkey wallet | [`5f5hPuNnUwSrUYCX7VT3h6r9gv16yqLqrQmgGr2xDic3zNYJDZVUwURUtvc8wo29t2WfwyPvfGA8cjK7U3yEMLR1`](https://explorer.solana.com/tx/5f5hPuNnUwSrUYCX7VT3h6r9gv16yqLqrQmgGr2xDic3zNYJDZVUwURUtvc8wo29t2WfwyPvfGA8cjK7U3yEMLR1?cluster=devnet) |
| Buyer (passkey-derived address) | [`vZRycKe2rUVj1Y5KYSXqzsArnwGnfsYz5yARhWwBEXT`](https://explorer.solana.com/address/vZRycKe2rUVj1Y5KYSXqzsArnwGnfsYz5yARhWwBEXT?cluster=devnet) |
| Ticket NFT minted by that tx | [`6AUPgtEnHA164tHW1SXz5bfjmXWUoFgzgZZgijRVbP2F`](https://explorer.solana.com/address/6AUPgtEnHA164tHW1SXz5bfjmXWUoFgzgZZgijRVbP2F?cluster=devnet) (Core asset, owner = buyer) |

This purchase was driven from the browser: connect -> pick numbers -> pay, against the deployed program and devnet RPC. The passkey ceremony itself was stood in for by a mock WebAuthn authenticator in the test harness (`app/dist-e2e`, not shipped), because headless Chrome has no passkey. Everything downstream of the PRF output - derivation, Wallet Standard, the wallet adapter, the Anchor instruction and the chain - is the shipped code path.

### Randomness: Switchboard On-Demand, devnet

| Item | Value |
|---|---|
| On-demand program (pinned, devnet) | `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2` |
| Queue used | [`EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7`](https://explorer.solana.com/address/EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7?cluster=devnet) (78 oracle keys, 9 initialized) |
| Campaign 2 commit_draw tx | [`4Rm63w1goTTzGD2YHwmTNEHZaG2ie4fdeQoJ6Qxo1T8F1eHkzdKyQvp4KQvKyB2CSoaeqf7VpYj9EspjwqEZUBUn`](https://explorer.solana.com/tx/4Rm63w1goTTzGD2YHwmTNEHZaG2ie4fdeQoJ6Qxo1T8F1eHkzdKyQvp4KQvKyB2CSoaeqf7VpYj9EspjwqEZUBUn?cluster=devnet) (Switchboard `randomness_commit` + `commit_draw` in one tx) |
| Randomness account (campaign 2) | [`BapmdpTzMJwLKTgA4c9Cpaqb9WdRBs6kenDXLTVUjbgg`](https://explorer.solana.com/address/BapmdpTzMJwLKTgA4c9Cpaqb9WdRBs6kenDXLTVUjbgg?cluster=devnet), `randomness_init` tx [`4Lapf8san...`](https://explorer.solana.com/tx/4Lapf8sanYLRGMANSjumZGhPdJMcQJixcC2NbVb8GbJDzqGHYzraEyTUQhGfXUaMhcdQg7sQscWbL7b12SKtFUXL?cluster=devnet) |
| Oracle used (live, initialized) | `Hdu1niJgqVGhesoxgy37p6WBunVDoBacZJZVK7VRRevg` |
| Campaign 3 commit_draw tx (second live oracle) | [`tTeJWhCNqervf6vXWjrj82o3JenvuTUYRvRYbZABtHqCUTG7TXhwwDGUYxNMSVEJp8WXXi1WBuQfCGREbUfAXEr`](https://explorer.solana.com/tx/tTeJWhCNqervf6vXWjrj82o3JenvuTUYRvRYbZABtHqCUTG7TXhwwDGUYxNMSVEJp8WXXi1WBuQfCGREbUfAXEr?cluster=devnet), randomness `2vCjqRLqUYLPDm25Hcaf3fRv5o5YGDe56ff5EeG3ik3a` |
| Oracle reveal (`randomness_reveal`) | _never arrived: see "Randomness operations" below_ |
| settle_draw on devnet | _not reached: needs the oracle reveal; covered by the LiteSVM suite instead_ |
| cancel_campaign tx (campaign 3, after the timeout) | [`2PVuRe2S83afT4FkaXw3ChYVWkZdQEZMkCqAmLxzGQtsEQAuhJrZNbmzvCnfCB8QHKSZYL3fbEhiP2f2rcumEsVg`](https://explorer.solana.com/tx/2PVuRe2S83afT4FkaXw3ChYVWkZdQEZMkCqAmLxzGQtsEQAuhJrZNbmzvCnfCB8QHKSZYL3fbEhiP2f2rcumEsVg?cluster=devnet) (`node ops/cancel-refund.mjs --id 3`) |
| refund_ticket tx (campaign 3, ticket `HhgJfrvTUVxRFwug6MwpgWJgV1H9byGpxYwgQmDGpTCH`) | [`2pykChR8m8MPKCD4WqmQXLvaco3rt4jcUuC7H4qrxqjJRw3fxJtt8c4Z8iFw6nUbcyb7NoGRC1RS2dw2wYfmf7v2`](https://explorer.solana.com/tx/2pykChR8m8MPKCD4WqmQXLvaco3rt4jcUuC7H4qrxqjJRw3fxJtt8c4Z8iFw6nUbcyb7NoGRC1RS2dw2wYfmf7v2?cluster=devnet) - buyer +0.099995 SOL, full write-up in "Campaign 3 (was stranded)" above |
| cancel_campaign tx (campaign 2, after the timeout) | [`2H4hzq8u4pR6hVM6CnWEVqUtjAiPPeVrUUdqb5uiF8neJXkHKPpGXDQceXvFNa54k7DoWqa46pvBmWJuUJtRZMTx`](https://explorer.solana.com/tx/2H4hzq8u4pR6hVM6CnWEVqUtjAiPPeVrUUdqb5uiF8neJXkHKPpGXDQceXvFNa54k7DoWqa46pvBmWJuUJtRZMTx?cluster=devnet) |
| refund_ticket tx (campaign 2, ticket `9N2LtqdDkUksWPGdotDaJbKSken2Kid3JfkShyk7YdH`) | [`5FT6CDsE5FqTa3pRLvdqvcsEFFu2v713Ueg25awdXbMs8d64DnGZHRquN5FwpsyAzTMNg4npC27FXPZrcWGfgCqB`](https://explorer.solana.com/tx/5FT6CDsE5FqTa3pRLvdqvcsEFFu2v713Ueg25awdXbMs8d64DnGZHRquN5FwpsyAzTMNg4npC27FXPZrcWGfgCqB?cluster=devnet) |

**What actually happened to draw 2, end to end.** The commit landed and `commit_draw` accepted it, but the oracle never revealed: `reveal_slot` stayed `0` and the value stayed all-zero for the whole ~5.5 h the draw sat committed. When `REVEAL_TIMEOUT_SECS` (1 h after `committed_at`) elapsed, anyone could - and did - call `cancel_campaign`, then `refund_ticket` themselves. Result read back from chain afterwards: campaign state `Cancelled`, ticket status `Refunded`, vault drained to `0`, and the buyer's wallet up by **0.099985 SOL** (the 0.1 SOL ticket price less transaction fees). That is the honest outcome: a draw nobody could finish cost the buyer nothing, and the timeout path is proven on-chain rather than only in tests.

Campaign 3 was committed the same way against a second live oracle (`6zNYHErDrEwFJnVESwwMBvJE8tp2AUNypnNWviVHLefz`) and sat unrevealed until 2026-10-03T11:59Z, when `node ops/cancel-refund.mjs --id 3` cancelled it and refunded its one buyer. Its randomness account has since been re-seeded by a later commit, so settlement was no longer possible even if an oracle had answered - the timeout path was the only outcome, and it is now proven on-chain for a second campaign. See "Campaign 3 (was stranded)" above.

#### Randomness operations (what it actually takes)

- **No crank.** The On-Demand program has no crank instruction (`randomness_init`, `randomness_commit`, `randomness_reveal`, `oracle_heartbeat_v2`, ... - full list in the on-chain IDL). The oracle pays for its own reveal, so there is nothing for us to fund.
- **What does matter:** commit against an oracle that is *actually initialized* in the queue, and a reachable Switchboard gateway. Our first commit named `9Thge4ZEgKG8LcYFfz3J3zqMeAq4SsLEu8ACa6CGUeqd`, an address the SDK returned while `gateway.switchboard.xyz` was failing - that account does not exist on chain, so nothing was ever going to answer it.
- **Observed state (2026-10-02, devnet):** `gateway.switchboard.xyz` and `crossbar.switchboard.xyz` are unreachable (no HTTP response; `docs.switchboard.xyz` answers fine). The queue is alive (`lastHeartbeat` within `nodeTimeout`), and 9 of its 78 oracles are initialized, but commits against two different live oracles sat unrevealed for hours. The reveal is produced by Switchboard's off-chain oracle network, which we do not control.
- **If the oracle never answers:** the campaign is not stuck, and this is proven above. After `REVEAL_TIMEOUT_SECS` (1 h) anyone can `cancel_campaign` and every buyer refunds themselves.
- **Cost:** a draw costs the ticket (0.1 SOL devnet placeholder) plus account rent; the randomness account, campaign and Core assets together are about 0.006 SOL of rent. The reveal itself costs us nothing.
- **Deferral for mainnet:** a draw must not depend on a laptop and a third party's uptime. Production needs a keeper service that watches `close_ts`, commits, retries, and settles, plus an oracle-selection path that fails loudly rather than committing to an address that may not exist. Until that exists, keep devnet, where play money is at stake.
