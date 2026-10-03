// Live devnet proof for the faucet, after the admin-created-ledger fix.
//
//   node scripts/faucet-proof.js            # initialize (idempotent-ish) then prove
//   RPC=<url> node scripts/faucet-proof.js
//
// Proves, end to end on devnet: a fresh address claims 0.11 SOL, every ceiling is enforced, the
// pool survives a squat attempt on the ledger PDA, and campaign ticket funds never move.
const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, ComputeBudgetProgram } = require("@solana/web3.js");

const RPC = process.env.RPC || "https://api.devnet.solana.com";
const DEPLOY_KEY = process.env.HOME + "/.tape/cryptoball-deploy.json";
const CAMPAIGN_VAULT = new PublicKey("7iSvSBMT7fzk1Rei32AEaVpmhry2TvCQFEG6H8kdyJU5"); // campaign 1 ticket vault
const VAULT_SEED = "faucet-vault", LEDGER_SEED = "faucet-v2";
const POOL_LAMPORTS = 1_000_000_000n; // 1.0 SOL, what the admin budgets
const CARRY_FORWARD = 330_000_000n;    // what the retired v1 ledger had already dispensed
const MAX_CLAIM = 110_000_000n;        // 0.11 SOL
const LIFETIME_CAP = 330_000_000n;     // 0.33 SOL

const idl = JSON.parse(fs.readFileSync("target/idl/cryptoball.json", "utf8"));
const PROGRAM_ID = new PublicKey(idl.address);
const pda = (...s) => PublicKey.findProgramAddressSync(s.map((x) => Buffer.from(x)), PROGRAM_ID)[0];
const VAULT = pda(VAULT_SEED), LEDGER = pda(LEDGER_SEED);
const CONFIG = pda("config");

const conn = new Connection(RPC, "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const program = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(Keypair.generate()), {}));

async function send(ixs, signer) {
  for (let a = 1; ; a++) {
    const bh = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: bh.blockhash })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ...ixs);
    tx.feePayer = signer.publicKey; tx.recentBlockhash = bh.blockhash; tx.sign(signer);
    let sig;
    try { sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }); }
    catch (e) { console.log(`  send failed (${e.message.split("\n")[0]}) retry ${a}`); await sleep(8000); continue; }
    for (let k = 0; k < 20; k++) {
      let st; try { st = (await conn.getSignatureStatuses([sig])).value[0]; } catch { await sleep(3000); continue; }
      if (st && st.err) return { sig, err: st.err };
      if (st && st.confirmationStatus) return { sig, err: null };
      await sleep(2500);
    }
    console.log(`  no status, retry ${a}`); await sleep(5000);
  }
}

(async () => {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(DEPLOY_KEY, "utf8"))));
  console.log(`admin   ${admin.publicKey.toBase58()}`);
  console.log(`ledger  ${LEDGER.toBase58()}  (seeds [${LEDGER_SEED}])`);
  console.log(`vault   ${VAULT.toBase58()}  (seeds [${VAULT_SEED}])`);

  // 1. The ledger must not exist yet: claim_sol has no creation path, only the admin does.
  let led = await conn.getAccountInfo(LEDGER, "confirmed");
  console.log(`ledger before initialize: ${led?.data ? `EXISTS (${led.data.lamports} lamports)` : "does not exist"}`);

  if (!led?.data) {
    // (claim_sol before initialize_faquet is covered on LiteSVM; on-chain it would need the
    //  claimer's signature on a stranger keypair, which is not worth a transaction here.)
    const ix = await program.methods.initializeFaucet(new anchor.BN(POOL_LAMPORTS.toString()), new anchor.BN(CARRY_FORWARD.toString()))
      .accountsPartial({ admin: admin.publicKey, config: CONFIG, faucet: LEDGER, faucetVault: VAULT, systemProgram: SystemProgram.programId })
      .instruction();
    const r = await send([ix], admin);
    console.log(`initialize_faucet: ${r.err ? "FAILED " + JSON.stringify(r.err) : "OK"} ${r.sig}`);
    if (r.err) process.exit(1);
    await sleep(4000);
  }

  const acct = await conn.getAccountInfo(LEDGER, "confirmed");
  console.log(`ledger now: dispensed=${acct.data.readBigUInt64LE(8)} pool=${acct.data.readBigUInt64LE(16)}`);

  // 2. The published squat: transfer lamports at the ledger PDA. Must not alter a single byte.
  const before = acct.data.toString("base64");
  const squatter = Keypair.generate();
  // The devnet airdrop is rate limited far too often to rely on; the deploy wallet dusts its own
  // test wallets. Recorded in the receipts so the arithmetic can be followed.
  await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: squatter.publicKey, lamports: 0.01e9 })], admin);
  await sleep(2000);
  const sq = await send([SystemProgram.transfer({ fromPubkey: squatter.publicKey, toPubkey: LEDGER, lamports: 894080 })], squatter);
  console.log(`squat transfer: ${sq.err ? "REJECTED (expected) " + JSON.stringify(sq.err) : "landed"} ${sq.sig}`);
  await sleep(3000);
  const after = (await conn.getAccountInfo(LEDGER, "confirmed")).data.toString("base64");
  console.log(`ledger bytes unchanged by squat: ${before === after}`);

  // 3. A fresh address claims.
  const user = Keypair.generate();
  await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: user.publicKey, lamports: 0.02e9 })], admin);
  console.log(`fresh claimer ${user.publicKey.toBase58()}`);
  console.log(`claimer dust: ${await conn.getBalance(user.publicKey)} lamports (gas for the tx fee and its claim_record rent)`);
  await sleep(2000);

  const campaignBefore = await conn.getBalance(CAMPAIGN_VAULT);
  const userBefore = await conn.getBalance(user.publicKey);
  console.log(`campaign 1 ticket vault before: ${campaignBefore} lamports`);

  const claim = async (sol, label) => {
    const cix = await program.methods.claimSol(new anchor.BN(sol.toString())).accountsPartial({
      claimer: user.publicKey, claimRecord: PublicKey.findProgramAddressSync([Buffer.from("claim"), user.publicKey.toBuffer()], PROGRAM_ID)[0],
      faucet: LEDGER, faucetVault: VAULT, systemProgram: SystemProgram.programId,
    }).instruction();
    const r = await send([cix], user);
    console.log(`${label}: ${r.err ? "REJECTED " + JSON.stringify(r.err) : "OK"} ${r.sig}`);
    await sleep(3500);
    return r;
  };
  await claim(MAX_CLAIM, "claim 1 (0.11 SOL, fresh wallet)     ");
  console.log(`claimer balance after: ${await conn.getBalance(user.publicKey)} lamports (delta ${(await conn.getBalance(user.publicKey)) - userBefore})`);
  await claim(500_000_000n, "claim 2 (0.5 SOL, over per-claim max)");
  await claim(MAX_CLAIM, "claim 3 (0.11 SOL)                  ");
  await claim(MAX_CLAIM, "claim 4 (0.11 SOL, lifetime reached) ");
  await claim(1n, "claim 5 (0.01 SOL, over lifetime cap) ");

  console.log(`campaign 1 ticket vault after: ${await conn.getBalance(CAMPAIGN_VAULT)} lamports`);
  const fin = (await conn.getAccountInfo(LEDGER, "confirmed")).data;
  console.log(`ledger: dispensed=${fin.readBigUInt64LE(8)} pool=${fin.readBigUInt64LE(16)}`);
  console.log(`vault left: ${await conn.getBalance(VAULT)} lamports`);
  console.log(`admin wallet: ${await conn.getBalance(admin.publicKey)} lamports`);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });