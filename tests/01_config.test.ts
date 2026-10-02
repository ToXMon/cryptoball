// B1/B2: initialize, update_config, nominate_admin, accept_admin (R-01..R-12, R-51, R-76).
import { Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { World, configPda, FEE_BPS } from "./harness";

describe("config", () => {
  let w: World;
  beforeEach(() => { w = new World(); });

  it("initialize happy path stores admin, treasury, fee and emits ConfigChanged", async () => {
    const meta = await w.init();
    const c = w.acct("config", configPda());
    expect(c.admin.toBase58()).to.equal(w.upgradeAuth.publicKey.toBase58());
    expect(c.treasury.toBase58()).to.equal(w.treasury.publicKey.toBase58());
    expect(c.feeBps).to.equal(FEE_BPS);
    expect(c.paused).to.equal(false);
    expect(w.events(meta).map((e) => e.name)).to.include("ConfigChanged");
  });

  it("R-01 second initialize fails", async () => {
    await w.init();
    w.svm.expireBlockhash();
    const r = w.send([await w.initIx(500)], [w.upgradeAuth]);
    expect(r.constructor.name).to.equal("FailedTransactionMetadata");
  });

  it("R-02 random signer cannot initialize", async () => {
    const rando = Keypair.generate(); w.fund(rando);
    w.fails([await w.initIx(FEE_BPS, w.treasury.publicKey, rando.publicKey)], [rando], "Unauthorized");
  });

  it("R-06 fee above cap fails on initialize", async () => {
    w.fails([await w.initIx(2_001)], [w.upgradeAuth], "FeeTooHigh");
    await w.ok([await w.initIx(2_000)], [w.upgradeAuth]); // boundary ok
  });

  it("R-51 empty treasury wallet fails", async () => {
    w.fails([await w.initIx(FEE_BPS, Keypair.generate().publicKey)], [w.upgradeAuth], "TreasuryBelowRent");
  });

  const upd = (w: World, admin: Keypair, fee: number | null, paused: boolean | null, t: Keypair | null = null) =>
    w.m.updateConfig(fee, paused).accountsPartial({
      admin: admin.publicKey, config: configPda(), newTreasury: t ? t.publicKey : null,
    }).instruction();

  it("update_config: fee, pause/resume, treasury (admin only, clamped)", async () => {
    await w.init();
    const t2 = Keypair.generate(); w.svm.airdrop(t2.publicKey, 1_000_000_000n);
    let meta = w.ok([await upd(w, w.upgradeAuth, 1500, true, t2)], [w.upgradeAuth]);
    let c = w.acct("config", configPda());
    expect([c.feeBps, c.paused, c.treasury.toBase58()]).to.deep.equal([1500, true, t2.publicKey.toBase58()]);
    expect(w.events(meta).map((e) => e.name)).to.include("ConfigChanged");
    w.ok([await upd(w, w.upgradeAuth, null, false)], [w.upgradeAuth]); // resume (R-10)
    expect(w.acct("config", configPda()).paused).to.equal(false);
    // negatives
    const rando = Keypair.generate(); w.fund(rando);
    w.fails([await upd(w, rando, 100, null)], [rando], "Unauthorized");
    w.fails([await upd(w, rando, null, true)], [rando], "Unauthorized");
    w.fails([await upd(w, w.upgradeAuth, 2_001, null)], [w.upgradeAuth], "FeeTooHigh");
    w.fails([await upd(w, w.upgradeAuth, null, null, Keypair.generate())], [w.upgradeAuth], "TreasuryBelowRent");
  });

  it("nominate_admin / accept_admin rotate admin; only nominee accepts", async () => {
    await w.init();
    const nominee = Keypair.generate(); w.fund(nominee);
    const nom = (k: Keypair) => w.m.nominateAdmin(nominee.publicKey).accountsPartial({ admin: k.publicKey, config: configPda() }).instruction();
    const acc = (k: Keypair) => w.m.acceptAdmin().accountsPartial({ nominee: k.publicKey, config: configPda() }).instruction();
    const rando = Keypair.generate(); w.fund(rando);
    w.fails([await nom(rando)], [rando], "Unauthorized");
    w.ok([await nom(w.upgradeAuth)], [w.upgradeAuth]);
    w.fails([await acc(rando)], [rando], "Unauthorized");
    w.ok([await acc(nominee)], [nominee]);
    const c = w.acct("config", configPda());
    expect(c.admin.toBase58()).to.equal(nominee.publicKey.toBase58());
    expect(c.pendingAdmin).to.equal(null);
    w.fails([await acc(nominee)], [nominee], "Unauthorized"); // no pending nomination left
    w.fails([await nom(w.upgradeAuth)], [w.upgradeAuth], "Unauthorized"); // old admin lost the role
  });
});
