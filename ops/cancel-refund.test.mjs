// node --test ops/  - pure logic only, no chain.
import test from "node:test";
import assert from "node:assert/strict";
import { cancelEligibility, parseArgs, REVEAL_TIMEOUT_SECS } from "./cancel-refund.mjs";

const committedAt = 1_700_000_000;
const drawCommitted = (state = { drawCommitted: {} }) => ({ state, closeTs: BigInt(committedAt - 60), committedAt: BigInt(committedAt) });

test("a stuck DrawCommitted campaign becomes cancellable one second after the reveal deadline", () => {
  const c = drawCommitted();
  assert.equal(cancelEligibility(c, committedAt + REVEAL_TIMEOUT_SECS).ok, false, "not yet at the deadline");
  const ready = cancelEligibility(c, committedAt + REVEAL_TIMEOUT_SECS + 1);
  assert.equal(ready.ok, true);
  assert.match(ready.why, /reveal timeout passed/);
});

test("settled and cancelled campaigns are not cancellable, and say so", () => {
  assert.match(cancelEligibility(drawCommitted({ settled: {} }), committedAt + 9_999).why, /only Open or DrawCommitted/);
  assert.match(cancelEligibility(drawCommitted({ cancelled: {} }), committedAt + 9_999).why, /already cancelled/);
});

test("flag parsing needs a positive integer id", () => {
  assert.deepEqual(parseArgs(["--id", "3"]), { id: 3, dryRun: false });
  assert.equal(parseArgs(["--id", "3", "--dry-run"]).dryRun, true);
  assert.throws(() => parseArgs([]), /--id needs the campaign id/);
  assert.throws(() => parseArgs(["--id"]), /--id needs a value/);
  assert.throws(() => parseArgs(["--id", "x"]), /positive integer/);
  assert.throws(() => parseArgs(["--nope"]), /unexpected argument/);
});