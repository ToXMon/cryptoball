# Devnet roadmap

Branch: `lossless-vault`. Target: a playable devnet campaign, not mainnet.

## Week 1 — vaults and the draw

1. Add campaign mode `lossless` beside the current house-edge mode.
2. Campaign vault holds principal. Prize vault starts at zero.
3. Ticket PDA stores buyer, amount, and slot.
4. `settle_draw` maps the Switchboard value onto the ticket list and pays the recorded buyer from the prize vault.
5. Withdrawal returns the same amount. Test a campaign with one ticket, ten equal tickets, and a zero prize.

Gate: one settled devnet campaign with a non-zero mock prize, and one settled campaign with a zero prize.

## Week 2 — harvest check and mock adapter

1. `deposit_yield` and `harvest_yield`.
2. Mock adapter. The faucet funds the yield increase.
3. Harvest moves only `current_value - principal_deposited`.
4. A falling adapter pauses new deposits.
5. Keeper key `HFErx83zcw8L3Cp6jeyb8hpnZC5LPvQGfsqkaYx2yGL5` runs harvest, commit, and settle.

Gate: harvest transaction and settlement transaction both linked from the campaign page.

## Week 3 — points, fee, token lock

1. Points: one per dollar per day, burned on withdrawal, no odds effect.
2. Fee: 10% of harvest to the fee wallet, 90% to the prize vault.
3. Campaign open locks one token and sets adapter and cap.
4. Vote account: locked tokens plus points. Vote sets the fee split and the cap.

Gate: a campaign opened with a locked token, a fee transfer, and a points balance that does not change the winner.

## Week 4 — show it

1. Passkey wallet deposits and withdraws.
2. Page shows prize before close, odds as deposit share, and both transactions after settle.
3. Keep the house-edge program at `GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC` unchanged.

Mainnet is not this roadmap. Mainnet needs the same gates on a real Kamino or Jupiter Lend reserve, a cap, a pause, and a published reserve address.
