# Lossless V1 devnet prototype

This is a separate Anchor program from the SOL raffle:

- Raffle program: `GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC`
- Lossless V1 prototype: `EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF`

The prototype uses the six-decimal devnet USDC test asset and an admin-funded mock adapter. It does not use mainnet USDC, a lending venue, or an oracle. The commit seed is caller-supplied deterministic test data; rejection sampling makes the index mapping unbiased *if the seed is uniform*, but this prototype does not provide secure randomness or a fair live draw.

## App

[Open the permanent static app](https://robust-diner-7jvk.here.now/) and choose **USDC prototype** (or `#/lossless`). This route is read-only account discovery; it does not offer deposit, admin, or settlement transactions. No config or demo campaign account is seeded, so the list stays empty until an admin initializes and creates one.

## Accounting

- Deposits transfer test-USDC into a principal-only vault and create one position PDA per wallet/campaign. Shares equal deposited base units; new deposits require tracked yield to be harvested first so later positions cannot capture earlier yield. A campaign supports at most 24 positions so its one-transaction snapshot settlement fits Solana's packet limit. Larger campaigns need batched settlement. A deposit is eligible starting one slot later, and commit waits until the last deposit's slot has passed.
- `mock_value` is an explicit ledger, not the raw token-account balance. Admin-only `mock_accrue` funds mock value; direct token donations do not mint shares or count as yield. `mock_loss` moves funds into a PDA sink to exercise shortfall handling.
- Harvest uses only `max(mock_value - principal_liability, 0)`. Fee is admin-configurable up to 250 bps; integer rounding floors the fee and the exact remainder enters one isolated prize vault. No principal pays fees or prizes.
- In shortfall, deposits, harvest payouts, and draw commit stop. While no draw is committed, users can withdraw immediately; otherwise withdrawal is available after settlement or timeout/cancel. Payout is the position's pro-rata share of tracked assets (`floor(shares * mock_value / liabilities)`), so a simulated loss is allocated pro rata rather than hidden or guaranteed away.
- Commit requires all tracked yield to be harvested first, then snapshots share supply, position count, prize balance, and slot. Settlement verifies the complete bounded, canonically ordered set of position PDAs and pays only the snapshotted prize. Settlement is one-shot. A draw can settle with a zero prize.
- Open campaigns can be cancelled after close; committed draws can be cancelled after one hour. Cancellation returns the recorded prize to mock value, then enables withdrawals.

The single prize bucket deliberately omits the competing draft's grand-pot split and the earlier draft's 10/90 split. Sponsor funds are omitted because sponsor refund/cancellation rules are not specified. Token issuance, points, governance, buyback/burn, real Kamino/Jupiter CPI, production randomness, mainnet, yield/profit guarantees, and legal claims are deferred.

This is test code for devnet only. It is not production-ready and makes no principal-safety, yield, profitability, or legal-classification claims.
