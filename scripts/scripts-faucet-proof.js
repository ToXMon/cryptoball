// Live devnet proof for the faucet: fresh address claims 0.11 SOL, over-cap claims are
// rejected, and the campaign ticket vault is untouched throughout.
const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = require("@solana/web3.js");

const RPC = "https://api.devnet.solana.com";
const CAMPAIGN_VAULT = new PublicKey("7iSvSBMT7fzk1Rei32AEaVpmhry2TvCQFEG6H8kdyJU5"); // campaign 1 ticket vault
const idl = JSON.parse(fs.readFileSync("target/idl/cryptoball.json", "utf8"));
const PROGRAM_ID = new PublicKey(idl.address);
const MINT = 0.11 * 1e9;

const conn = new Connection(RPC, "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const CLAIM = pda([Buffer.from("claim")]);
const FAUCET = pda([Buffer.from("faucet")]);
const VAULT = pda([Buffer.from("faucet-vault")]);

const program = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(Keypair.generate()), {}));

async function send(ix, signer) {
  for (let a = 1; ; a++) {
    const bh = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: bh.blockhash }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ix);
    tx.feePayer = signer.publicKey; tx.recentBlockhash = bh.blockhash; tx.sign(signer);
    let sig;
    try { sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }); }
    catch (e) { console.log(`  send failed (${e.message.split("\n")[0]}), retry ${a}`); await sleep(8000); continue; }
    await sleep(5000);
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st && st.err) return { sig, err: st.err };
    if (st && st.confirmationStatus) return { sig, err: null };
    console.log(`  no status, retry ${a}`); await sleep(5000);
  }
}

async function claim(who, sol, label) {
  const ix = await program.methods.claimSol(new anchor.BN(Math.round(sol * 1e9))).accountsPartial({
    claimer: who.publicKey, recipient: who.publicKey,
    claimRecord: PublicKey.findProgramAddressSync([Buffer.from("claim"), who.publicKey.toBuffer()], PROGRAM_ID)[0],
    faucet: FAUCET, faucetVault: VAULT, systemProgram: SystemProgram.programId,
  }).instruction();
  const r = await send(ix, who);
  console.log(`${label}: ${r.err ? "REJECTED " + JSON.stringify(r.err) : "OK"} ${r.sig}`);
  await sleep(4000);
  return r;
}

(async () => {
  const user = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/tmp/faucet-user.json','utf8'))));
  console.log(`fresh claimer ${user.publicKey.toBase58()}`);
  console.log(`faucet vault  ${VAULT.toBase58()}`);

  // A brand-new address still needs a little SOL to pay the tx fee and the rent of the two PDAs
  // its first claim creates; the 0.11 SOL itself comes from the faucet. (The devnet airdrop is
  // currently dry, so this dust came from the dev wallet: tx 2hzD1FiR...).
  console.log(`claimer dust: ${await conn.getBalance(user.publicKey)} lamports`);
  await sleep(3000);

  const vaultBefore = await conn.getBalance(CAMPAIGN_VAULT);
  const tapBefore = await conn.getBalance(user.publicKey);
  console.log(`campaign 1 ticket vault before: ${vaultBefore} lamports`);
  console.log(`claimer balance before: ${tapBefore} lamports`);

  await claim(user, 0.11, "claim 1 (0.11 SOL, fresh wallet)      ");
  await sleep(4000);
  const tapAfter = await conn.getBalance(user.publicKey);
  console.log(`claimer balance after: ${tapAfter} lamports (delta ${tapAfter - tapBefore})`);
  const tap2 = await conn.getAccountInfo(user.publicKey);
  console.log(`faucet record: dispensed=${(await conn.getAccountInfo(FAUCET, "confirmed")).data.lamports}`);

  await claim(user, 0.5, "claim 2 (0.5 SOL, over per-claim max)");
  await claim(user, 0.11, "claim 3 (0.11 SOL)                   ");
  await claim(user, 0.11, "claim 4 (0.11 SOL)                   ");
  await claim(user, 0.01, "claim 5 (0.01 SOL, over lifetime cap) ");

  const vaultAfter = await conn.getBalance(CAMPAIGN_VAULT);
  console.log(`campaign 1 ticket vault after:  ${vaultAfter} lamports (unchanged: ${vaultAfter === vaultBefore})`);

  const acct = await conn.getAccountInfo(user.publicKey);
  console.log(`done. faucet vault left: ${(await conn.getBalance(VAULT))} lamports`);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });