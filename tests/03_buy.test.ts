// B4: buy_ticket (R-21..R-34, R-88).
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { World, configPda, ticketPda, CORE_ID, PRICE, SOL } from "./harness";

describe("buy_ticket", () => {
  let w: World, camp: any, buyer: Keypair;
  beforeEach(async () => {
    w = new World(); await w.init();
    camp = await w.campaign(1n, { max: 3 });
    buyer = Keypair.generate(); w.fund(buyer);
  });
  const buyFails = async (what: string, nums?: number[], bonus?: number, c = camp, b = buyer) => {
    const asset = Keypair.generate();
    w.fails([await w.buyIx(c, b, asset, nums, bonus)], [b, asset], what);
  };

  it("R-21/27/29/30/32/34 happy path: vault +price, Ticket stored, Core asset owned by buyer with Attributes, event", async () => {
    const vaultBefore = w.bal(camp.vault);
    const { asset, meta } = await w.buy(camp, buyer, [7, 14, 21, 28, 69], 26);
    expect(w.bal(camp.vault) - vaultBefore).to.equal(PRICE);
    const t = w.acct("ticket", ticketPda(camp.key, 0));
    expect(t.buyer.toBase58()).to.equal(buyer.publicKey.toBase58());
    expect(t.numbers).to.deep.equal([7, 14, 21, 28, 69]);
    expect([t.bonus, t.index]).to.deep.equal([26, 0]);
    expect(t.asset.toBase58()).to.equal(asset.publicKey.toBase58());
    expect(t.status).to.have.property("Active");
    expect(w.acct("campaign", camp.key).ticketCount).to.equal(1);
    const a = w.svm.getAccount(asset.publicKey)!;
    expect(a.owner.toBase58()).to.equal(CORE_ID.toBase58());
    expect(a.data[0]).to.equal(1); // AssetV1
    expect(Buffer.from(a.data.slice(1, 33)).equals(buyer.publicKey.toBuffer())).to.equal(true); // owner
    expect(a.data[33]).to.equal(2); // update authority = Collection
    expect(Buffer.from(a.data.slice(34, 66)).equals(camp.collection.publicKey.toBuffer())).to.equal(true);
    const raw = Buffer.from(a.data).toString("latin1");
    for (const s of ["Cryptoball #0", "n1", "n5", "bonus", "69", "26"]) expect(raw).to.contain(s);
    const ev = w.events(meta).find((e) => e.name === "TicketPurchased")!;
    expect(ev.data.index).to.equal(0);
  });

  it("indexes are dense: second ticket is index 1", async () => {
    await w.buy(camp, buyer); await w.buy(camp, buyer, [2, 3, 4, 5, 6], 2);
    expect(w.acct("ticket", ticketPda(camp.key, 1)).numbers).to.deep.equal([2, 3, 4, 5, 6]);
    expect(w.acct("campaign", camp.key).ticketCount).to.equal(2);
  });

  it("R-25 numbers 0 and 70 fail", async () => {
    await buyFails("InvalidNumbers", [0, 2, 3, 4, 5]);
    await buyFails("InvalidNumbers", [1, 2, 3, 4, 70]);
    await w.buy(camp, buyer, [65, 66, 67, 68, 69]); // upper boundary ok
  });
  it("R-26 non-ascending / duplicate numbers fail", async () => {
    await buyFails("InvalidNumbers", [5, 5, 6, 7, 8]);
    await buyFails("InvalidNumbers", [9, 3, 10, 11, 12]);
  });
  it("R-88 bonus 0 and 27 fail", async () => {
    await buyFails("InvalidNumbers", undefined, 0);
    await buyFails("InvalidNumbers", undefined, 27);
  });

  it("R-23 buy at close_ts fails; R-22 buy after DrawCommitted fails", async () => {
    await w.buy(camp, buyer);
    w.setTime(BigInt(w.acct("campaign", camp.key).closeTs.toString()));
    await buyFails("SalesClosed");
    await w.commit(camp);
    await buyFails("WrongState");
  });

  it("R-24 buy while paused fails; resume allows it", async () => {
    const upd = (p: boolean) => w.m.updateConfig(null, p).accountsPartial({ admin: w.admin.publicKey, config: configPda(), newTreasury: null }).instruction();
    w.ok([await upd(true)], [w.admin]);
    await buyFails("Paused");
    w.ok([await upd(false)], [w.admin]);
    await w.buy(camp, buyer);
  });

  it("R-28 sold out: ticket max+1 fails", async () => {
    for (let i = 0; i < 3; i++) await w.buy(camp, buyer);
    await buyFails("SoldOut");
  });

  it("R-27 insufficient lamports fails and changes nothing", async () => {
    const poor = Keypair.generate(); w.svm.airdrop(poor.publicKey, 5_000_000n);
    await buyFails("", undefined, undefined, camp, poor);
    expect(w.acct("campaign", camp.key).ticketCount).to.equal(0);
    expect(w.bal(camp.vault)).to.equal(0n);
  });

  it("R-29 reused / skipped ticket index fails", async () => {
    await w.buy(camp, buyer);
    const asset = Keypair.generate();
    w.fails([await w.buyIx(camp, buyer, asset, undefined, undefined, 0)], [buyer, asset], "ConstraintSeeds");
    const asset2 = Keypair.generate();
    w.fails([await w.buyIx(camp, buyer, asset2, undefined, undefined, 5)], [buyer, asset2], "ConstraintSeeds");
  });

  it("R-32 wrong Core program id / R-33 wrong collection: tx fails, vault+count unchanged", async () => {
    const asset = Keypair.generate();
    const ix = await w.buyIx(camp, buyer, asset);
    const coreIdx = ix.keys.findIndex((k) => k.pubkey.equals(CORE_ID));
    ix.keys[coreIdx].pubkey = Keypair.generate().publicKey;
    w.fails([ix], [buyer, asset], "ConstraintAddress");
    const bad = { ...camp, collection: Keypair.generate() };
    await buyFails("BadAccount", undefined, undefined, bad);
    expect(w.acct("campaign", camp.key).ticketCount).to.equal(0);
    expect(w.bal(camp.vault)).to.equal(0n);
  });

  it("R-33 forced CPI failure (asset account already exists) reverts payment and count", async () => {
    const { asset } = await w.buy(camp, buyer);
    const vault = w.bal(camp.vault);
    w.fails([await w.buyIx(camp, buyer, asset)], [buyer, asset], "");
    expect(w.bal(camp.vault)).to.equal(vault);
    expect(w.acct("campaign", camp.key).ticketCount).to.equal(1);
  });
  // R-31: count is checked_add; max_tickets <= 10_000 makes u32::MAX unreachable, so the overflow guard is structural.
});
