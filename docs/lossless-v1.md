# Lossless V1 devnet prototype

This is a separate Anchor program from the SOL raffle:

- Raffle program: `GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC`
- Lossless V1 prototype: `EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF`

The prototype uses the six-decimal devnet USDC test asset and an admin-funded mock adapter. It does not use mainnet USDC, a lending venue, or an oracle. The commit seed is caller-supplied deterministic test data; rejection sampling makes the index mapping unbiased *if the seed is uniform*, but this prototype does not provide secure randomness or a fair live draw.

## App

[Open the permanent static app](https://robust-diner-7jvk.here.now/) and choose **USDC prototype** (or `#/lossless`). This route is read-only account discovery; it does not offer deposit, admin, or settlement transactions. No config or demo campaign account is seeded, so the list stays empty until an admin initializes and creates one.

## Deployment

- Program: [devnet explorer](https://explorer.solana.com/address/EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF?cluster=devnet)
- Deployment transaction: [25RNSh6LYUCt5UccauThLZ32vKeF1pjZWLvSBXA4Fh2CcuivuiP3K3vKGVHdD6jDjGtwhjZRyCMo8nFfxw88JdoD](https://explorer.solana.com/tx/25RNSh6LYUCt5UccauThLZ32vKeF1pjZWLvSBXA4Fh2CcuivuiP3K3vKGVHdD6jDjGtwhjZRyCMo8nFfxw88JdoD?cluster=devnet)

The existing SOL raffle program was not redeployed. No config or demo campaign account is seeded.

## Accounting

- Deposits transfer test-USDC into a principal-only vault and create one position PDA per wallet/campaign. Shares equal deposited base units; new deposits require tracked yield to be harvested first so later positions cannot capture earlier yield. A campaign supports at most 24 positions so its one-transaction snapshot settlement fits Solana's packet limit. Larger campaigns need batched settlement. A deposit is eligible starting one slot later, and commit waits until the last deposit's slot has passed.
- `mock_value` is an explicit ledger, not the raw token-account balance. Admin-only `mock_accrue` funds mock value; direct token donations do not mint shares or count as yield. `mock_loss` moves funds into a PDA sink to exercise shortfall handling.
- Harvest uses only `max(mock_value - principal_liability, 0)`. Fee is admin-configurable up to 250 bps; integer rounding floors the fee and the exact remainder enters one isolated prize vault. No principal pays fees or prizes.
- In shortfall, deposits, harvests, draws, and settlement stop. Withdrawals stay blocked until cancellation consolidates the outstanding prize into the principal recovery pool. Open shortfall campaigns can be cancelled immediately; healthy open campaigns still wait for close, and healthy committed draws still wait for the one-hour timeout. Payout is the position's pro-rata share of the remaining tracked assets (`floor(shares * mock_value / liabilities)`), so a simulated loss is allocated pro rata rather than hidden or guaranteed away.
- Commit requires all tracked yield to be harvested first, then snapshots share supply, position count, prize balance, and slot. Settlement verifies the complete bounded, canonically ordered set of position PDAs and pays only the snapshotted prize. Settlement is one-shot. A draw can settle with a zero prize, but an impaired committed draw must be cancelled instead.
- Open and impaired committed campaigns can be cancelled immediately; otherwise committed draws can be cancelled after one hour. Cancellation returns only the outstanding `prize_balance` to mock value, never a prize already paid to a winner, then enables pro-rata withdrawals.

The single prize bucket deliberately omits the competing draft's grand-pot split and the earlier draft's 10/90 split. Sponsor funds are omitted because sponsor refund/cancellation rules are not specified. Token issuance, points, governance, buyback/burn, real Kamino/Jupiter CPI, production randomness, mainnet, yield/profit guarantees, and legal claims are deferred.

This is test code for devnet only. It is not production-ready and makes no principal-safety, yield, profitability, or legal-classification claims.
