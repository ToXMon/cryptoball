# Cryptoball

Crypto lottery on Solana. Anchor program + React frontend. **Devnet-only MVP, play money, no real funds.**

Raffle-style: players buy tickets with SOL (5 numbers from 1-69 plus a Cryptoball bonus ball from 1-26, up to 5 tickets per checkout, quick-pick available). Each ticket mints a Metaplex Core NFT receipt. After the campaign closes, anyone commits and then settles a Switchboard On-Demand randomness draw; one ticket wins, 10 percent goes to the treasury and the program pays the winner's wallet (`ticket.buyer`, never the NFT owner) in the same transaction. No claim step.

## Status

Phases 1 to 2 (requirements, architecture, scaffold), the frontend phase and the Phase 3 program build: all instructions implemented (`initialize`, `update_config`, `nominate_admin`, `accept_admin`, `create_campaign`, `buy_ticket`, `commit_draw`, `settle_draw`, `cancel_campaign`, `refund_ticket`), each with happy-path and negative tests on LiteSVM (`tests/0*.test.ts`) plus a lifecycle and conservation test. `settle_draw` also derives the 5-of-69 plus Cryptoball display numbers (`winner::winning_numbers`, unbiased rejection sampling, fails closed instead of falling back to modulo); `initialize` takes the treasury as an account; `close_campaign` is still not built (design.md section 5).
The program is **live on devnet** (receipts below) and the web app talks to it for real: `app/src/program.ts` builds `buy_ticket` / `refund_ticket` instructions against the deployed program id and the devnet RPC. The web app also offers a **passkey wallet** (`app/src/passkeyWallet.ts`): a Wallet Standard wallet whose ed25519 key is derived on the player's device from a WebAuthn passkey PRF output via [mera](https://mera.category.xyz) 0.2.0. It is a plain keypair, not a smart account; installed wallets (Phantom and friends) remain as a second path in the same dialog.
`settle_draw` reads the value the oracle persisted in the randomness account, so settlement is not bound to the exact reveal slot; it must still land inside the same window `cancel_campaign` uses (see the receipts' operational notes). Build order is `docs/design.md` section 17.

| Doc | What |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 88 atomic requirements, decisions traceability, out-of-scope list |
| [docs/design.md](docs/design.md) | Account map, PDA seeds, instructions, state machine, CPI plan, threat model, swappable winner unit |
| [docs/diagrams/](docs/diagrams/) | D1-D9 architecture diagrams (SVG) |

## Layout

```
programs/cryptoball/   Anchor program (instructions, state, events, errors, constants, winner.rs)
tests/                 ts-mocha + LiteSVM: harness.ts, one test file per instruction, lifecycle; fixtures/mpl_core.so = devnet Core binary
app/                   React + Vite player app (Prime Time design, 3D ticket, draw-night ball drop); src/tokens.css = design tokens; src/program.ts = devnet program adapter (builds Anchor instructions); src/passkeyWallet.ts = passkey (Wallet Standard) wallet
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
cd app && pnpm install && pnpm dev   # also: pnpm test (pure-logic check), pnpm build
```

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
