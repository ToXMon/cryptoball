// Fill an upgradeable-loader buffer one chunk at a time, gently, then hand it to
// `solana program deploy --buffer`, which does no writes and finishes the job.
//
// Why this exists: `solana program deploy` floods api.devnet.solana.com with buffer
// writes and signature-status polls, trips that node's per-IP 429 limit, and dies with
// "Data writes to account failed: Custom error: Max retries exceeded". This script does
// only the two trivial, well-specified loader instructions (InitializeBuffer and Write),
// one transaction at a time with a gap between them, which the public node tolerates.
//
// Usage: node scripts-write-buffer.js <path/to.so> <path/to/buffer-keypair.json>
// Re-running with the same keypair path resumes: an existing buffer is reused.
const fs = require("fs");
const {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} = require("@solana/web3.js");

const RPC = process.env.RPC || "https://api.devnet.solana.com";
const SO = process.argv[2];
const OUT = process.argv[3];
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const RENT_PER_BYTE = 5080;   // lamports/byte-year x2 years: what this cluster charges (verified against programdata)
const BUFFER_METADATA = 37;   // UpgradeableLoaderState::size_of_buffer(program_len) - program_len
const CHUNK = 850;            // keeps the transaction under the 1232-byte limit
const GAP_MS = 2000;

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.tape/cryptoball-deploy.json", "utf8"))));
const bufKp = fs.existsSync(OUT)
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(OUT, "utf8"))))
  : Keypair.generate();
fs.writeFileSync(OUT, JSON.stringify(Array.from(Uint8Array.from(bufKp.secretKey))));

const program = fs.readFileSync(SO);
const bufLen = BUFFER_METADATA + program.length;
const rent = (128 + bufLen) * RENT_PER_BYTE;

const conn = new Connection(RPC, "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => {
  const line = new Date().toISOString() + " " + m;
  console.log(line);
  fs.appendFileSync("/tmp/bufwrite.log", line + "\n");
};

// An RPC call that rides out the public node's 429s.
async function rpc(fn, ...args) {
  let last;
  for (let i = 0; i < 12; i++) {
    try { return await fn(...args); } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
}

/** Send a transaction and wait for real confirmation. Retries the whole thing on expiry. */
async function send(ixs, extraSigners, label) {
  for (let attempt = 1; ; attempt++) {
    const { blockhash, lastValidBlockHeight } = await rpc(() => conn.getLatestBlockhash("confirmed"));
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
    tx.add(...ixs);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(payer, ...extraSigners);
    let sig;
    try {
      // The public devnet RPC is load balanced: a blockhash from one node often fails
      // simulation on another ("Blockhash not found"), so skip preflight and let the
      // confirmation poll below be the only gate.
      sig = await rpc(() => conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 }));
    } catch (e) {
      log(`${label}: send failed (${e.message}) attempt ${attempt}`);
      await sleep(10000);
      continue;
    }
    for (let k = 0; k < 25; k++) {
      let st;
      try { st = await rpc(() => conn.getSignatureStatuses([sig])); } catch { await sleep(4000); continue; }
      const s = st.value[0];
      if (s) {
        if (s.err) { log(`${label}: ON-CHAIN ERROR ${JSON.stringify(s.err)} sig ${sig}`); return null; }
        if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return sig;
      }
      await sleep(2500);
    }
    log(`${label}: not confirmed in time, retry ${attempt}`);
  }
}

(async () => {
  log(`buffer ${bufKp.publicKey.toBase58()} space=${bufLen} rent=${rent} program=${program.length}B`);
  log(`payer ${(await rpc(() => conn.getBalance(payer.publicKey)))} lamports`);

  // CreateAccount + InitializeBuffer must share ONE transaction, otherwise a third party
  // could initialise the buffer between them. CreateAccount makes the new account a signer.
  const init = new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: bufKp.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([0, 0, 0, 0]),
  });
  const existing = await rpc(() => conn.getAccountInfo(bufKp.publicKey, "confirmed"));
  if (existing && (existing.value || existing.data)) {  // web3.js 1.98 returns { data, context }
    log("buffer already exists, resuming writes");
  } else {
    const sig = await send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: bufKp.publicKey, lamports: rent, space: bufLen, programId: LOADER }),
      init,
    ], [bufKp], "create+init");
    if (!sig) throw new Error("buffer creation failed");
    log(`buffer created+initialised, tx ${sig}`);
  }

  // Write the program bytes, one small chunk per transaction.
  const n = Math.ceil(program.length / CHUNK);
  for (let i = 0; i < n; i++) {
    const slice = program.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, program.length));
    // bincode fixint, little endian: u32 discriminant, u32 offset, u64 Vec length.
    const data = Buffer.alloc(16 + slice.length);
    data.writeUInt32LE(1, 0);
    data.writeUInt32LE(i * CHUNK, 4);
    data.writeBigUInt64LE(BigInt(slice.length), 8);
    slice.copy(data, 16);
    const sig = await send([new TransactionInstruction({
      programId: LOADER,
      keys: [
        { pubkey: bufKp.publicKey, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    })], [], `write ${i + 1}/${n}`);
    if (!sig) throw new Error(`write ${i} failed on chain`);
    if ((i + 1) % 50 === 0) log(`progress ${i + 1}/${n}`);
    await sleep(GAP_MS);
  }
  log("BUFFER COMPLETE - hand /tmp/faucet-buffer.json to solana program deploy --buffer");
})().catch((e) => { log("FATAL " + e.message); process.exit(1); });