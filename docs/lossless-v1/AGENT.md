# Cryptoball lossless V1 — agent brief

Read this file before changing the program. It is the product contract for the `lossless-vault` branch.

## Goal

A Solana savings vault with a draw. The player deposits USDC. The deposit comes back. Switchboard selects one existing ticket. The winner is paid from harvested yield only. Solana fees are the reason a small deposit can enter and leave without becoming a loss.

Existing devnet program, house-edge version: `GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC`. Do not overwrite it. This branch is the lossless program.

Devnet keeper key for tests: `HFErx83zcw8L3Cp6jeyb8hpnZC5LPvQGfsqkaYx2yGL5`. The player path is the existing passkey wallet. The keeper is not the player.

## Rules that do not change

- Withdrawal returns the same token amount the player deposited.
- `harvest_yield` may move only `current_value - principal_deposited`. If value falls below principal, the harvest is zero and new deposits pause.
- A borrow against the deposit is not an adapter.
- The random value selects one existing ticket. It does not match 5/69 numbers. A campaign with at least one ticket has one winner.
- Odds are the deposit share.
- The 5/69 numbers may be shown. They are not the win test.
- A deposit does not require the token. Points do not change odds and do not pay yield.

## V1 accounts

- Ticket PDA: buyer, amount, deposit slot.
- Campaign vault: principal.
- Prize vault: harvest only.
- Yield router: splits supply across Kamino USDC and Jupiter Lend USDC, harvests both into the one prize vault.
- Devnet uses a mock adapter funded by the existing faucet, so a prize can be demoed before a money market is wired.

## Draw

Keeper calls `commit_draw`, then `settle_draw`. Settlement pays the recorded buyer from the prize vault in the same transaction. An empty prize vault still settles. The prize is zero.

## Fee and token

Ten percent of the harvest is the protocol fee. Ninety percent is the prize. The fee buys the token and burns it, or moves to a DAO treasury. Voters set that split. Opening a campaign locks one token and sets the adapter and the cap. Votes are locked tokens plus points. Points are one point per dollar per day, non-transferable, burned on withdrawal.

## Out of scope for the first devnet deploy

USDY, syrupUSDC, ONyc, commodity vaults, leveraged loops, odds boosts, number-match rollover.

## Docs in this folder

- `roadmap.md` — devnet build order.
- `gamification.md` — player-facing toys.
- `tokenomics.md` — fee, vote, burn.
- `rwa-strategies.md` — later campaigns.
- `tokenomics-architecture.html` and `gamification-architecture.html` — diagrams.

## Sources used to set this scope

- PoolTogether V5: prize vault, yield source, prize pool, draw. Principal is not the prize. https://dev.pooltogether.com/protocol/design/
- Kamino USDC supply about 4.3%. Jupiter Lend USDC about 4.08% on 7 October 2026.
- Ondo USDY is Treasury-backed and accrues in price. Nysa USDC-against-USDY market was announced for 19 October 2026.
- Turbin3 Q3 2026 builders list: Token Extensions, Anchor, LiteSVM, RWA and money-market notes. No decompiler.
- Will Wright: a small rule set, a large possibility space, the player tells the story, a replay is not punished.
