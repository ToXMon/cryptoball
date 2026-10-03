// node --test ops/  - pure logic only, no chain.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validate, findDuplicate, staggeredDuration, parseArgs, LIMITS, loadIdl, idlCandidates, COMMITTED_IDL, PROGRAM_ID } from "./open-game.mjs";

const now = 1_700_000_000_000;
const open = (priceLamports, closeTs, id = 1n, state = { open: {} }) => ({ id, priceLamports: BigInt(priceLamports), closeTs: BigInt(closeTs), state });

test("rejects prices below the program floor and says why", () => {
  assert.throws(() => validate({ price: 0.001, cap: 100, duration: 8, now }), /MIN_TICKET_PRICE_LAMPORTS/);
});

test("rejects caps outside 1..MAX_TICKETS", () => {
  assert.throws(() => validate({ price: 0.1, cap: 0, duration: 8, now }), /--cap 0/);
  assert.throws(() => validate({ price: 0.1, cap: LIMITS.maxTickets + 1, duration: 8, now }), /--cap/);
});

test("accepts a normal campaign and computes the close time", () => {
  const v = validate({ price: 0.1, cap: 1000, duration: 8, now });
  assert.equal(v.priceLamports, 100_000_000n);
  assert.equal(v.closeTs, Math.floor(now / 1000) + 8 * 3600);
});

test("duplicate guard matches same price with an overlapping open window", () => {
  const c = open(100_000_000n, 1_700_010_000, 4n); // closes 1h after now
  assert.ok(findDuplicate([c], 100_000_000n, 1_700_010_500, 1_700_000_000));
  assert.equal(findDuplicate([c], 200_000_000n, 1_700_010_500, 1_700_000_000), undefined); // different price
  assert.equal(findDuplicate([c], 100_000_000n, 1_700_010_500, 1_700_500_000), undefined); // already closed
  assert.equal(findDuplicate([c], 100_000_000n, 1_700_100_000, 1_700_000_000), undefined); // closes 24h apart, no overlap
  assert.equal(findDuplicate([open(100_000_000n, 1_700_010_000, 4n, { cancelled: {} })], 100_000_000n, 1_700_010_500, 1_700_000_000), undefined);
});

test("durations stagger and wrap", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(staggeredDuration), [6, 10, 14, 6, 10]);
});

test("flag parsing", () => {
  const a = parseArgs(["--price", "1", "--duration", "12", "--cap", "500", "--dry-run"]);
  assert.deepEqual(a, { dryRun: true, allowDuplicate: false, price: 1, duration: 12, cap: 500, id: undefined });
  assert.equal(parseArgs(["--allow-duplicate"]).allowDuplicate, true);
  assert.throws(() => parseArgs(["--price"]), /needs a value/);
  assert.throws(() => parseArgs(["--nope", "1"]), /unknown flag/);
});

test("the committed IDL is what a fresh clone resolves, and it is the deployed program", () => {
  assert.equal(idlCandidates()[0], COMMITTED_IDL, "committed IDL must be preferred over target/");
  const idl = loadIdl();
  assert.equal(idl.address, PROGRAM_ID);
  assert.ok(idl.instructions.some((i) => i.name === "create_campaign"), "create_campaign must be in the committed IDL");
});

test("a missing or unreadable IDL fails loudly instead of needing a toolchain", () => {
  assert.throws(() => loadIdl(["ops/cryptoball.idl.json", "target/idl/cryptoball.json"].map((p) => `/nonexistent/${p}`)), /no IDL found.*cryptoball\.idl\.json.*no target\/idl build/s);
  const junk = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "idl-")), "cryptoball.json");
  fs.writeFileSync(junk, "{ not json");
  assert.throws(() => loadIdl([junk]), /unreadable/);
});
