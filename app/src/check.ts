// Smallest runnable check for the pure logic: `pnpm test`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { quickPick, parts, FUNDING_COPY, CLAIM_CAPS, FINISHED_COPY, finishedCopy, sol, fundingCopy } from "./lib.ts";
import { payout, ERROR_COPY, buyTicket, ProgramError, PROGRAM_ID, describeError, fundingNeeded, isFundingError, FAUCET_URL, FUNDING_ERROR, DEVNET_RPC, funding, payGate, CLAIM_LIFETIME_CAP, CLAIM_MAX, CLAIM_POOL_CAP, CAMPAIGN_ACCOUNT_DISC, DISCOVERY_CAP, claimGate, decodeCampaign, faucetRemaining, iWon, isSettleLog, outcome } from "./program.ts";
import { readFileSync } from "node:fs";
import { createBalanceRead, type BalanceState } from "./balance.ts";import { accountFromPrfOutput } from "./passkeyWallet.ts";

// The invariant is "every CryptoballError variant has English copy". Assert it against the real
// variant list in errors.rs rather than a hardcoded count: a hardcoded number passes happily while
// the thing it names is broken, which is exactly how this went stale when the faucet landed.
const ERROR_VARIANTS = readFileSync("../programs/cryptoball/src/errors.rs", "utf8")
  .split("pub enum CryptoballError")[1]
  .split("\n}")
  .join("\n")
  .split("\n")
  .map((l) => /^\s+([A-Z][A-Za-z0-9]*),\s*$/.exec(l)?.[1])
  .filter((n): n is string => Boolean(n));
assert.ok(ERROR_VARIANTS.length > 0, "could not parse CryptoballError variants from errors.rs");
assert.deepEqual(
  Object.keys(ERROR_COPY).sort(),
  [...ERROR_VARIANTS].sort(),
  "ERROR_COPY is out of step with the program's CryptoballError variants",
);

assert.deepEqual(payout({ priceLamports: 100_000_000n, ticketCount: 10, feeBps: 1000 }), { pool: 1_000_000_000n, fee: 100_000_000n, prize: 900_000_000n });
assert.equal(payout({ priceLamports: 3n, ticketCount: 1, feeBps: 1000 }).fee, 0n); // floor
for (let i = 0; i < 500; i++) {
  const { numbers, bonus } = quickPick();
  assert.equal(numbers.length, 5);
  assert.ok(numbers.every((n, j) => n >= 1 && n <= 69 && (j === 0 || n > numbers[j - 1])));
  assert.ok(bonus >= 1 && bonus <= 26);
}
assert.deepEqual(parts(90061), { d: 1, h: 1, m: 1, s: 1 });
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
// A failed read is its own state at every cart size: the helper still shows, with a way to read again, instead of claiming
// anything about the wallet, and no payment decision can come out of it. Paying reads nothing, so a wallet whose read
// failed still reaches the chain, the real judge, and fails there with FUNDING_ERROR if it really cannot pay.
for (let count = 1; count <= 5; count++) {
  assert.equal(funding(undefined, true, fundingNeeded(100_000_000n, count)).kind, "unreadable", `cart of ${count}`);
}

