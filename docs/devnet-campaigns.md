# Devnet campaign runbook

**Devnet only. Test assets only. Not production-ready.** Neither product guarantees principal safety, yield, profit, or a winning draw. Do not reuse this manifest or signing flow on mainnet.

## Current identities and receipts (2026-10-13)

| Product | Program / deployment | Campaign | Authority and terms | Transactions |
|---|---|---|---|---|
| SOL raffle | [`GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC`](https://explorer.solana.com/address/GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC?cluster=devnet) · [deployment](https://explorer.solana.com/tx/4JLGKSiRdpr5j7Xg2XUQyu56ZQ3CF8Q9JKNFA3iZfC2ebDHXjWHsrCuVreeep2byNMwSjZPNCLH5Nt3d5yj8sq4Y?cluster=devnet) | ID `20261013` · [`3ZXFmjkDCCJ7stwCEEvvCvGUvcMknSCTPiUpYVsETTx1`](https://explorer.solana.com/address/3ZXFmjkDCCJ7stwCEEvvCvGUvcMknSCTPiUpYVsETTx1?cluster=devnet) | Admin `9ACfknztv9UqJLLccZnBgjxFNbkNZERMwJbikj4dait7` · 0.01 SOL · fee snapshot 10% · cap 1,000 · closes `2026-10-14T00:00:00Z` | [`create_campaign`](https://explorer.solana.com/tx/FWQ1DvJR6MkcF6kcvZ6RisssDd2pepLvcWHB4UH78vzyX63B8RdjiAJwVF3Qamq44sGeTAKEb2UTsQp6TLHcru5?cluster=devnet) |
| SOL ticket 0 | Same program and campaign | Ticket index `0` · 7, 14, 21, 35, 49 + Cryptoball 11 · buyer `9ACfknztv9UqJLLccZnBgjxFNbkNZERMwJbikj4dait7` · Core asset [`5mY1v6Qx2G1K6qPQwfqfrdMMWm3ohKcDhDqiJPUp9xUT`](https://explorer.solana.com/address/5mY1v6Qx2G1K6qPQwfqfrdMMW3ohKcDhDqiJPUp9xUT?cluster=devnet) | Current state: Open, 1/1,000 sold | [`buy_ticket`](https://explorer.solana.com/tx/2cg1YzSbjZiTMyK6g9RRzCR2e5ap4kXKFATVFrHJCMF2AamrSe9rnyuRWu4S3QqRqnArZQH45Xu7CjtCnLVw8YoG?cluster=devnet) |
| Lossless V1 | [`EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF`](https://explorer.solana.com/address/EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF?cluster=devnet) · [deployment](https://explorer.solana.com/tx/25RNSh6LYUCt5UccauThLZ32vKeF1pjZWLvSBXA4Fh2CcuivuiP3K3vKGVHdD6jDjGtwhjZRyCMo8nFfxw88JdoD?cluster=devnet) | ID `1` · [`A6cpX75Dm8fRFpAAJ2Ttw5DzcvJiTnvU97EYsQPNsLQr`](https://explorer.solana.com/address/A6cpX75Dm8fRFpAAJ2Ttw5DzcvJiTnvU97EYsQPNsLQr?cluster=devnet) | Admin/treasury `9ACfknztv9UqJLLccZnBgjxFNbkNZERMwJbikj4dait7` · pinned devnet USDC mint [`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`](https://explorer.solana.com/address/4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU?cluster=devnet) · cap 10 USDC · 24 positions · 250 bps · closes `2026-10-14T23:00:00Z` · admin-funded mock only | [`initialize` config](https://explorer.solana.com/tx/5T2Jc3STvF2KfMuKPsgM3N5G66FLy2LbiUh6LvZtKFfXdui83SDSZmiLnugqDq7tuzGgoGxJut21pXXqLWvmDS9x?cluster=devnet) · [`create_campaign`](https://explorer.solana.com/tx/5DhbeVkMV7YknnKrtuimt3yDjT6Fr6odTqyaz5poaaKnaMuX5LxouxedDSP4DpBHDhFRoewbmVTuY745r1nKiP8z?cluster=devnet) |

Lossless Config PDA: `3Td96tBYXEUgjZNKcQMSUq3C3ai1m1c356aemcccNwAS`. Treasury USDC account: `8WoCSpACg4ofvGAaWt6ZvtAnxp44hjTPG3JDC9LFJg2E`. Campaign 1 principal/prize/mock-loss vaults: `GcYr2uzbNe5XZQrjhfobCLr9koh4TWUEHA2UeLtGB8Kk` / `7cazyvnGkxptgGGdzSt7sEEPLutgkQh5gozEceF7VJFT` / `6zPaoLyGmMT6BsVgcFS71kCYC8fHHeTmPGAcU1Xt3jUF`.

The receipt log from the seed script is `ops/log/devnet-campaigns.jsonl` (gitignored). This checked-in page is the durable, public receipt summary. Reconcile it against Explorer before operating.

## Safe seeding and replay

`ops/devnet-campaign-seed.json` pins the IDs, fees, mints, caps and UTC deadlines. Review it before every send. The script defaults to read-only account discovery and verifies program IDs, campaign PDAs, current authorities, the USDC mint, and existing campaign/config fields:

```sh
node ops/seed-devnet-campaigns.mjs                 # plan only; no key read or signature
node ops/seed-devnet-campaigns.mjs --send          # send only exact missing init/create instructions
node --experimental-strip-types ops/demo-sol-entry.mjs  # inspect the fixed SOL ticket plan
node --experimental-strip-types ops/demo-sol-entry.mjs --send
```

A matching campaign/config is a no-op on rerun. A reused ID with different parameters, an unexpected authority, a non-devnet RPC, or a changed Lossless mint is refused; there is no overwrite/reset path. The fixed SOL demo entry also refuses if ticket 0 belongs to another wallet or differs. For this seed it reads back the existing matching ticket rather than submitting a duplicate.

The raffle program pays the winning ticket's buyer automatically inside `settle_draw`; it has no separate prize-claim instruction. `claim_sol` is the capped devnet faucet, not a prize claim. Raffle draw randomness remains the deployed Switchboard commit/reveal path; the repository's LiteSVM lifecycle test uses fixed reveal bytes for reproducible settlement. Do not fake a devnet Switchboard reveal or upgrade the SOL program to add one.

## Play the USDC mock loop

Open `#/lossless` in the app. The page discovers only Lossless V1 accounts and displays principal, tracked mock value, prize balance, position count, close time, the connected wallet's estimated eligible-share fraction, and state. Use Circle's [devnet USDC faucet](https://faucet.circle.com/) to fund a wallet with this exact test mint; the admin token account currently has `0` USDC. No mainnet token is compatible.

1. Before close, connect the wallet and deposit a positive amount (up to six decimals). The program enforces the pinned mint, wallet ownership, cap, one position per wallet, and one-slot eligibility delay.
2. As the configured admin, `+1 USDC mock accrual` moves funded test-USDC into tracked mock value. Harvest transfers only tracked positive mock accrual: the configured 2.5% fee and remaining prize are separated from principal. A raw token donation is not yield.
3. After close and deposit maturity, commit the fixed 32-byte demo seed in the app, then reveal/settle. The seed and weighted index are deterministic test data—not an oracle, secure randomness, or a fair live draw. Settlement is one-shot and pays only the separate prize vault.
4. The position owner withdraws principal after settlement or cancellation. In shortfall, the program blocks new deposits, harvest payouts, and draw commit, while permitting proportional withdrawals; this can return less than deposited. Admin mock-loss controls exercise this state. After close, an uncommitted round can be cancelled; a committed test draw can be cancelled after the one-hour timeout, restoring prize value for withdrawals.
5. Replay means a newly seeded campaign with a new fixed ID. Terminal campaigns remain as receipts; do not reset their PDA.

The live USDC campaign is seeded but has no position yet because the admin's pinned-USDC account is empty. LiteSVM covers deposit, harvest, deterministic commit/settlement, one-shot replay rejection, insufficient funds, wrong authority/mint, timeout/cancel, shortfall/recovery and withdrawals. A live USDC deposit must wait for test-USDC funding; this is not represented as a completed on-chain gameplay receipt.

## Existing public site identity

Existing public tape remains **`HTzCcSXy5sWncaPuVbySqMAG4FCs7EkttpGRLR1urycJ` (id 816)** at <https://6ssmjmenn4d22yvgirrbdpc3h4u4pmkggp4uxpj3h52cnlnu2bdq.tape.site/>. Never create or switch tapes. The Lossless V1 prototype also has an existing here.now page at <https://robust-diner-7jvk.here.now/>; keep it distinct from the tape identity. The verified app build is now published to the same permanent here.now Site, <https://robust-diner-7jvk.here.now/> (version `01M4VC15F28QJKE9V5D09QMGVK`, updated 2026-10-13T19:32:39Z). The existing tape was neither created nor redeployed; its identity and URL are unchanged.
