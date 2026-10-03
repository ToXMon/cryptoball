// node --test ops/admin.test.mjs  - argument and signer guards, no chain.
import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { parseArgs, guardNominate, guardAccept } from "./admin.mjs";

const KEY = new PublicKey("9ACfknztv9UqJLLccZnBgjxFNbkNZERMwJbikj4dait7");
const OTHER = new PublicKey("BgERvSGr6d4jDr53jaKF8eXqimgdFwVSTMc4ekR4o7c");
const config = (admin, pendingAdmin) => ({ admin, pendingAdmin });

test("subcommands parse", () => {
  assert.deepEqual(parseArgs(["status"]), { cmd: "status", nominee: undefined, wallet: undefined, help: false });
  assert.deepEqual(parseArgs(["nominate", KEY.toBase58()]).nominee, KEY.toBase58());
  assert.deepEqual(parseArgs(["accept", "--wallet", "/tmp/opener.json"]).wallet, "/tmp/opener.json");
  assert.equal(parseArgs(["--help"]).help, true);
});

test("arguments are refused with the reason", () => {
  assert.throws(() => parseArgs([]), /status \| nominate <pubkey> \| accept/);
  assert.throws(() => parseArgs(["rotate"]), /unknown command: rotate/);
  assert.throws(() => parseArgs(["nominate"]), /needs the nominee's pubkey/);
  assert.throws(() => parseArgs(["nominate", "not-a-pubkey"]), /not a pubkey/);
  assert.throws(() => parseArgs(["accept", KEY.toBase58()]), /unexpected argument/);
  assert.throws(() => parseArgs(["--wallet"]), /--wallet needs a path/);
  assert.throws(() => parseArgs(["status", "--nope"]), /unknown flag/);
});

test("nominate is only signed by the current admin", () => {
  assert.equal(guardNominate(KEY, config(KEY, null)).toBase58(), KEY.toBase58());
  assert.throws(() => guardNominate(OTHER, config(KEY, null)), /must be signed by the current admin .* but the signer is/);
  // a pending nomination does not make the nominee able to re-nominate
  assert.throws(() => guardNominate(OTHER, config(KEY, OTHER)), /current admin/);
});

test("accept is only signed by the nominee, and only when one is pending", () => {
  assert.equal(guardAccept(OTHER, config(KEY, OTHER)).toBase58(), OTHER.toBase58());
  assert.throws(() => guardAccept(KEY, config(KEY, OTHER)), /must be signed by the nominee/);
  assert.throws(() => guardAccept(OTHER, config(KEY, null)), /no pending admin on chain.*nominate/s);
  assert.throws(() => guardAccept(OTHER, config(OTHER, null)), /no pending admin on chain/);
});