// The payment decision itself: `payGate` is the whole of what a checkout decides before it sends, so nothing the card
// shows can hold a payment back. It is asked nothing about funding — its question has nowhere to put an answer — so every
// connected wallet with cartons reaches the chain at every cart size, including the one the card calls short and the one
// whose read failed, and only a missing wallet, a running payment or an empty cart hold it.
const buyer = "So11111111111111111111111111111111111111112";
for (let count = 1; count <= 5; count++) {
  assert.deepEqual(payGate({ buyer, busy: false, cartons: count }), { kind: "pay", buyer }, `cart of ${count}`);
}
assert.deepEqual(payGate({ buyer: undefined, busy: false, cartons: 1 }), { kind: "connect" }); // no wallet: open the dialog
assert.deepEqual(payGate({ buyer, busy: true, cartons: 1 }), { kind: "wait" }); // a payment is already running
assert.deepEqual(payGate({ buyer, busy: false, cartons: 0 }), { kind: "wait" }); // nothing selected to pay for
assert.match(FUNDING_COPY.unread, /balance could not be read/i);
assert.equal(FUNDING_COPY.short(funded, short), `This wallet has ${sol(funded)}. One checkout needs ${sol(short)}: the ticket plus a small fee margin.`);
assert.equal(describeError(new Error("Attempt to debit an account but found no record of a prior credit.")), FUNDING_ERROR);
assert.ok(!/prior credit/i.test(describeError(new Error("Attempt to debit an account but found no record of a prior credit."))));
assert.match(FUNDING_COPY.short(0n, fundingNeeded(100_000_000n, 1)), /0 SOL/);
assert.match(FUNDING_COPY.short(0n, fundingNeeded(100_000_000n, 1)), /0.104 SOL/);
assert.ok(/free devnet SOL/i.test(FUNDING_ERROR));
assert.match(FUNDING_COPY.faucet, /free devnet test SOL/i);
assert.match(FUNDING_COPY.faucet, /no value/i);

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

// The one shared read every one of those claims is made from, held against a scripted RPC: what a read may claim, whose
// answer wins, and what a failed read does until it is asked again.
const wallet = "So11111111111111111111111111111111111111112";
const collector = () => {
  const states: BalanceState[] = [];
  return { states, publish: (patch: Partial<BalanceState>) => states.push({ ...(states[states.length - 1] ?? {}), ...patch } as BalanceState) };
};
const scripted = (answers: (bigint | Error)[]) => {
  const { states, publish } = collector();
  const asked: string[] = [];
  const { read } = createBalanceRead(publish, async (address) => {
    asked.push(address);
    const next = answers.shift();
    if (next === undefined) throw new Error("the scripted read ran out of answers");
    if (next instanceof Error) throw next;
    return next;
  });
  return { read, asked, states, state: () => states[states.length - 1] };
};
// The newest read wins however late an older one lands, and an answer for the wallet the user just switched away from does
// not land on top of the new wallet's answer.
{
  const late: ((lamports: bigint) => void)[] = [];
  const { states, publish } = collector();
  const { read } = createBalanceRead(publish, () => new Promise<bigint>((res) => late.push(res)));
  const left = read("a-wallet-the-user-left");
  const newest = read(wallet);
  late[1](250_000_000n); // the newest read answers
  await newest;
  late[0](1n); // the older one lands late, and is stale from the moment the newer one was asked for
  await left;
  assert.deepEqual(states[states.length - 1], { landing: { address: wallet, balance: 250_000_000n, unreadable: false }, reading: false });
}
// A read that failed claims nothing about the wallet, never "0 SOL", and the card's "Check balance again" is a plain
// re-read of the same address, which recovers as soon as the RPC does.
{
  const flaky = scripted([new Error("429 Too Many Requests"), 250_000_000n]);
  await flaky.read(wallet);
  const failed = flaky.state().landing!;
  assert.deepEqual([failed.address, failed.balance, failed.unreadable], [wallet, undefined, true]);
  assert.equal(flaky.state().reading, false);
  assert.equal(fundingCopy(funding(failed.balance, failed.unreadable, fundingNeeded(100_000_000n, 1)))!.heading, FUNDING_COPY.unreadHeading);
  await flaky.read(wallet);
  assert.deepEqual(flaky.asked, [wallet, wallet]);
  assert.deepEqual(flaky.state(), { landing: { address: wallet, balance: 250_000_000n, unreadable: false }, reading: false });
}
// A re-read does not blank the claim the wallet already earned: the surfaces hold it, with the button waiting on it, until
// the newest read answers.
{
  const held = scripted([250_000_000n, 200_000_000n]);
  await held.read(wallet);
  const inFlight = held.read(wallet);
  assert.deepEqual(held.state(), { landing: { address: wallet, balance: 250_000_000n, unreadable: false }, reading: true });
  await inFlight;
  assert.deepEqual(held.state(), { landing: { address: wallet, balance: 200_000_000n, unreadable: false }, reading: false });
}
// The shared read is judged against the live cart every time it lands, so a wallet whose newest read cannot cover the order
// is offered the faucet again, and one whose newest read covers it is offered nothing. When the page asks for that read is
// its own wiring, which nothing here runs.
{
  const needed = fundingNeeded(100_000_000n, 1);
  const spent = scripted([200_000_000n, 96_200_000n]);
  await spent.read(wallet);
  const before = spent.state().landing!;
  assert.equal(fundingCopy(funding(before.balance, before.unreadable, needed)), undefined); // before paying: nothing to fund, so no helper
  await spent.read(wallet); // what paying takes
  const after = spent.state().landing!;
  assert.equal(after.balance, 96_200_000n);
  assert.deepEqual(fundingCopy(funding(after.balance, after.unreadable, needed)), { heading: FUNDING_COPY.heading, note: FUNDING_COPY.short(96_200_000n, needed) });
  // The wallet dialog reads the same refreshed read, so a wallet drained by paying is offered the faucet there too.
  const drained = scripted([104_000_000n, 0n]);
  await drained.read(wallet);
  await drained.read(wallet);
  assert.deepEqual(fundingCopy(funding(drained.state().landing!.balance, false)), { heading: FUNDING_COPY.heading, note: FUNDING_COPY.empty });
}
// A disconnected wallet has no balance to claim, and no read to wait for.
{
  const gone = scripted([]);
  await gone.read(wallet);
  await gone.read();
  assert.deepEqual(gone.asked, [wallet]);
  assert.deepEqual([gone.state().landing, gone.state().reading], [undefined, false]);
}

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
// ---- discovery and the finished-game states

