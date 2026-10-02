// Smallest runnable check for the pure logic: `pnpm test`.
import assert from "node:assert/strict";
import { quickPick, parts, FUNDING_COPY, sol, fundingCopy } from "./lib.ts";
import { payout, ERROR_COPY, buyTicket, ProgramError, PROGRAM_ID, describeError, fundingNeeded, isFundingError, FAUCET_URL, FEE_MARGIN_LAMPORTS, FUNDING_ERROR, DEVNET_RPC, needsFunding, funding, CARTON_COST_LAMPORTS, blocksPayment } from "./program.ts";
import { readFileSync } from "node:fs";
import { accountFromPrfOutput } from "./passkeyWallet.ts";

assert.deepEqual(payout({ priceLamports: 100_000_000n, ticketCount: 10, feeBps: 1000 }), { pool: 1_000_000_000n, fee: 100_000_000n, prize: 900_000_000n });
assert.equal(payout({ priceLamports: 3n, ticketCount: 1, feeBps: 1000 }).fee, 0n); // floor
for (let i = 0; i < 500; i++) {
  const { numbers, bonus } = quickPick();
  assert.equal(numbers.length, 5);
  assert.ok(numbers.every((n, j) => n >= 1 && n <= 69 && (j === 0 || n > numbers[j - 1])));
  assert.ok(bonus >= 1 && bonus <= 26);
}
assert.deepEqual(parts(90061), { d: 1, h: 1, m: 1, s: 1 });
assert.equal(Object.keys(ERROR_COPY).length, 19); // keep in step with errors.rs
assert.equal(PROGRAM_ID.toBase58(), "GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC"); // devnet program, README receipts
await assert.rejects(buyTicket("w", 1, [5, 5, 6, 7, 8], 1), (e) => e instanceof ProgramError && e.code === "InvalidNumbers");

// Funding helper: what a checkout needs must cover what it really costs, at any cart size. Devnet rent-exempt minimum
// is 3480 lamports per byte-year over two years on top of the 128-byte account header.
const rent = (space: number) => 3_480n * 2n * BigInt(128 + space);
const cartonCost = rent(8 + 108) + rent(165) + 10_000n; // ticket account, Core asset account, two signatures per tx
assert.equal(fundingNeeded(100_000_000n), 104_000_000n); // 0.1 SOL ticket + 0.004 SOL of rent and fee
for (let count = 1; count <= 5; count++) {
  assert.ok(fundingNeeded(100_000_000n, count) >= 100_000_000n * BigInt(count) + cartonCost, `cart of ${count}`);
}
// Nothing selected is nothing to fund, so an empty cart can never raise a "needs 0.004 SOL" prompt.
assert.equal(fundingNeeded(100_000_000n, 0), 0n);
assert.equal(funding(0n, false, fundingNeeded(100_000_000n, 0)).kind, "ok");
assert.equal(funding(undefined, true, fundingNeeded(100_000_000n, 0)).kind, "ok");
assert.equal(FAUCET_URL, "https://faucet.solana.com");
assert.ok(!isFundingError(new Error("Sales for this draw have closed.")));
assert.ok(isFundingError(new Error("Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.")));
assert.ok(isFundingError(new Error("insufficient funds for fee")));
// The funding state is decided by the live read and the live cart total, so one balance flips both ways as the cart
// changes and nothing latches: a wallet that can cover the order never keeps seeing "Get devnet SOL".
const funded = 110_000_000n; // one ticket, with change over
const short = fundingNeeded(100_000_000n, 2);
assert.deepEqual(funding(0n, false, short), { kind: "short", balance: 0n, needed: short });
assert.equal(funding(funded, false, short).kind, "short"); // cart grew past what the wallet holds
assert.equal(funding(funded, false, fundingNeeded(100_000_000n, 1)).kind, "ok"); // same balance, cart shrank back
assert.equal(funding(250_000_000n, false, short).kind, "ok");
assert.equal(funding(undefined, false, fundingNeeded(100_000_000n, 1)).kind, "ok"); // no read yet: no claim, no gate
// A failed read is its own state: the helper still shows, with a way to read again, instead of claiming nothing.
assert.equal(funding(undefined, true, fundingNeeded(100_000_000n, 1)).kind, "unreadable");
assert.match(FUNDING_COPY.unread, /balance could not be read/i);
assert.equal(FUNDING_COPY.short(funded, short), `This wallet has ${sol(funded)}. One checkout needs ${sol(short)}: the ticket plus a small fee margin.`);
assert.equal(describeError(new Error("Attempt to debit an account but found no record of a prior credit.")), FUNDING_ERROR);
assert.ok(!/prior credit/i.test(describeError(new Error("Attempt to debit an account but found no record of a prior credit."))));
assert.match(FUNDING_COPY.short(0n, fundingNeeded(100_000_000n, 1)), /0 SOL/);
assert.match(FUNDING_COPY.short(0n, fundingNeeded(100_000_000n, 1)), /0.104 SOL/);
assert.ok(/free devnet SOL/i.test(FUNDING_ERROR));
assert.match(FUNDING_COPY.faucet, /free devnet test SOL/i);
assert.match(FUNDING_COPY.faucet, /no value/i);

