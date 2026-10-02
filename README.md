# Cryptoball

Crypto lottery on Solana. Anchor program + React frontend. **Devnet-only MVP, play money, no real funds.**

Raffle-style: players buy tickets with SOL (5 numbers from 1-69 plus a Cryptoball bonus ball from 1-26, up to 5 tickets per checkout, quick-pick available). Each ticket mints a Metaplex Core NFT receipt. After the campaign closes, anyone commits and then settles a Switchboard On-Demand randomness draw; one ticket wins and 10 percent goes to the treasury at settle. Anyone may then call `payout_ticket`, which pays the prize to the winning ticket's buyer wallet (permissionless, destination fixed to `ticket.buyer`).

## Status

Phase 3 program build: all instructions implemented (`initialize`, `update_config`, `nominate_admin`, `accept_admin`, `create_campaign`, `buy_ticket`, `commit_draw`, `settle_draw`, `payout_ticket`, `cancel_campaign`, `refund_ticket`), each with happy-path and negative tests on LiteSVM (`tests/0*.test.ts`) plus a lifecycle and conservation test. Deviations from `docs/design.md`: `settle_draw` pays the fee and records the prize, a separate permissionless `payout_ticket` pays the winner (per-ticket fan-out, ticket status `Paid`); `settle_draw` also derives the 5-of-69 plus bonus display numbers (`winner::winning_numbers`); `initialize` takes the treasury as an account; `close_campaign` is still not built.

| Doc | What |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 88 atomic requirements, decisions traceability, out-of-scope list |
| [docs/design.md](docs/design.md) | Account map, PDA seeds, instructions, state machine, CPI plan, threat model, swappable winner unit |
| [docs/diagrams/](docs/diagrams/) | D1-D9 architecture diagrams (SVG) |

## Layout

```
programs/cryptoball/   Anchor program (stubs, state, events, errors, constants, winner.rs)
tests/                 ts-mocha + LiteSVM: harness.ts, one test file per instruction, lifecycle; fixtures/mpl_core.so = devnet Core binary
app/                   React + Vite shell; src/tokens.css = Prime Time design tokens
docs/                  requirements, design, diagrams
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
cd app && pnpm install && pnpm dev
```

## Receipts (devnet)

To be filled at devnet deploy (phase 3 onward). Cluster: devnet. Never mainnet.

| Item | Value |
|---|---|
| Program ID | _tbd (scaffold uses a placeholder id)_ |
| Cluster | devnet |
| Deploy tx | _tbd_ |
| Upgrade authority | _tbd_ |
| Git commit deployed | _tbd_ |
| initialize tx | _tbd_ |
| create_campaign tx (campaign, vault) | _tbd_ |
| buy_ticket txs (>= 3, >= 2 wallets, NFT assets) | _tbd_ |
| commit_draw tx and randomness account | _tbd_ |
| settle_draw tx, winning index, randomness value | _tbd_ |
| Treasury balance delta (expected fee) | _tbd_ |
| One negative devnet tx (e.g. second settle) | _tbd_ |