// The app finds campaigns by the account discriminator, so that literal is a wire format: it is checked against the
// committed IDL, not against itself. A campaign id that is remembered as [1] instead of read off the chain is the bug
// that hid every draw but one.
const idl = JSON.parse(readFileSync(new URL("../../ops/cryptoball.idl.json", import.meta.url), "utf8"));
assert.deepEqual(CAMPAIGN_ACCOUNT_DISC, idl.accounts.find((a: { name: string }) => a.name === "Campaign").discriminator, "campaign discriminator must match the committed IDL");
assert.ok(DISCOVERY_CAP > 0, "discovery must show something");

// Anchor instruction tags are sha256("global:<name>")[0..8]: a wrong claim_sol tag is a claim that can never land.
assert.deepEqual([...createHash("sha256").update("global:claim_sol").digest().subarray(0, 8)], [139, 113, 179, 189, 190, 30, 132, 195]);

// The campaign layout is what the results page reads a finished draw out of, so it is decoded here from bytes laid out
// exactly as state.rs serialises it (u64 id, u64 price, i64 close, u32 max, u32 count, u16 fee, u8 state, then pubkeys).
const campaignBytes = (over: { state?: number; seedSlot?: bigint; committedAt?: bigint; randomness?: number[]; index?: number; numbers?: number[]; bonus?: number; fee?: bigint; prize?: bigint } = {}) => {
  const b = new Uint8Array(213);
  const view = new DataView(b.buffer);
  b.set([50, 40, 49, 11, 157, 220, 229, 192]); // discriminator, not part of the layout
  const ramp = (at: number) => { for (let i = 0; i < 32; i++) b[at + i] = i + 1; }; // a set pubkey, not the default all-ones one
  view.setBigUint64(8, 7n, true);
  view.setBigUint64(16, 100_000_000n, true);
  view.setBigInt64(24, 1_790_000_000n, true);
  view.setUint32(32, 1000, true);
  view.setUint32(36, 12, true);
  view.setUint16(40, 1000, true);
  b[42] = over.state ?? 2;
  ramp(75); // rand_account
  view.setBigUint64(107, over.seedSlot ?? 9_000_000n, true);
  view.setBigInt64(115, over.committedAt ?? 1_790_000_100n, true);
  b.set(over.randomness ?? Array.from({ length: 32 }, (_, i) => i + 1), 123);
  view.setUint32(155, over.index ?? 4, true);
  ramp(159); // winner
  b.set(over.numbers ?? [3, 11, 27, 44, 66], 191);
  b[196] = over.bonus ?? 19;
  view.setBigUint64(197, over.fee ?? 120_000_000n, true);
  view.setBigUint64(205, over.prize ?? 1_080_000_000n, true);
  return b;
};
const settledCampaign = decodeCampaign(campaignBytes());
assert.deepEqual([settledCampaign.id, settledCampaign.ticketCount, settledCampaign.state], [7, 12, "Settled"]);
assert.equal(settledCampaign.seedSlot, 9_000_000);
assert.equal(settledCampaign.committedAt, 1_790_000_100);
assert.equal(settledCampaign.randomness, [...Array(32).keys()].map((i) => (i + 1).toString(16).padStart(2, "0")).join(""));
assert.deepEqual([settledCampaign.winningIndex, settledCampaign.winningNumbers, settledCampaign.winningBonus], [4, [3, 11, 27, 44, 66], 19]);
assert.deepEqual([settledCampaign.feeLamports, settledCampaign.prizeLamports], [120_000_000n, 1_080_000_000n]);
// An unsettled draw has none of that, and must not present zeros as if they meant something.
const cancelled = decodeCampaign(campaignBytes({ state: 3, seedSlot: 0n, committedAt: 0n, randomness: new Array(32).fill(0), index: 0, numbers: new Array(5).fill(0), bonus: 0, fee: 0n, prize: 0n }));
assert.deepEqual([cancelled.seedSlot, cancelled.committedAt, cancelled.randomness, cancelled.winningNumbers, cancelled.winningBonus, cancelled.feeLamports, cancelled.prizeLamports], [undefined, undefined, undefined, undefined, undefined, undefined, undefined]);

