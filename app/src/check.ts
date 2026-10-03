// Smallest runnable check for the pure logic: `pnpm test`.
import assert from "node:assert/strict";
import { quickPick, parts } from "./lib.ts";
import { payout, ERROR_COPY, buyTicket, ProgramError, PROGRAM_ID, DEVNET_RPC } from "./program.ts";
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
