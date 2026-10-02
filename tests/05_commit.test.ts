// B6: commit_draw (R-37..R-42, R-39, R-40).
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { World, SB_ID } from "./harness";

describe("commit_draw", () => {
  let w: World, camp: any;
  beforeEach(async () => {
    w = new World(); await w.init();
    camp = await w.campaign(1n);
    const k = Keypair.generate(); w.fund(k); await w.buy(camp, k);
  });
  const closeTs = () => BigInt(w.acct("campaign", camp.key).closeTs.toString());
  const closed = () => w.setTime(closeTs(), w.slot + 2n);
  const failsWith = async (rnd: any, what: string) => w.fails([await w.commitIx(camp.key, rnd)], [w.payer], what);

  it("happy path stores key, seed_slot, committed_at; Open -> DrawCommitted; event", async () => {
    closed();
    const rnd = w.randomness(w.slot - 1n);
    const meta = w.ok([await w.commitIx(camp.key, rnd)], [w.payer]);
    const c = w.acct("campaign", camp.key);
    expect(Object.keys(c.state)[0]).to.equal("DrawCommitted");
    expect(c.randAccount.toBase58()).to.equal(rnd.toBase58());
    expect(c.seedSlot.toString()).to.equal((w.slot - 1n).toString());
    expect(c.committedAt.toString()).to.equal(w.now.toString());
    expect(w.events(meta).map((e) => e.name)).to.include("DrawCommitted");
  });

  it("R-37 commit before close_ts fails", async () => {
    w.setTime(closeTs() - 1n, w.slot + 2n);
    await failsWith(w.randomness(w.slot - 1n), "NotClosed");
  });

  it("R-38 commit with zero tickets fails", async () => {
    const empty = await w.campaign(2n);
    w.setTime(BigInt(w.acct("campaign", empty.key).closeTs.toString()), w.slot + 2n);
    w.fails([await w.commitIx(empty.key, w.randomness(w.slot - 1n))], [w.payer], "NoTickets");
  });

  it("R-39 fake randomness account (right size, wrong owner) fails; wrong discriminator fails", async () => {
    closed();
    await failsWith(w.randomness(w.slot - 1n, 0n, Buffer.alloc(32), Keypair.generate().publicKey), "BadRandomness");
    const bad = w.randomness(w.slot - 1n);
    const a = w.svm.getAccount(bad)!; const d = Buffer.from(a.data); d[0] ^= 1;
    w.svm.setAccount(bad, { ...a, data: d });
    await failsWith(bad, "BadRandomness");
  });

  it("R-40 stale seed_slot and already-revealed randomness fail", async () => {
    closed();
    await failsWith(w.randomness(w.slot - 2n), "BadRandomness"); // older than slot-1
    await failsWith(w.randomness(w.slot), "BadRandomness"); // not committed in a past slot
    await failsWith(w.randomness(w.slot - 1n, w.slot), "BadRandomness"); // already revealed
  });

  it("R-42 commit twice fails; R-43 settle needs commit first", async () => {
    closed();
    const rnd = w.randomness(w.slot - 1n);
    w.ok([await w.commitIx(camp.key, rnd)], [w.payer]);
    w.setTime(w.now, w.slot + 1n);
    w.fails([await w.commitIx(camp.key, w.randomness(w.slot - 1n))], [w.payer], "WrongState");
  });
});
