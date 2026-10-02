// B8: full lifecycle + conservation invariant (vault_in = fee + prize; vault drains to 0).
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { World, valueFor, PRICE } from "./harness";

describe("lifecycle + conservation", () => {
  it("create -> buy x6 (3 wallets) -> close -> commit -> reveal+settle (pays winner); treasury and vault conserve", async () => {
    const w = new World(); await w.init();
    const camp = await w.campaign(1n, { max: 10 });
    const wallets = [0, 1, 2].map(() => { const k = Keypair.generate(); w.fund(k); return k; });
    const owner: Keypair[] = [];
    for (let i = 0; i < 6; i++) {
      const k = wallets[i % 3]; owner.push(k);
      await w.buy(camp, k, [1 + i, 20, 30, 40, 50], 1 + i);
    }
    const vaultIn = w.bal(camp.vault);
    expect(vaultIn).to.equal(PRICE * 6n);

    const rnd = await w.commit(camp); // closes sales, commits
    w.setTime(w.now + 10n, w.slot + 2n);
    const value = valueFor(0xdeadbeefn);
    w.reveal(rnd, value);
    const idx = Number(0xdeadbeefn % 6n);

    const t0 = w.bal(w.treasury.publicKey), winner = owner[idx], w0 = w.bal(winner.publicKey);
    w.ok([await w.settleIx(camp, rnd, idx, winner.publicKey)], [w.payer]);

    const fee = w.bal(w.treasury.publicKey) - t0, prize = w.bal(winner.publicKey) - w0;
    expect(fee).to.equal(vaultIn / 10n);
    expect(fee + prize).to.equal(vaultIn); // conservation
    expect(w.bal(camp.vault)).to.equal(0n);
    const c = w.acct("campaign", camp.key);
    expect(c.winner.toBase58()).to.equal(winner.publicKey.toBase58());
    expect(c.feeLamports.toString()).to.equal(fee.toString());
    expect(c.prizeLamports.toString()).to.equal(prize.toString());
  });

  it("conservation holds across ticket counts and fee settings (incl. 0 % and 20 %)", async () => {
    for (const [fee, n, price] of [[0, 1, 2_000_000n], [2000, 3, 2_000_001n], [1000, 7, 123_456_789n], [1, 2, 999_999_999n]] as const) {
      const w = new World(); await w.init();
      w.ok([await w.m.updateConfig(fee, null).accountsPartial({ admin: w.admin.publicKey, config: (await import("./harness")).configPda(), newTreasury: null }).instruction()], [w.admin]);
      const camp = await w.campaign(1n, { price });
      const k = Keypair.generate(); w.fund(k, 50n);
      for (let i = 0; i < n; i++) await w.buy(camp, k, [1 + i, 20, 30, 40, 50], 1);
      const inn = w.bal(camp.vault);
      const rnd = await w.commit(camp);
      w.setTime(w.now, w.slot + 2n); w.reveal(rnd, valueFor(BigInt(n) * 5n + BigInt(n - 1)));
      const t0 = w.bal(w.treasury.publicKey), b0 = w.bal(k.publicKey);
      w.ok([await w.settleIx(camp, rnd, n - 1, k.publicKey)], [w.payer]);
      expect(w.bal(w.treasury.publicKey) - t0 + (w.bal(k.publicKey) - b0)).to.equal(inn);
      expect(w.bal(w.treasury.publicKey) - t0).to.equal((inn * BigInt(fee)) / 10_000n);
      expect(w.bal(camp.vault)).to.equal(0n);
    }
  });

  it("donated dust to the vault cannot block the payout (sweep) and never inflates the fee", async () => {
    const w = new World(); await w.init();
    const camp = await w.campaign(1n);
    const k = Keypair.generate(); w.fund(k); await w.buy(camp, k);
    const { SystemProgram } = await import("@solana/web3.js");
    w.ok([SystemProgram.transfer({ fromPubkey: w.payer.publicKey, toPubkey: camp.vault, lamports: 7 })], [w.payer]);
    const rnd = await w.commit(camp); w.setTime(w.now, w.slot + 2n); w.reveal(rnd, valueFor(0n));
    const t0 = w.bal(w.treasury.publicKey);
    w.ok([await w.settleIx(camp, rnd, 0, k.publicKey)], [w.payer]);
    expect(w.bal(w.treasury.publicKey) - t0).to.equal(PRICE / 10n);
    expect(w.bal(camp.vault)).to.equal(0n);
  });
});