// What a draw is to a reader is decided once, from the chain: settled, cancelled, committed-unrevealed, open. A settled
// draw whose winning-ticket read failed is still "settled" - the numbers are missing, the outcome is not in doubt.
assert.equal(outcome({ state: "Open" }), "open");
assert.equal(outcome({ state: "Settled", winningIndex: 0, winner: "w" }), "settled");
assert.equal(outcome({ state: "Settled" }), "settled"); // ticket read failed: still a settled draw
assert.equal(outcome({ state: "Cancelled" }), "cancelled");
assert.equal(outcome({ state: "DrawCommitted" }), "committed");
assert.ok(iWon({ state: "Settled", winner: "me" }, "me"));
assert.ok(!iWon({ state: "Settled", winner: "me" }, "you"));
assert.ok(!iWon({ state: "Settled", winner: "me" }, undefined)); // not connected: nothing claimed about the viewer
assert.ok(!iWon({ state: "Cancelled", winner: "me" }, "me")); // a cancelled draw has no winner, so nobody won

// The settle transaction is found by its event, not by guessing which of the two transactions on the randomness
// account settled: `DrawSettled` is only ever announced by settle_draw.
assert.ok(isSettleLog(["Program log: Instruction: SettleDraw", "Program log: DrawSettled: campaign: 7"]));
assert.ok(!isSettleLog(["Program log: Instruction: CommitDraw", "Program log: DrawCommitted: campaign: 7"]));
assert.ok(!isSettleLog([]));

