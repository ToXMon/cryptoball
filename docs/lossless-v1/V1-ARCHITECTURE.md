# Cryptoball V1 end-to-end architecture

Method from solana-rust-dev-companion: requirements, then diagram, then code. Security is a design input. The house-edge program `GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC` is not this program.

Diagram: `cryptoball-v1-full-architecture.html`.

## Requirements

1. A player can deposit USDC with the passkey wallet and later withdraw the same amount.
2. The deposit writes a ticket PDA: buyer, amount, deposit slot.
3. The campaign vault holds principal. The prize vault starts at zero.
4. `harvest_yield` may move only `current_value - principal_deposited`. A shortfall pauses new deposits.
5. Ninety percent of a harvest goes to the prize vault. Ten percent goes to the fee wallet.
6. Devnet harvests a mock adapter funded by the faucet. Mainnet harvests Kamino USDC and Jupiter Lend USDC through one router.
7. A borrow against the deposit is not an adapter.
8. After close, the keeper commits a Switchboard random value. `settle_draw` maps it onto the ticket list.
9. A campaign with at least one ticket has one winner. Odds are the deposit share. The 5/69 numbers are display only.
10. Settlement pays the recorded buyer from the prize vault in the same transaction. An empty prize vault settles at zero.
11. Points accrue at one point per dollar per day, burn on withdrawal, and do not change odds.
12. Opening a campaign locks one token and sets the adapter and the cap. A deposit does not require the token.
13. Votes are locked tokens plus points. Voters set the fee split and the cap. They cannot spend principal.
14. The keeper key for devnet tests is `HFErx83zcw8L3Cp6jeyb8hpnZC5LPvQGfsqkaYx2yGL5`.

## Instructions

- `open_campaign` — admin or token lock. Creates vaults and sets adapter, cap, close time.
- `deposit` — player. Moves USDC to the campaign vault. Writes the ticket and starts points.
- `withdraw` — player, after settle or cancel. Returns the same amount. Burns points.
- `deposit_yield` / `harvest_yield` — keeper. Supply and harvest. Harvest has the increase-only check.
- `commit_draw` / `settle_draw` — keeper. Switchboard, then pay the selected ticket from the prize vault.
- `set_fee_split` — vote result. Burn share or treasury share. Cannot touch principal.

## Accounts

- Config PDA: fee bps = 1000, allowed adapters, pause flag.
- Campaign PDA: mode, close time, principal total, prize total, adapter id.
- Campaign vault and prize vault: token accounts.
- Ticket PDA: `[ticket, campaign, index]`.
- Points PDA: `[points, campaign, buyer]`.
- Lock PDA: one token locked for the open campaign.

## Build order

Vaults and ticket, then settle against a mock prize, then the harvest check, then points and the fee split. Do not wire USDY, a loop, or an odds boost in this build.
