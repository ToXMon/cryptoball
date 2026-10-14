# Lossless V1 devnet prototype

This is a separate Anchor program from the SOL raffle:

- Raffle program: `GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC`
- Lossless V1 prototype: `EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF`

The prototype uses the six-decimal devnet USDC test asset and an admin-funded mock adapter. It does not use mainnet USDC, a lending venue, or an oracle. The commit seed is caller-supplied deterministic test data; rejection sampling makes the index mapping unbiased *if the seed is uniform*, but this prototype does not provide secure randomness or a fair live draw.

## App

[Open the permanent static app](https://robust-diner-7jvk.here.now/) and choose **USDC prototype** (or `#/lossless`). The route supports wallet deposits and withdrawals, admin-only mock accrual/loss, and deterministic demo commit/reveal/settlement. The pinned devnet campaign and all campaign/config receipts are in [the campaign runbook](devnet-campaigns.md).

## Deployment

- Program: [devnet explorer](https://explorer.solana.com/address/EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF?cluster=devnet)
- Deployment transaction: [25RNSh6LYUCt5UccauThLZ32vKeF1pjZWLvSBXA4Fh2CcuivuiP3K3vKGVHdD6jDjGtwhjZRyCMo8nFfxw88JdoD](https://explorer.solana.com/tx/25RNSh6LYUCt5UccauThLZ32vKeF1pjZWLvSBXA4Fh2CcuivuiP3K3vKGVHdD6jDjGtwhjZRyCMo8nFfxw88JdoD?cluster=devnet)

The existing SOL raffle program and tape identity were not changed. The mock adapter is test-token-funded only; the prototype does not integrate a real yield venue.

## Accounting

- Deposits transfer test-USDC into a principal-only vault and create one position PDA per wallet/campaign. Shares equal deposited base units; new deposits require tracked yield to be harvested first so later positions cannot capture earlier yield. A campaign supports at most 24 positions so its one-transaction snapshot settlement fits Solana's packet limit. Larger campaigns need batched settlement. A deposit is eligible starting one slot later, and commit waits until the last deposit's slot has passed.
- `mock_value` is an explicit ledger, not the raw token-account balance. Admin-only `mock_accrue` funds mock value; direct token donations do not mint shares or count as yield. `mock_loss` moves funds into a PDA sink to exercise shortfall handling.
- Harvest uses only `max(mock_value - principal_liability, 0)`. Fee is admin-configurable up to 250 bps; integer rounding floors the fee and the exact remainder enters one isolated prize vault. No principal pays fees or prizes.
- In shortfall, deposits, harvest payouts, and draw commit stop. While no draw is committed, users can withdraw immediately; otherwise withdrawal is available after settlement or timeout/cancel. Open-shortfall payout is pro rata over tracked principal plus recorded prize (`floor(shares * (mock_value + prize_balance) / liabilities)`), drawing from principal then prize and clearing the final remainder, so a simulated loss is allocated pro rata without stranding prize or counting donations.
- Commit requires all tracked yield to be harvested first, then snapshots share supply, position count, prize balance, and slot. Settlement verifies the complete bounded, canonically ordered set of position PDAs and pays only the snapshotted prize. Settlement is one-shot; if the winner has no ATA, the app confirms a separate idempotent ATA-creation transaction before settlement. A draw can settle with a zero prize.
- Open campaigns can be cancelled after close; committed draws can be cancelled after one hour. Cancellation returns the recorded prize to mock value, then enables withdrawals.

The single prize bucket deliberately omits the competing draft's grand-pot split and the earlier draft's 10/90 split. Sponsor funds are omitted because sponsor refund/cancellation rules are not specified. Token issuance, points, governance, buyback/burn, real Kamino/Jupiter CPI, production randomness, mainnet, yield/profit guarantees, and legal claims are deferred.

This is test code for devnet only. It is not production-ready and makes no principal-safety, yield, profitability, or legal-classification claims.