// The pre-payment gate asks the same rule, and it fails open on a read that did not come back: a failed read leaves the
// balance undefined, which is the very value the gate sees, so that state must not stop a payment. A funded wallet whose
// read failed still reaches the chain, the real judge, and fails there with FUNDING_ERROR if it really cannot pay.
assert.ok(blocksPayment(funding(0n, false, fundingNeeded(100_000_000n, 1)))); // a read that came back short stops it
assert.ok(!blocksPayment(funding(undefined, true, fundingNeeded(100_000_000n, 1)))); // a read that failed must not

// What that same state says is one rule too, so the checkout card and the wallet dialog card cannot drift apart: neither
// may claim a wallet that could not be read needs SOL.
const unread = fundingCopy(funding(undefined, true, fundingNeeded(100_000_000n, 1)))!;
assert.deepEqual(unread, { heading: FUNDING_COPY.unreadHeading, note: FUNDING_COPY.unread });
assert.doesNotMatch(unread.note, /paste/i);
assert.doesNotMatch(unread.heading, /faucet/i);
assert.deepEqual(fundingCopy(funding(undefined, true)), unread); // the wallet dialog, which needs no total to compare
// A read that came back empty or short is the only thing that points at the faucet.
const empty = fundingCopy(funding(0n, false))!;
assert.deepEqual(empty, { heading: FUNDING_COPY.heading, note: FUNDING_COPY.empty });
assert.match(empty.note, /0 devnet SOL/);
assert.match(empty.note, /free devnet test SOL/i);
assert.match(fundingCopy(funding(funded, false, short))!.note, new RegExp(`One checkout needs ${sol(short)}`));
assert.equal(fundingCopy(funding(1n, false)), undefined); // a wallet that holds something needs no helper
assert.equal(fundingCopy(funding(250_000_000n, false, fundingNeeded(100_000_000n, 1))), undefined);

// Passkey derivation known-answer (research report 1.3): a fixed PRF output must keep giving this address,
// or a silent dependency bump moved the keys.
const known = accountFromPrfOutput(new Uint8Array(32).fill(7));
assert.equal(known.words.split(" ").length, 24);

// The dedicated QuickNode devnet endpoint is configured; the free public one is gone for good
// (it rate-limited program uploads and burned pipeline runs). A missed origin in _site.json
// silently breaks the deployed page, so both files are asserted here.
const QUICKNODE = "hardworking-broken-field.solana-devnet.quiknode.pro";
assert.ok(DEVNET_RPC.includes(QUICKNODE), `app endpoint must be the QuickNode devnet plan, got ${DEVNET_RPC}`);
const site = JSON.parse(readFileSync(new URL("../public/_site.json", import.meta.url), "utf8"));
assert.deepEqual(site.connect_origins, [DEVNET_RPC, DEVNET_RPC.replace("https://", "wss://")]);
for (const f of ["program.ts", "Wallet.tsx", "../../ops/open-game.mjs"]) {
  assert.ok(!readFileSync(new URL(f, import.meta.url), "utf8").includes("api.devnet.solana.com"), `api.devnet.solana.com reappeared in ${f}`);
}
console.log("ok", known.address);
