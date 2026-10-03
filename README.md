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

## Devnet SOL faucet (`claim_sol`)

A capped, on-chain drip so a player can get devnet SOL without a server. **Devnet only, play money.**

- **Permissionless.** Anyone on devnet can claim, not just the captain's friends. That is deliberate: devnet SOL is worthless. **On a real-money deployment this instruction must not exist** (design.md T19).
- **Three on-chain ceilings, all program constants in `programs/cryptoball/src/constants.rs`.** The client cannot raise any of them; the captain changes one constant and redeploys.
  - `MAX_CLAIM_LAMPORTS` = `110_000_000` (0.11 SOL) per claim.
  - `MAX_CLAIM_LIFETIME_LAMPORTS` = `330_000_000` (0.33 SOL) per wallet, cumulative.
  - `FAUCET_POOL_LAMPORTS` = `1_000_000_000` (1.0 SOL) ever dispensed, tracked in program state.
- **Sybil-weak, on purpose.** There is no identity behind a wallet, so a determined caller can claim from many wallets. The pool ceiling is the real backstop.
- **Money separation.** The faucet vault is a bare system PDA seeded `["faucet-vault"]`, whose derivation contains no campaign key. Ticket proceeds, prizes and refunds are structurally unreachable from `claim_sol`.

### Wiring a button (UI lane)

Instruction: `claim_sol`, args `amount: u64` (lamports, 1..=110_000_000).

| # | Account | Writable | Signer | Notes |
|---|---|---|---|---|
| 1 | `claimer` | yes | **yes** | connected wallet; pays the tx fee and the rent of the two PDAs on their first creation |
| 2 | `recipient` | yes | no | must equal `claimer` (`BadAccount` otherwise) |
| 3 | `claimRecord` | yes | no | PDA `["claim", claimer]`, created if missing |
| 4 | `faucet` | yes | no | PDA `["faucet"]`, created if missing; holds `dispensed` |
| 5 | `faucetVault` | yes | no | PDA `["faucet-vault"]`, the funded SOL |
| 6 | `systemProgram` | no | no | `11111111111111111111111111111111` |

Event `SolClaimed { claimer, amount, lifetime_claimed, pool_dispensed }`.

**A wallet at zero SOL cannot claim.** The first claim creates two PDAs (`claim`, and `faucet` if it is
new) and the claimer pays their rent (about 0.0018 SOL) plus the tx fee. Devnet SOL for gas has to come
from somewhere else (faucet.solana.com, or an existing wallet). The 0.11 SOL itself always comes from
the faucet. The UI lane should ask for the gas top-up before showing the claim button, or send it from
a warm wallet.

### PDAs (devnet, program `GtdcPM3...`)

