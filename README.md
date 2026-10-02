# Cryptoball

Crypto lottery on Solana. Anchor program + React frontend. **Devnet-only MVP, play money, no real funds.**

Raffle-style: players buy tickets with SOL (5 numbers from 1-69 plus a Cryptoball bonus ball from 1-26, up to 5 tickets per checkout, quick-pick available). Each ticket mints a Metaplex Core NFT receipt. After the campaign closes, anyone commits and then settles a Switchboard On-Demand randomness draw; one ticket wins, 10 percent goes to the treasury, and the program pays the winner's wallet in the same transaction. No claim step.

## Status

Phases 1 to 2 (requirements, architecture, scaffold) and the frontend phase. The program is interface stubs only: every instruction returns `NotImplemented`, so the web app runs against a mock adapter (`app/src/program.ts`, in-memory campaigns, fake signatures) until the IDL lands. Build order is `docs/design.md` section 17.

| Doc | What |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 88 atomic requirements, decisions traceability, out-of-scope list |
| [docs/design.md](docs/design.md) | Account map, PDA seeds, instructions, state machine, CPI plan, threat model, swappable winner unit |
| [docs/diagrams/](docs/diagrams/) | D1-D9 architecture diagrams (SVG) |

## Layout

```
programs/cryptoball/   Anchor program (stubs, state, events, errors, constants, winner.rs)
tests/                 ts-mocha harness (seed smoke test now; per-instruction tests in phase 3)
app/                   React + Vite player app (Prime Time design, 3D ticket, draw-night ball drop); src/tokens.css = design tokens; src/program.ts = mock program adapter
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
pnpm install && pnpm test         # ts-mocha seed smoke test
cd app && pnpm install && pnpm dev   # also: pnpm test (pure-logic check), pnpm build
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
