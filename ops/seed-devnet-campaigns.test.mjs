import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_MANIFEST, existingCampaignAction, existingConfigAction, parseArgs, validateManifest } from "./seed-devnet-campaigns.mjs";

const manifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));

test("seed config is devnet-only and pins both deployed program identities and the USDC mint", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ ...manifest, cluster: "mainnet-beta" }), /devnet/);
  assert.throws(() => validateManifest({ ...manifest, lossless: { ...manifest.lossless, mint: "So11111111111111111111111111111111111111112" } }), /pinned devnet USDC/);
  assert.throws(() => validateManifest({ ...manifest, sol: { ...manifest.sol, programId: "11111111111111111111111111111111" } }), /program IDs/);
  assert.throws(() => validateManifest({ ...manifest, sol: { ...manifest.sol, feeBps: 2_001 } }), /SOL campaign parameters/);
});

test("a repeated seed is a no-op only when the existing campaign exactly matches", () => {
  assert.equal(existingCampaignAction(undefined, { id: 18n }), "create");
  assert.equal(existingCampaignAction({ id: 18n, closeTs: 1_791_936_000 }, { id: "18", closeTs: 1_791_936_000 }), "exists");
  assert.throws(() => existingCampaignAction({ id: 18n, closeTs: 1 }, { id: "18", closeTs: 2 }), /refusing to overwrite/);
});

test("existing lossless config is never silently mutated", () => {
  assert.equal(existingConfigAction(undefined, {}), "initialize");
  const expected = { mint: "mint", admin: "admin", treasury: "admin", treasuryToken: "ata", feeBps: 250 };
  assert.equal(existingConfigAction(expected, expected), "exists");
  assert.throws(() => existingConfigAction({ ...expected, treasuryToken: "other" }, expected), /refusing to mutate deployment identity/);
});

test("seed command is read-only unless --send is explicit", () => {
  assert.equal(parseArgs([]).send, false);
  assert.equal(parseArgs(["--send"]).send, true);
  assert.equal(parseArgs(["--manifest", "ops/custom.json"]).manifest.endsWith("ops/custom.json"), true);
  assert.throws(() => parseArgs(["--unknown"]), /unexpected argument/);
});
