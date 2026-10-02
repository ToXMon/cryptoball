// B5: cancel_campaign, refund_ticket (R-55..R-60, R-79, R-80, R-87).
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { World, configPda, ticketPda, PRICE, REVEAL_TIMEOUT } from "./harness";

describe("cancel_campaign + refund_ticket", () => {
  let w: World, camp: any, b1: Keypair, b2: Keypair;
  beforeEach(async () => {
    w = new World(); await w.init();
    camp = await w.campaign(1n);
    b1 = Keypair.generate(); b2 = Keypair.generate(); w.fund(b1); w.fund(b2);
  });
  const closeTs = () => BigInt(w.acct("campaign", camp.key).closeTs.toString());
  const cancel = async () => w.ok([await w.cancelIx(camp)], [w.payer]);
  const state = () => Object.keys(w.acct("campaign", camp.key).state)[0];

  it("R-55/R-60 cancel an empty Open campaign after close; emits event; absorbing", async () => {
    w.fails([await w.cancelIx(camp)], [w.payer], "NotClosed"); // before close
    w.setTime(closeTs());
    const meta = await cancel();
    expect(state()).to.equal("Cancelled");
    expect(w.events(meta).map((e) => e.name)).to.include("CampaignCancelled");
    w.fails([await w.cancelIx(camp)], [w.payer], "WrongState"); // R-57
  });

  it("R-55 cancel with tickets sold (not stuck) fails", async () => {
    await w.buy(camp, b1);
    w.setTime(closeTs());
    w.fails([await w.cancelIx(camp)], [w.payer], "WrongState");
  });

  it("R-56 cancel a DrawCommitted campaign only after the reveal timeout", async () => {
    await w.buy(camp, b1);
    await w.commit(camp);
    w.fails([await w.cancelIx(camp)], [w.payer], "TimeoutNotElapsed");
    w.setTime(w.now + REVEAL_TIMEOUT); // exactly the deadline: still not past it
    w.fails([await w.cancelIx(camp)], [w.payer], "TimeoutNotElapsed");
    w.setTime(w.now + 1n);
    await cancel();
    expect(state()).to.equal("Cancelled");
  });

  it("refund path: each ticket returns its price to Ticket.buyer once; vault drains; works while paused (R-87)", async () => {
    await w.buy(camp, b1); await w.buy(camp, b2, [2, 3, 4, 5, 6], 3); await w.buy(camp, b1, [3, 4, 5, 6, 7], 4);
    const pause = w.m.updateConfig(null, true).accountsPartial({ admin: w.admin.publicKey, config: configPda(), newTreasury: null }).instruction();
    w.ok([await pause], [w.admin]);
    await w.commit(camp); // commit while paused
    w.setTime(w.now + REVEAL_TIMEOUT + 1n);
    await cancel(); // cancel while paused
    w.fails([await w.refundIx(camp, 0, b2.publicKey)], [w.payer], "BadAccount"); // wrong destination
    const before1 = w.bal(b1.publicKey);
    const meta = w.ok([await w.refundIx(camp, 0, b1.publicKey)], [w.payer]);
    expect(w.bal(b1.publicKey) - before1).to.equal(PRICE);
    expect(w.acct("ticket", ticketPda(camp.key, 0)).status).to.have.property("Refunded");
    expect(w.events(meta).find((e) => e.name === "TicketRefunded")!.data.lamports.toString()).to.equal(PRICE.toString());
    w.fails([await w.refundIx(camp, 0, b1.publicKey)], [w.payer], "AlreadyRefunded"); // R-79
    w.ok([await w.refundIx(camp, 1, b2.publicKey)], [w.payer]);
    w.ok([await w.refundIx(camp, 2, b1.publicKey)], [w.payer]);
    expect(w.bal(camp.vault)).to.equal(0n);
  });

  it("R-58 refund on Open / Settled campaigns fails", async () => {
    await w.buy(camp, b1);
    w.fails([await w.refundIx(camp, 0, b1.publicKey)], [w.payer], "WrongState");
    const rnd = await w.commit(camp);
    w.setTime(w.now, w.slot + 1n);
    w.reveal(rnd, Buffer.alloc(32, 1));
    w.ok([await w.settleIx(camp, rnd, 0, b1.publicKey)], [w.payer]);
    w.fails([await w.refundIx(camp, 0, b1.publicKey)], [w.payer], "WrongState");
    w.fails([await w.cancelIx(camp)], [w.payer], "WrongState");
  });
});
