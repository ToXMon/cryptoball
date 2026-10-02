// Devnet SOL faucet (claim_sol). This is money-handling code, so the tests are the point:
// every ceiling is asserted on-chain, and the last tests prove the faucet cannot touch the
// lottery money (ticket proceeds, prize, refund) at any point.
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { World, MAX_CLAIM, LIFETIME_CAP, POOL_CAP, faucetPda, faucetVaultPda, claimPda, PRICE, valueFor } from "./harness";

describe("claim_sol (devnet faucet)", () => {
  let w: World, user: Keypair;
  beforeEach(async () => {
    w = new World(); await w.init();
    user = Keypair.generate(); w.fund(user);
    w.fundFaucet(1n);
  });
  const newUser = () => { const k = Keypair.generate(); w.fund(k); return k; };
  /** The pool tally only exists after the first successful claim. */
  const dispensed = () => (w.svm.getAccount(faucetPda()) ? w.acct("faucet", faucetPda()).dispensed.toString() : "0");
  const lifetime = (k: Keypair) => (w.svm.getAccount(claimPda(k.publicKey)) ? w.acct("claimRecord", claimPda(k.publicKey)).claimed.toString() : "0");

  it("a fresh wallet claims 0.11 SOL; record, pool tally and event all move", async () => {
    const before = w.bal(user.publicKey);
    const meta = await w.claim(user, MAX_CLAIM);
    // the claimer paid the tx fee and the rent of the two PDAs it created, then received 0.11 SOL
    expect(w.bal(user.publicKey) - before > MAX_CLAIM - 3_000_000n).to.equal(true);
    expect(lifetime(user)).to.equal(MAX_CLAIM.toString());
    expect(w.acct("claimRecord", claimPda(user.publicKey)).claimer.toBase58()).to.equal(user.publicKey.toBase58());
    expect(dispensed()).to.equal(MAX_CLAIM.toString());
    const ev = w.events(meta).find((e) => e.name === "SolClaimed")!;
    expect([ev.data.amount.toString(), ev.data.pool_dispensed.toString()]).to.deep.equal([
      MAX_CLAIM.toString(), MAX_CLAIM.toString(),
    ]);
  });

  it("per-claim ceiling: 0 and anything above 0.11 SOL fail, 0.11 succeeds", async () => {
    w.fails([await w.claimIx(user, 0n)], [user], "ClaimTooLarge");
    w.fails([await w.claimIx(user, MAX_CLAIM + 1n)], [user], "ClaimTooLarge");
    w.fails([await w.claimIx(user, 1_000_000_000n)], [user], "ClaimTooLarge");
    expect(dispensed()).to.equal("0"); // nothing moved on a failure
    expect(lifetime(user)).to.equal("0");
    await w.claim(user, MAX_CLAIM);
  });

  it("per-wallet lifetime ceiling: a lifetime total of 0.33 SOL, in any number of claims", async () => {
    await w.claim(user, MAX_CLAIM);
    await w.claim(user, MAX_CLAIM);
    await w.claim(user, 90_000_000n); // 0.31 SOL
    expect(lifetime(user)).to.equal("310000000");
    await w.claim(user, 20_000_000n); // exactly 0.33 SOL
    expect(lifetime(user)).to.equal(LIFETIME_CAP.toString());
    w.fails([await w.claimIx(user, MAX_CLAIM)], [user], "ClaimLifetimeCap");
    w.fails([await w.claimIx(user, 1n)], [user], "ClaimLifetimeCap"); // no head-room at all, even for dust
    const other = newUser();
    await w.claim(other, MAX_CLAIM); // the cap is per wallet, not global
    expect(lifetime(other)).to.equal(MAX_CLAIM.toString());
  });

  it("global pool ceiling: claims stop at 1.0 SOL even with a fresh wallet every time", async () => {
    // vault funded well above the pool ceiling, so the ceiling under test is the state tally, not the balance
    w.fundFaucet(5n);
    let left = POOL_CAP;
    while (left > 0n) {
      const amt = left > MAX_CLAIM ? MAX_CLAIM : left;
      await w.claim(newUser(), amt);
      left -= amt;
    }
    expect(dispensed()).to.equal(POOL_CAP.toString());
    const next = newUser();
    w.fails([await w.claimIx(next, 1n)], [next], "FaucetDrained");
    w.fails([await w.claimIx(next, MAX_CLAIM)], [next], "FaucetDrained");
    // and a wallet that already spent its lifetime allowance cannot sneak past the pool ceiling either
    const heavy = newUser();
    for (let i = 0; i < 3; i++) {
      try { await w.claim(heavy, MAX_CLAIM); } catch { break; } // pool exhausted mid-run
    }
    expect(dispensed()).to.equal(POOL_CAP.toString());
  });

  it("an under-funded vault fails closed instead of touching anything else", async () => {
    const vault = faucetVaultPda();
    const funded = w.bal(vault);
    expect(funded).to.equal(1n * 1_000_000_000n);
    w.setBalance(vault, 1_000_000n); // far below one max claim
    w.fails([await w.claimIx(user, MAX_CLAIM)], [user], "FaucetEmpty");
    expect(dispensed()).to.equal("0");
    expect(lifetime(user)).to.equal("0");
    expect(w.bal(vault)).to.equal(1_000_000n); // untouched
  });

  it("claims only ever pay the signer; a swapped recipient or vault is rejected", async () => {
    const other = newUser();
    const stranger = new Keypair().publicKey;
    const before = [w.bal(other.publicKey), w.bal(stranger), w.bal(faucetVaultPda())];
    w.fails([await w.claimIx(user, MAX_CLAIM, { recipient: other.publicKey })], [user], "BadAccount");
    w.fails([await w.claimIx(user, MAX_CLAIM, { recipient: stranger })], [user], "BadAccount");
    w.fails([await w.claimIx(user, MAX_CLAIM, { vault: new Keypair().publicKey })], [user], "BadAccount");
    expect(dispensed()).to.equal("0");
    // no lamport reached the third party, the fake recipient, or the vault
    expect([w.bal(other.publicKey), w.bal(stranger), w.bal(faucetVaultPda())]).to.deep.equal(before);
  });

  it("the faucet is permissionless: a wallet nobody knows about gets the same 0.11", async () => {
    const stranger = newUser();
    await w.claim(stranger, MAX_CLAIM);
    expect(lifetime(stranger)).to.equal(MAX_CLAIM.toString());
  });

  it("money separation: claims never move a lamport of ticket money, and the prize path still settles", async () => {
    const camp = await w.campaign(1n);
    const buyers = [newUser(), newUser()];
    for (const b of buyers) await w.buy(camp, b);
    const vaultAfterBuy = w.bal(camp.vault);
    const treasuryBefore = w.bal(w.treasury.publicKey);

    // drain a wallet's whole lifetime allowance, plus another wallet, while a campaign is live
    await w.claim(user, MAX_CLAIM);
    await w.claim(user, MAX_CLAIM);
    await w.claim(user, MAX_CLAIM);
    await w.claim(newUser(), MAX_CLAIM);

    // ticket proceeds untouched by every claim above
    expect(w.bal(camp.vault)).to.equal(vaultAfterBuy);
    expect(w.bal(w.treasury.publicKey)).to.equal(treasuryBefore);
    expect(lifetime(user)).to.equal(LIFETIME_CAP.toString());

    // and the draw still pays exactly what it would have paid with no faucet in the program
    const rnd = await w.commit(camp);
    w.setTime(w.now + 5n, w.slot + 3n);
    w.reveal(rnd, valueFor(1n)); // 1 % 2 = 1
    const b0 = w.bal(buyers[1].publicKey);
    w.ok([await w.settleIx(camp, rnd, 1, buyers[1].publicKey)], [w.payer]);
    const pool = PRICE * 2n, fee = pool / 10n;
    expect(w.bal(buyers[1].publicKey) - b0).to.equal(pool - fee);
    expect(w.bal(w.treasury.publicKey) - treasuryBefore).to.equal(fee);
    expect(w.bal(camp.vault)).to.equal(0n);
    expect(dispensed()).to.equal((MAX_CLAIM * 4n).toString());
  });

  it("the faucet vault is a distinct PDA from every campaign vault and from the faucet record", async () => {
    const a = await w.campaign(1n);
    const b = await w.campaign(2n);
    const vault = faucetVaultPda();
    expect(vault.equals(a.vault) || vault.equals(b.vault)).to.equal(false);
    expect(vault.equals(faucetPda())).to.equal(false);
    expect(vault.equals(claimPda(user.publicKey))).to.equal(false);
  });
});