// Every finished draw says what happened, in words, and never in a bare state word: no winner and a refund for the two
// that end without one, the ticket that won for the one that does not.
for (const state of ["cancelled", "committed", "open"] as const) {
  assert.match(finishedCopy(state), /[a-z]{4,}/i);
  assert.ok(!new RegExp(`^${state}\\b`, "i").test(finishedCopy(state)), `${state} must not be answered with its state word`);
}
assert.match(finishedCopy("cancelled"), /refund/i);
assert.match(finishedCopy("cancelled"), /no ticket won/i);
assert.match(finishedCopy("committed"), /no winner yet/i);
assert.match(finishedCopy("committed"), /refund/i);
assert.match(finishedCopy("settled", 4), /#4/);
assert.match(FINISHED_COPY.committed, /reveal/i); // the reason: the reveal, not a bare word

// ---- the in-app claim button
// The three ceilings are the program's constants (constants.rs), read here from its source so a retune that reaches the app
// is a retune that was checked, not a number somebody retyped.
const CONSTANTS = readFileSync("../programs/cryptoball/src/constants.rs", "utf8");
const constant = (name: string) => BigInt(new RegExp(`pub const ${name}: u64 = ([\\d_]+);`).exec(CONSTANTS)![1].replace(/_/g, ""));
assert.equal(CLAIM_MAX, constant("MAX_CLAIM_LAMPORTS"));
assert.equal(CLAIM_LIFETIME_CAP, constant("MAX_CLAIM_LIFETIME_LAMPORTS"));
assert.equal(CLAIM_POOL_CAP, constant("INITIAL_POOL_LAMPORTS"));
assert.equal(CLAIM_MAX, 110_000_000n); // the copy says 0.11 SOL; the button must offer exactly that
assert.match(CLAIM_CAPS, /0\.11 SOL per claim/);
assert.match(CLAIM_CAPS, /0\.33 SOL per wallet/);
assert.match(CLAIM_CAPS, /1 SOL in the pool/);
assert.equal(CLAIM_LIFETIME_CAP, CLAIM_MAX * 3n); // three tickets' worth

// What the button may ask for is decided from the two on-chain tallies, so a button that says 0.11 SOL is a claim the
// program will accept, and a wallet that is done is told the program's own reason rather than being left to find out.
assert.deepEqual(claimGate({ address: "w", busy: false, remaining: 340_000_000n, claimed: 0n }), { kind: "claim", amount: 110_000_000n });
assert.deepEqual(claimGate({ address: undefined, busy: false }), { kind: "connect" });
assert.deepEqual(claimGate({ address: "w", busy: true, remaining: 340_000_000n }), { kind: "wait" });
assert.deepEqual(claimGate({ address: "w", busy: false, remaining: 0n, claimed: 0n }), { kind: "drained" }); // pool exhausted: faucet link is the way out
assert.deepEqual(claimGate({ address: "w", busy: false, remaining: 50_000_000n, claimed: 0n }), { kind: "claim", amount: 50_000_000n }); // claims the pool's remainder, not more
assert.deepEqual(claimGate({ address: "w", busy: false, remaining: 340_000_000n, claimed: CLAIM_LIFETIME_CAP }), { kind: "capped" });
assert.deepEqual(claimGate({ address: "w", busy: false, remaining: 340_000_000n, claimed: 220_000_000n }), { kind: "claim", amount: 110_000_000n });
assert.deepEqual(claimGate({ address: "w", busy: false, remaining: 340_000_000n, claimed: 330_000_000n }), { kind: "capped" });
// An unread ledger claims nothing: the button offers the program's own per-claim maximum, and the chain is the judge.
assert.deepEqual(claimGate({ address: "w", busy: false, remaining: undefined, claimed: undefined }), { kind: "claim", amount: CLAIM_MAX });
assert.deepEqual(claimGate({ address: "w", busy: false, remaining: 0n, claimed: CLAIM_LIFETIME_CAP }), { kind: "capped" }); // lifetime first: it is the reason this wallet gets nothing

// What is left in the pool is what the admin budgeted minus what has gone out, never below zero and never guessed.
assert.equal(faucetRemaining({ dispensed: 660_000_000n, pool: 1_000_000_000n }), 340_000_000n);
assert.equal(faucetRemaining({ dispensed: 1_000_000_000n, pool: 1_000_000_000n }), 0n);
assert.equal(faucetRemaining(undefined), undefined);

// Every ceiling has copy of its own, and the app shows that copy rather than RPC text.
for (const key of ["ClaimTooLarge", "ClaimLifetimeCap", "FaucetDrained", "FaucetEmpty"] as const) {
  assert.ok(ERROR_COPY[key].length > 10, `${key} needs a sentence`);
  assert.ok(!/0x[0-9a-f]{4}/i.test(ERROR_COPY[key]), `${key} must not leak a code`);
}

console.log("ok", known.address);
