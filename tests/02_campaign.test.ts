// B3: create_campaign (R-13..R-19, R-73, R-77).
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { World, configPda, campaignPda, CORE_ID, PRICE, FEE_BPS } from "./harness";

describe("create_campaign", () => {
  let w: World;
  beforeEach(async () => { w = new World(); await w.init();  });

  it("happy path: Open, count 0, fee snapshot, Core collection owned by Core with Campaign PDA authority", async () => {
    const c = await w.campaign(1n);
    const a = w.acct("campaign", c.key);
    expect(a.state).to.have.property("Open");
    expect(a.ticketCount).to.equal(0);
    expect(a.feeBps).to.equal(FEE_BPS);
    expect(a.priceLamports.toString()).to.equal(PRICE.toString());
    expect(a.collection.toBase58()).to.equal(c.collection.publicKey.toBase58());
    const col = w.svm.getAccount(c.collection.publicKey)!;
    expect(col.owner.toBase58()).to.equal(CORE_ID.toBase58());
    // CollectionV1: key byte 5, then update_authority (the Campaign PDA)
    expect(col.data[0]).to.equal(5);
    expect(Buffer.from(col.data.slice(1, 33)).equals(c.key.toBuffer())).to.equal(true);
  });

  it("R-77 later Config fee change leaves the campaign unchanged", async () => {
    const c = await w.campaign(1n);
    w.ok([await w.m.updateConfig(500, null).accountsPartial({ admin: w.admin.publicKey, config: configPda(), newTreasury: null }).instruction()], [w.admin]);
    expect(w.acct("campaign", c.key).feeBps).to.equal(FEE_BPS);
    expect(w.acct("config", configPda()).feeBps).to.equal(500);
  });

  it("R-13 non-admin create fails", async () => {
    const rando = Keypair.generate(); w.fund(rando);
    const col = Keypair.generate();
    w.fails([await w.createIx(1n, col, { admin: rando })], [rando, col], "Unauthorized");
  });

  it("R-14 close_ts <= now fails", async () => {
    const col = Keypair.generate();
    w.fails([await w.createIx(1n, col, { closeIn: 0n })], [w.admin, col], "InvalidParams");
    w.fails([await w.createIx(1n, col, { closeIn: -5n })], [w.admin, col], "InvalidParams");
  });

  it("R-15 price below floor fails (zero included)", async () => {
    for (const p of [0n, 1_999_999n]) {
      const col = Keypair.generate();
      w.fails([await w.createIx(1n, col, { price: p })], [w.admin, col], "InvalidParams");
    }
    const col = Keypair.generate();
    w.ok([await w.createIx(1n, col, { price: 2_000_000n })], [w.admin, col]); // boundary ok
  });

  it("R-16 max tickets 0 and MAX+1 fail", async () => {
    for (const m of [0, 10_001]) {
      const col = Keypair.generate();
      w.fails([await w.createIx(1n, col, { max: m })], [w.admin, col], "InvalidParams");
    }
    const col = Keypair.generate();
    w.ok([await w.createIx(1n, col, { max: 10_000 })], [w.admin, col]);
  });

  it("duplicate campaign id fails", async () => {
    await w.campaign(1n);
    const col = Keypair.generate();
    const r = w.send([await w.createIx(1n, col)], [w.admin, col]);
    expect(r.constructor.name).to.equal("FailedTransactionMetadata");
  });

  it("R-73 attacker Core program id fails", async () => {
    const col = Keypair.generate();
    w.fails([await w.createIx(1n, col, { core: Keypair.generate().publicKey })], [w.admin, col], "ConstraintAddress");
  });
});
