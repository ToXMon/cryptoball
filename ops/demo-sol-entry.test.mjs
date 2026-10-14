import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_PICK, entryAction, parseArgs } from "./demo-sol-entry.mjs";

const ticket = { buyer: "buyer", index: 0, status: "Active", numbers: DEMO_PICK.numbers, bonus: DEMO_PICK.bonus };

test("entry is repeat-safe only for the identical active first ticket", () => {
  assert.equal(entryAction(undefined, { ...DEMO_PICK, buyer: "buyer" }), "buy");
  assert.equal(entryAction(ticket), "unverified");
  assert.equal(entryAction(ticket, { ...DEMO_PICK, buyer: "buyer" }), "exists");
  assert.throws(() => entryAction({ ...ticket, buyer: "other" }, { ...DEMO_PICK, buyer: "buyer" }), /refusing to buy twice/);
  assert.throws(() => entryAction({ ...ticket, numbers: [1, 2, 3, 4, 5] }, { ...DEMO_PICK, buyer: "buyer" }), /refusing to buy twice/);
});

test("entry command is read-only unless explicitly sent", () => {
  assert.equal(parseArgs([]).send, false);
  assert.equal(parseArgs(["--send"]).send, true);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--mainnet"]), /usage/);
});