| Account | Address |
|---|---|
| `faucet` | [`ENGP4XiyiMRmEPKnVkxY1PZ69kTARebud6hoz75r5n3b`](https://explorer.solana.com/address/ENGP4XiyiMRmEPKnVkxY1PZ69kTARebud6hoz75r5n3b?cluster=devnet) |
| `faucet-vault` | [`BgtBRka9TEQa5revD2D1A46mG9rppXRqHF5F6h3tNyt`](https://explorer.solana.com/address/BgtBRka9TEQa5revD2D1A46mG9rppXRqHF5F6h3tNyt?cluster=devnet) |

### Faucet receipts (devnet, 2026-10-03)

Funded with the full 1.0 SOL. The wallet held 6.54 SOL before funding and **5.52266132 SOL after**.

| Item | Value |
|---|---|
| Program upgrade tx (adds `claim_sol`) | [`5SSnfgMjMPHKP2dBjfL9U96KxkvHgPhYmbz26RZiQUKR3EL4PpFbYGGjT6ndtuAxECXSZrZ3efZ5Fy4G63tUL8xM`](https://explorer.solana.com/tx/5SSnfgMjMPHKP2dBjfL9U96KxkvHgPhYmbz26RZiQUKR3EL4PpFbYGGjT6ndtuAxECXSZrZ3efZ5Fy4G63tUL8xM?cluster=devnet) |
| Faucet funding tx (1.0 SOL) | [`3LHGdeynWJb4YTSFAYLiSaBKwr8WVHGbfDZki5dsWvzpfxXxW9wHZNJz9psGTGzcugvLKFbPqzYcE2DpdVvDwVyR`](https://explorer.solana.com/tx/3LHGdeynWJb4YTSFAYLiSaBKwr8WVHGbfDZki5dsWvzpfxXxW9wHZNJz9psGTGzcugvLKFbPqzYcE2DpdVvDwVyR?cluster=devnet) |
| Faucet vault after the run | `0.67` SOL (1.0 funded - 0.33 lifetime cap fully used) |

Proven from a brand-new address, `DpKcFpzz9JMe3cvgGSCynxPMPGVWAuLgaCr3pSGqB5e3`, which was funded with
0.02 SOL of gas first ([`2hzD1FiRQNPzfZCSyJJiRFhhMLM891BbfRgfVdPEfEvcznxn9WTNXmgC77b16DR3dtmNBQn7qaih85C3mbSY1qUY`](https://explorer.solana.com/tx/2hzD1FiRQNPzfZCSyJJiRFhhMLM891BbfRgfVdPEfEvcznxn9WTNXmgC77b16DR3dtmNBQn7qaih85C3mbSY1qUY?cluster=devnet))
because the devnet airdrop was rate limited at the time:

| Claim | Result | Tx |
|---|---|---|
| 0.11 SOL, fresh wallet | **succeeds** (balance 0.02 -> 0.1284 SOL, i.e. +0.1084 after rent and fees) | [`4Z9SGgTuFjDR8hXuHyCAyi4RUi4q6cK7yRtQeury4b3WhDLnUmg2DDFxFd6m9Sa5bX1N4qHZGr8pJpSZxnkj4zwE`](https://explorer.solana.com/tx/4Z9SGgTuFjDR8hXuHyCAyi4RUi4q6cK7yRtQeury4b3WhDLnUmg2DDFxFd6m9Sa5bX1N4qHZGr8pJpSZxnkj4zwE?cluster=devnet) |
| 0.5 SOL, over the per-claim maximum | **rejected**, `ClaimTooLarge` (6019) | [`43oNQ9Y8uQ6frzhQ42iKLacYY6X8BumzVPG1kgTHfBYJtpmgZ6jbgCLBeEuHNTJtESfMVzxUDrPFNypX2CErsKnD`](https://explorer.solana.com/tx/43oNQ9Y8uQ6frzhQ42iKLacYY6X8BumzVPG1kgTHfBYJtpmgZ6jbgCLBeEuHNTJtESfMVzxUDrPFNypX2CErsKnD?cluster=devnet) |
| 0.11 SOL, second | succeeds | [`3AmAcWQPDQ46t236TiskVicXBtVe5SukFAUPj6sj3BMfY3BcgSvsvekkby83CfUGMqdEvF5pd4yfnbEk7WQnEoAM`](https://explorer.solana.com/tx/3AmAcWQPDQ46t236TiskVicXBtVe5SukFAUPj6sj3BMfY3BcgSvsvekkby83CfUGMqdEvF5pd4yfnbEk7WQnEoAM?cluster=devnet) |
| 0.11 SOL, third (lifetime total 0.33) | succeeds | [`5X72hLAjgDUuz5oXiT3kyK6NehqkQHMQJU6DvdWS8nPbgH718nodAhgSwwvqX4qAzXv36XUNgVi1UFrTZ9HMAuEb`](https://explorer.solana.com/tx/5X72hLAjgDUuz5oXiT3kyK6NehqkQHMQJU6DvdWS8nPbgH718nodAhgSwwvqX4qAzXv36XUNgVi1UFrTZ9HMAuEb?cluster=devnet) |
| 0.01 SOL, over the lifetime ceiling | **rejected**, `ClaimLifetimeCap` (6020) | [`381fJs3YZrghAaAtVZMnUsTqNuLqiQykgHNwxWNEndZ5uJp1k3sYezHQsgCnutvLdqUfmJtk2GXbQ57adKzk6Ckm`](https://explorer.solana.com/tx/381fJs3YZrghAaAtVZMnUsTqNuLqiQykgHNwxWNEndZ5uJp1k3sYezHQsgCnutvLdqUfmJtk2GXbQ57adKzk6Ckm?cluster=devnet) |

**Ticket money untouched.** Campaign 1's vault
[`7iSvSBMT7fzk1Rei32AEaVpmhry2TvCQFEG6H8kdyJU5`](https://explorer.solana.com/address/7iSvSBMT7fzk1Rei32AEaVpmhry2TvCQFEG6H8kdyJU5?cluster=devnet)
held `100000000` lamports immediately before the five claims above and `100000000` immediately after.
The faucet vault's derivation contains no campaign key, so this is structural, not incidental.

#### Deploying to devnet: what actually happened

Operational history, because repeating this is painful and the obvious command does not work here.

`solana program deploy` failed twice with **`Error: Data writes to account failed: Custom error: Max
retries exceeded`** (after ~35 and ~60 minutes). The cause is not the program:

- The deploy wallet needs about **2.75 SOL** for one attempt, because the loader's *buffer* account
  holds 2.50133612 SOL of rent while the binary is staged. That rent is returned when the upgrade
  succeeds, but an abandoned buffer keeps it, so a failed attempt must be cleaned up.
- `api.devnet.solana.com` rate limits by IP. The CLI's buffer writes plus signature-status polling
  trip the limit, the writes start failing, and it exhausts its retries. The endpoint is also load
  balanced, so a blockhash returned by one node frequently fails preflight simulation on another
  ("Blockhash not found"). The public alternatives are no better: Ankr and Alchemy need keys,
  Chainstack and Helius need keys, `drpc.org` and `rpcpool.com` refuse or throttle.
- Two orphan buffers (`F9YgeCAZyEPShEGaUSejCYgzzLJVTM3Y8f7k5LHB9bWA`, `7EouipyDP5ghNGXFZq1RMkAkSshjAFmEVLzDsg6Uwwkm`),
  2.50133612 SOL each, were reclaimed with `solana program close <buffer> --keypair <dev wallet>`;
  the buffer authority is the deploy wallet, so no separate key is needed. Nothing is stuck.

**What worked:** `scripts/write-buffer.js` creates the loader buffer and fills it itself, 850 bytes per
transaction with a 2 s gap, using only the two trivial loader instructions (`InitializeBuffer`,
`Write`). 580 chunks took about 46 minutes and never hit a 429. Then:

```
node scripts/write-buffer.js target/deploy/cryptoball.so /tmp/faucet-buffer.json
solana program deploy target/deploy/cryptoball.so \
  --program-id GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC \
  --keypair ~/.tape/cryptoball-deploy.json --buffer /tmp/faucet-buffer.json \
  --max-len 492216 --use-rpc
```

The CLI finds the buffer already full, so it does no writes at all and only performs the upgrade.
Programdata was already resized to 492,261 bytes and funded to 2,501,336,120 lamports (exactly
rent-exempt at this cluster's 5080 lamports/byte over two years) by the earlier attempts.

If you ever deploy this again, budget **2.75 SOL up front** and use the script; a dedicated devnet RPC
would remove the 2 s gap and most of the 46 minutes.

`scripts/faucet-proof.js` regenerates the claim receipts above.

| Error code | Number | Message |
|---|---|---|
| `ClaimTooLarge` | 6019 | Claim amount is zero or above the per-claim maximum |
| `ClaimLifetimeCap` | 6020 | This wallet has reached its lifetime faucet cap |
| `FaucetDrained` | 6021 | The faucet pool is exhausted |
| `FaucetEmpty` | 6022 | The faucet vault holds less than the claim amount |
| `BadAccount` | 6011 | Account does not match the derived address |

## Layout

```
programs/cryptoball/   Anchor program (instructions, state, events, errors, constants, winner.rs)
tests/                 ts-mocha + LiteSVM: harness.ts, one test file per instruction, lifecycle; fixtures/mpl_core.so = devnet Core binary
app/                   React + Vite player app (Prime Time design, 3D ticket, draw-night ball drop); src/tokens.css = design tokens; src/program.ts = devnet program adapter (builds Anchor instructions); src/passkeyWallet.ts = passkey (Wallet Standard) wallet
docs/                  requirements, design, diagrams
scripts/                write-buffer.js (devnet upgrade through the RPC rate limit), faucet-proof.js (claim receipts)
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
node --test ops/*.test.mjs  # ops guardrails (limits, duplicate, staggering, admin guards, IDL), no chain
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

The job is **not installed by default**: this worktree is disposable and the captain picks the
cadence after seeing the cost below.

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

### Campaign 4 (opened by the ops tool, `ops/open-game.mjs`)

| Item | Value |
|---|---|
| Campaign / vault | [`FrqfHBZZXFbcMmmNNxQrEa6v6iKUZmLY6TPGC23EMbNq`](https://explorer.solana.com/address/FrqfHBZZXFbcMmmNNxQrEa6v6iKUZmLY6TPGC23EMbNq?cluster=devnet) / `5tJFojqskJB5WYawL7fZp26idtaeKibiM7MAaMsChJve` |
| Core collection | `864AF5VajM9pn9F81iieBRpBLcGnyXMCy11H6rJSwutm` |
| Parameters | 0.1 SOL, cap 1000, closes 2026-10-03T12:20:45Z (opened 2026-10-03T02:20:45Z) |
| create_campaign tx | [`3BWhYTCvZsuv2t6Xqq35p6KLZj9HrQSexL6iX45BCNdMcW2ddjGewSHEDocDuj42Ua3w7p5k82ZwTqCzkhhDbvP2`](https://explorer.solana.com/tx/3BWhYTCvZsuv2t6Xqq35p6KLZj9HrQSexL6iX45BCNdMcW2ddjGewSHEDocDuj42Ua3w7p5k82ZwTqCzkhhDbvP2?cluster=devnet) |
| Cost to the deploy wallet | 0.002956400 SOL (2,956,400 lamports), measured by balance delta |

Opened by `node ops/open-game.mjs --price 0.1 --duration 10 --cap 1000` on the deployed program.
Not yet visible in the web app: `CAMPAIGN_IDS` in `app/src/program.ts` still lists `[1]` only, and
that list is player-facing app policy, not ops. `open-game` prints the reminder on every open.

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
| cancel_campaign tx (campaign 2, after the timeout) | [`2H4hzq8u4pR6hVM6CnWEVqUtjAiPPeVrUUdqb5uiF8neJXkHKPpGXDQceXvFNa54k7DoWqa46pvBmWJuUJtRZMTx`](https://explorer.solana.com/tx/2H4hzq8u4pR6hVM6CnWEVqUtjAiPPeVrUUdqb5uiF8neJXkHKPpGXDQceXvFNa54k7DoWqa46pvBmWJuUJtRZMTx?cluster=devnet) |
| refund_ticket tx (campaign 2, ticket `9N2LtqdDkUksWPGdotDaJbKSken2Kid3JfkShyk7YdH`) | [`5FT6CDsE5FqTa3pRLvdqvcsEFFu2v713Ueg25awdXbMs8d64DnGZHRquN5FwpsyAzTMNg4npC27FXPZrcWGfgCqB`](https://explorer.solana.com/tx/5FT6CDsE5FqTa3pRLvdqvcsEFFu2v713Ueg25awdXbMs8d64DnGZHRquN5FwpsyAzTMNg4npC27FXPZrcWGfgCqB?cluster=devnet) |

**What actually happened to draw 2, end to end.** The commit landed and `commit_draw` accepted it, but the oracle never revealed: `reveal_slot` stayed `0` and the value stayed all-zero for the whole ~5.5 h the draw sat committed. When `REVEAL_TIMEOUT_SECS` (1 h after `committed_at`) elapsed, anyone could - and did - call `cancel_campaign`, then `refund_ticket` themselves. Result read back from chain afterwards: campaign state `Cancelled`, ticket status `Refunded`, vault drained to `0`, and the buyer's wallet up by **0.099985 SOL** (the 0.1 SOL ticket price less transaction fees). That is the honest outcome: a draw nobody could finish cost the buyer nothing, and the timeout path is proven on-chain rather than only in tests.

Campaign 3 is committed the same way against a second live oracle (`6zNYHErDrEwFJnVESwwMBvJE8tp2AUNypnNWviVHLefz`) and is also sitting unrevealed; it resolves the same way whenever anyone calls `cancel_campaign` after its timeout.

#### Randomness operations (what it actually takes)

- **No crank.** The On-Demand program has no crank instruction (`randomness_init`, `randomness_commit`, `randomness_reveal`, `oracle_heartbeat_v2`, ... - full list in the on-chain IDL). The oracle pays for its own reveal, so there is nothing for us to fund.
- **What does matter:** commit against an oracle that is *actually initialized* in the queue, and a reachable Switchboard gateway. Our first commit named `9Thge4ZEgKG8LcYFfz3J3zqMeAq4SsLEu8ACa6CGUeqd`, an address the SDK returned while `gateway.switchboard.xyz` was failing - that account does not exist on chain, so nothing was ever going to answer it.
- **Observed state (2026-10-02, devnet):** `gateway.switchboard.xyz` and `crossbar.switchboard.xyz` are unreachable (no HTTP response; `docs.switchboard.xyz` answers fine). The queue is alive (`lastHeartbeat` within `nodeTimeout`), and 9 of its 78 oracles are initialized, but commits against two different live oracles sat unrevealed for hours. The reveal is produced by Switchboard's off-chain oracle network, which we do not control.
- **If the oracle never answers:** the campaign is not stuck, and this is proven above. After `REVEAL_TIMEOUT_SECS` (1 h) anyone can `cancel_campaign` and every buyer refunds themselves.
- **Cost:** a draw costs the ticket (0.1 SOL devnet placeholder) plus account rent; the randomness account, campaign and Core assets together are about 0.006 SOL of rent. The reveal itself costs us nothing.
- **Deferral for mainnet:** a draw must not depend on a laptop and a third party's uptime. Production needs a keeper service that watches `close_ts`, commits, retries, and settles, plus an oracle-selection path that fails loudly rather than committing to an address that may not exist. Until that exists, keep devnet, where play money is at stake.
