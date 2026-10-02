// Smallest runnable check for the pure logic: `pnpm test`.
import assert from "node:assert/strict";
import { quickPick, parts, FUNDING_COPY, sol } from "./lib.ts";
import { payout, ERROR_COPY, buyTicket, ProgramError, PROGRAM_ID, describeError, fundingNeeded, isFundingError, FAUCET_URL, FEE_MARGIN_LAMPORTS, FUNDING_ERROR, DEVNET_RPC, needsFunding } from "./program.ts";
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

// Funding helper: ticket price plus a fee margin, and the unfunded-wallet errors that must never surface raw.
assert.equal(fundingNeeded(100_000_000n), 110_000_000n); // 0.1 SOL ticket + 0.01 SOL fee margin
assert.equal(fundingNeeded(100_000_000n, 3), 310_000_000n);
assert.equal(FEE_MARGIN_LAMPORTS, 10_000_000n);
assert.equal(FAUCET_URL, "https://faucet.solana.com");
assert.ok(!isFundingError(new Error("Sales for this draw have closed.")));
assert.ok(isFundingError(new Error("Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.")));
assert.ok(isFundingError(new Error("insufficient funds for fee")));
// The funding state is decided by the live read and the live cart total, so one balance flips both ways as the cart
// changes and nothing latches: a wallet that can cover the order never keeps seeing "Get devnet SOL".
const funded = 110_000_000n; // exactly one ticket plus the fee margin
assert.equal(needsFunding(0n, fundingNeeded(100_000_000n, 2)), true);
assert.equal(needsFunding(funded, fundingNeeded(100_000_000n, 2)), true); // cart grew past what the wallet holds
assert.equal(needsFunding(funded, fundingNeeded(100_000_000n, 1)), false); // same balance, cart shrank back
assert.equal(needsFunding(250_000_000n, fundingNeeded(100_000_000n, 2)), false);
assert.equal(needsFunding(undefined, fundingNeeded(100_000_000n, 1)), false); // no read yet: no claim about the wallet
assert.equal(FUNDING_COPY.short(funded, fundingNeeded(100_000_000n, 2)), `This wallet has ${sol(funded)}. One checkout needs ${sol(210_000_000n)}: the ticket plus a small fee margin.`);
assert.equal(describeError(new Error("Attempt to debit an account but found no record of a prior credit.")), FUNDING_ERROR);
assert.ok(!/prior credit/i.test(describeError(new Error("Attempt to debit an account but found no record of a prior credit."))));
assert.match(FUNDING_COPY.short(0n, 110_000_000n), /0 SOL/);
assert.match(FUNDING_COPY.short(0n, 110_000_000n), /0\.11 SOL/);
assert.ok(/free devnet SOL/i.test(FUNDING_ERROR));
assert.match(FUNDING_COPY.paste, /free devnet test SOL/i);
assert.match(FUNDING_COPY.faucet, /free devnet test SOL/i);
assert.match(FUNDING_COPY.faucet, /no value/i);

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
