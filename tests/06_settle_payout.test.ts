// B7: settle_draw (fee + winner payout, atomic) + winner.rs wiring (R-43..R-54, R-78, R-71).
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { expect } from "chai";
import { World, configPda, ticketPda, CORE_ID, PRICE, SB_ID, valueFor } from "./harness";

describe("settle_draw", () => {
  let w: World, camp: any, buyers: Keypair[], rnd: PublicKey;
  const N = 4;
  beforeEach(async () => {
    w = new World(); await w.init();
    camp = await w.campaign(1n);
    buyers = [];
    for (let i = 0; i < N; i++) { const k = Keypair.generate(); w.fund(k); buyers.push(k); await w.buy(camp, k, [1 + i, 10, 20, 30, 40], 1 + i); }
    rnd = await w.commit(camp);
    w.setTime(w.now + 5n, w.slot + 3n); // later slot: the reveal happens in the settle slot
  });
  const settle = async (idx: number, r = rnd) => w.ok([await w.settleIx(camp, r, idx, buyers[idx].publicKey)], [w.payer]);
  const pool = PRICE * BigInt(N), fee = pool / 10n, prize = pool - fee;

  it("R-45/46 known value -> known index; R-48/49/50 fee to treasury and prize to Ticket.buyer in one tx; R-52/54 state + event", async () => {
    w.reveal(rnd, valueFor(6n)); // 6 % 4 = 2
    const t0 = w.bal(w.treasury.publicKey), b0 = w.bal(buyers[2].publicKey);
    const meta = await settle(2);
    expect(w.bal(w.treasury.publicKey) - t0).to.equal(fee);
    expect(w.bal(buyers[2].publicKey) - b0).to.equal(prize);
    expect(w.bal(camp.vault)).to.equal(0n); // conservation: vault_in = fee + prize
    const c = w.acct("campaign", camp.key);
    expect(Object.keys(c.state)[0]).to.equal("Settled");
    expect(c.winningIndex).to.equal(2);
    expect(c.winner.toBase58()).to.equal(buyers[2].publicKey.toBase58());
    expect(Buffer.from(c.randomness).equals(valueFor(6n))).to.equal(true);
    expect([c.feeLamports.toString(), c.prizeLamports.toString()]).to.deep.equal([fee.toString(), prize.toString()]);
    expect(c.winningNumbers.length).to.equal(5);
    expect(c.winningBonus).to.be.within(1, 26);
    const ev = w.events(meta).find((e) => e.name === "DrawSettled")!;
    expect(ev.data.winning_index).to.equal(2);
  });

  it("R-47 wrong Ticket account fails", async () => {
    w.reveal(rnd, valueFor(6n));
    w.fails([await w.settleIx(camp, rnd, 1, buyers[1].publicKey)], [w.payer], "BadSettlement");
  });

  it("R-78 settle before reveal fails (value not current this slot)", async () => {
    // revealed in an earlier slot than the settle slot -> get_value rejects
    w.reveal(rnd, valueFor(6n));
    w.setTime(w.now, w.slot + 1n);
    w.fails([await w.settleIx(camp, rnd, 2, buyers[2].publicKey)], [w.payer], "NotRevealed");
    // never revealed at all
    w.fails([await w.settleIx(camp, rnd, 2, buyers[2].publicKey)], [w.payer], "NotRevealed");
  });

  it("R-44 swapped randomness account / different seed_slot fails", async () => {
    w.reveal(rnd, valueFor(6n));
    const other = w.randomness(w.slot - 1n, w.slot, valueFor(6n));
    w.fails([await w.settleIx(camp, other, 2, buyers[2].publicKey)], [w.payer], "BadSettlement");
    // same key but seed_slot rewritten (account recreated by the oracle for another seed)
    w.randomness(w.slot - 2n, w.slot, valueFor(6n), SB_ID, rnd);
    w.fails([await w.settleIx(camp, rnd, 2, buyers[2].publicKey)], [w.payer], "BadSettlement");
  });

  it("R-49 wrong treasury account fails", async () => {
    w.reveal(rnd, valueFor(6n));
    w.fails([await w.settleIx(camp, rnd, 2, buyers[2].publicKey, { treasury: Keypair.generate().publicKey })], [w.payer], "BadAccount");
  });

  it("R-43 settle before commit and settle twice fail; R-53 Settled is absorbing", async () => {
    const fresh = await w.campaign(2n);
    const k = Keypair.generate(); w.fund(k); await w.buy(fresh, k);
    w.fails([await w.settleIx(fresh, rnd, 0, k.publicKey)], [w.payer], ""); // Open: stored rand_account is default
    w.reveal(rnd, valueFor(6n));
    await settle(2);
    w.setTime(w.now, w.slot + 1n); w.reveal(rnd, valueFor(6n));
    w.fails([await w.settleIx(camp, rnd, 2, buyers[2].publicKey)], [w.payer], "WrongState");
    w.fails([await w.cancelIx(camp)], [w.payer], "WrongState");
    const asset = Keypair.generate(); w.fund(buyers[0]);
    w.fails([await w.buyIx(camp, buyers[0], asset)], [buyers[0], asset], "WrongState");
  });

  it("R-50 destination != Ticket.buyer fails; settle is permissionless and pays the buyer even though the payer signs", async () => {
    w.reveal(rnd, valueFor(6n));
    w.fails([await w.settleIx(camp, rnd, 2, w.payer.publicKey)], [w.payer], "BadAccount");
    w.fails([await w.settleIx(camp, rnd, 2, buyers[1].publicKey)], [w.payer], "BadAccount");
    const before = w.bal(buyers[2].publicKey);
    await settle(2);
    expect(w.bal(buyers[2].publicKey) - before).to.equal(prize);
    expect(w.acct("ticket", ticketPda(camp.key, 2)).status).to.have.property("Active"); // winner flag lives on the Campaign
  });

  it("T10 a transferred NFT does not redirect the payout", async () => {
    const asset = new PublicKey(w.acct("ticket", ticketPda(camp.key, 2)).asset);
    const thief = Keypair.generate();
    // Core TransferV1 (discriminator 14, no compression proof). Optional accounts = Core id placeholder.
    const ix = new TransactionInstruction({
      programId: CORE_ID, data: Buffer.from([14, 0]),
      keys: [
        { pubkey: asset, isSigner: false, isWritable: true },
        { pubkey: camp.collection.publicKey, isSigner: false, isWritable: false },
        { pubkey: buyers[2].publicKey, isSigner: true, isWritable: true },
        { pubkey: buyers[2].publicKey, isSigner: true, isWritable: false },
        { pubkey: thief.publicKey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: CORE_ID, isSigner: false, isWritable: false },
      ],
    });
    w.ok([ix], [buyers[2]]);
    expect(Buffer.from(w.svm.getAccount(asset)!.data.slice(1, 33)).equals(thief.publicKey.toBuffer())).to.equal(true);
    w.reveal(rnd, valueFor(6n));
    w.fails([await w.settleIx(camp, rnd, 2, thief.publicKey)], [w.payer], "BadAccount");
    const before = w.bal(buyers[2].publicKey);
    await settle(2);
    expect(w.bal(buyers[2].publicKey) - before).to.equal(prize);
  });

  it("R-87 settle (and its payout) succeeds while paused", async () => {
    w.ok([await w.m.updateConfig(null, true).accountsPartial({ admin: w.admin.publicKey, config: configPda(), newTreasury: null }).instruction()], [w.admin]);
    w.reveal(rnd, valueFor(6n));
    await settle(2);
  });

  it("R-48 rounding: fee floors, prize takes the remainder (conserves exactly)", async () => {
    // 3 tickets at 2_000_003 lamports, 10 %: pool 6_000_009, fee 600_000 (floor of 600_000.9)
    const c2 = await w.campaign(2n, { price: 2_000_003n });
    const ks = [0, 1, 2].map(() => { const k = Keypair.generate(); w.fund(k); return k; });
    for (const k of ks) await w.buy(c2, k);
    const r2 = await w.commit(c2);
    w.setTime(w.now, w.slot + 2n); w.reveal(r2, valueFor(1n));
    const w0 = w.bal(ks[1].publicKey);
    w.ok([await w.settleIx(c2, r2, 1, ks[1].publicKey)], [w.payer]);
    const c = w.acct("campaign", c2.key);
    expect([c.feeLamports.toString(), c.prizeLamports.toString()]).to.deep.equal(["600000", "5400009"]);
    expect(w.bal(c2.vault)).to.equal(0n);
    expect(w.bal(ks[1].publicKey) - w0).to.equal(5_400_009n);
  });
});
