// LiteSVM harness shared by the per-instruction tests (design.md section 10: "LiteSVM first, devnet last").
// Requires `anchor build` first (loads target/deploy/cryptoball.so and target/idl/cryptoball.json).
// Core is the real devnet binary (tests/fixtures/mpl_core.so, `solana program dump -u devnet CoRE...`).
// Switchboard randomness accounts are hand-written fixtures in the real on-chain layout: the oracle/TEE
// cannot run locally, so commit/reveal happens on devnet (README receipts); owner, layout and the
// seed_slot / reveal_slot rules are enforced by the real program code against these accounts.
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { LiteSVM, FailedTransactionMetadata, TransactionMetadata, Clock } from "litesvm";
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";

const root = process.cwd(); // tests run from the repo root (pnpm test)
export const idl = JSON.parse(fs.readFileSync(path.join(root, "target/idl/cryptoball.json"), "utf8"));
export const PROGRAM_ID = new PublicKey(idl.address);
export const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const SB_ID = new PublicKey("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const SOL = 1_000_000_000n;
export const PRICE = 100_000_000n; // 0.1 SOL devnet placeholder
export const FEE_BPS = 1_000;
export const T0 = 1_700_000_000n;
export const REVEAL_TIMEOUT = 3_600n;

const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const configPda = () => pda([Buffer.from("config")]);
export const campaignPda = (id: bigint) => pda([Buffer.from("campaign"), u64le(id)]);
export const vaultPda = (c: PublicKey) => pda([Buffer.from("vault"), c.toBuffer()]);
export const ticketPda = (c: PublicKey, i: number) => pda([Buffer.from("ticket"), c.toBuffer(), u32le(i)]);
export const faucetPda = () => pda([Buffer.from("faucet")]);
export const faucetVaultPda = () => pda([Buffer.from("faucet-vault")]);
export const claimPda = (claimer: PublicKey) => pda([Buffer.from("claim"), claimer.toBuffer()]);
// Faucet ceilings are program constants (constants.rs); mirrored here only to assert the numbers.
export const MAX_CLAIM = 110_000_000n; // 0.11 SOL per claim
export const LIFETIME_CAP = 330_000_000n; // 0.33 SOL per wallet
export const POOL_CAP = 1_000_000_000n; // 1.0 SOL ever dispensed
export const programDataPda = () => PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], LOADER)[0];

export class World {
  svm = new LiteSVM();
  coder = new anchor.BorshCoder(idl);
  program = new anchor.Program(
    idl,
    new anchor.AnchorProvider(
      new Connection("http://127.0.0.1:1"),
      new anchor.Wallet(Keypair.generate()),
      {},
    ),
  );
  upgradeAuth = Keypair.generate();
  admin = this.upgradeAuth; // initialize makes the upgrade authority the first admin
  treasury = Keypair.generate();
  payer = Keypair.generate(); // keeper / anyone
  m = this.program.methods as any;

  constructor() {
    const so = fs.readFileSync(path.join(root, "target/deploy/cryptoball.so"));
    // Upgradeable-loader layout so `initialize` can read ProgramData.upgrade_authority_address.
    const pd = Buffer.alloc(45 + so.length);
    pd.writeUInt32LE(3, 0); pd.writeBigUInt64LE(1n, 4); pd[12] = 1;
    this.upgradeAuth.publicKey.toBuffer().copy(pd, 13); so.copy(pd, 45);
    this.set(programDataPda(), pd, LOADER);
    const prog = Buffer.concat([Buffer.from([2, 0, 0, 0]), programDataPda().toBuffer()]);
    this.set(PROGRAM_ID, prog, LOADER, true);
    this.svm.addProgramFromFile(CORE_ID, path.join(root, "tests/fixtures/mpl_core.so"));
    this.setTime(T0, 100n);
    for (const k of [this.upgradeAuth, this.admin, this.payer]) this.svm.airdrop(k.publicKey, 100n * SOL);
    this.svm.airdrop(this.treasury.publicKey, 1n * SOL);
  }

  set(key: PublicKey, data: Buffer, owner: PublicKey, executable = false) {
    this.svm.setAccount(key, { lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(data.length))) + 1, data, owner, executable });
  }

  /** Overwrite an existing account's lamports (tests that need a short-funded vault). */
  setBalance(key: PublicKey, lamports: bigint) {
    const a = this.svm.getAccount(key);
    if (!a) throw new Error(`no account ${key.toBase58()}`);
    this.svm.setAccount(key, { lamports, data: a.data, owner: a.owner, executable: a.executable });
  }

  setTime(ts: bigint, slot?: bigint) {
    if (slot !== undefined) this.svm.warpToSlot(slot);
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, ts));
  }
  get now() { return this.svm.getClock().unixTimestamp; }
  get slot() { return this.svm.getClock().slot; }
  bal(k: PublicKey) { return this.svm.getBalance(k) ?? 0n; }

  fund(k: Keypair, sol = 10n) { this.svm.airdrop(k.publicKey, sol * SOL); }

  /** Send; returns the metadata or the failure (never throws). */
  send(ixs: TransactionInstruction[], signers: Keypair[], payer = signers[0]) {
    const tx = new Transaction();
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
    tx.sign(...signers);
    const r = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash();
    return r;
  }
  ok(ixs: TransactionInstruction[], signers: Keypair[]) {
    const r = this.send(ixs, signers);
    if (r instanceof FailedTransactionMetadata) throw new Error(r.toString() + "\n" + r.meta().prettyLogs());
    return r as TransactionMetadata;
  }
  /** Assert the tx fails and the logs mention `what` (Anchor error name or runtime text). */
  fails(ixs: TransactionInstruction[], signers: Keypair[], what: string) {
    const r = this.send(ixs, signers);
    expect(r instanceof FailedTransactionMetadata, `expected failure: ${what}`).to.equal(true);
    const logs = (r as FailedTransactionMetadata).meta().logs().join("\n") + (r as FailedTransactionMetadata).toString();
    expect(logs, logs).to.contain(what);
  }

  events(meta: TransactionMetadata) {
    const out: any[] = [];
    const parser = new anchor.EventParser(PROGRAM_ID, this.coder);
    for (const e of parser.parseLogs(meta.logs())) out.push(e);
    return out;
  }
  acct(name: string, key: PublicKey): any {
    const a = this.svm.getAccount(key);
    if (!a) throw new Error(`no account ${key.toBase58()}`);
    const raw = this.coder.accounts.decode(name[0].toUpperCase() + name.slice(1), Buffer.from(a.data));
    // BorshCoder keeps IDL snake_case field names; the tests use camelCase.
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/_(\w)/g, (_, c) => c.toUpperCase()), v]));
  }

  // ---- instruction builders
  initIx(feeBps = FEE_BPS, treasury = this.treasury.publicKey, signer = this.upgradeAuth.publicKey) {
    return this.m.initialize(feeBps).accountsPartial({
      upgradeAuthority: signer, config: configPda(), program: PROGRAM_ID, programData: programDataPda(),
      treasury, systemProgram: SystemProgram.programId,
    }).instruction();
  }
  async init() { return this.ok([await this.initIx()], [this.upgradeAuth]); }

  async createIx(id: bigint, collection: Keypair, o: { price?: bigint; closeIn?: bigint; max?: number; admin?: Keypair; core?: PublicKey } = {}) {
    const c = campaignPda(id);
    const admin = o.admin ?? this.admin;
    return this.m.createCampaign(
      new anchor.BN(id.toString()),
      new anchor.BN((o.price ?? PRICE).toString()),
      new anchor.BN((this.now + (o.closeIn ?? 1_000n)).toString()),
      o.max ?? 1000,
    ).accountsPartial({
      admin: admin.publicKey, config: configPda(), campaign: c, vault: vaultPda(c),
      collection: collection.publicKey, coreProgram: o.core ?? CORE_ID, systemProgram: SystemProgram.programId,
    }).instruction();
  }
  /** Creates a campaign and returns its handles. */
  async campaign(id = 1n, o: { price?: bigint; closeIn?: bigint; max?: number } = {}) {
    const collection = Keypair.generate();
    this.ok([await this.createIx(id, collection, o)], [this.admin, collection]);
    return { id, key: campaignPda(id), vault: vaultPda(campaignPda(id)), collection };
  }

  async buyIx(camp: { key: PublicKey; vault: PublicKey; collection: Keypair }, buyer: Keypair, asset: Keypair, nums = [1, 2, 3, 4, 5], bonus = 1, ticketIndex?: number) {
    const idx = ticketIndex ?? this.acct("campaign", camp.key).ticketCount;
    return this.m.buyTicket(nums, bonus).accountsPartial({
      buyer: buyer.publicKey, config: configPda(), campaign: camp.key, ticket: ticketPda(camp.key, idx),
      asset: asset.publicKey, collection: camp.collection.publicKey, vault: camp.vault,
      coreProgram: CORE_ID, systemProgram: SystemProgram.programId,
    }).instruction();
  }
  async buy(camp: any, buyer: Keypair, nums = [1, 2, 3, 4, 5], bonus = 1) {
    const asset = Keypair.generate();
    const meta = this.ok([await this.buyIx(camp, buyer, asset, nums, bonus)], [buyer, asset]);
    return { asset, meta };
  }

  // ---- Switchboard randomness fixture (real layout, see top comment)
  randomness(seedSlot: bigint, revealSlot = 0n, value = Buffer.alloc(32), owner = SB_ID, key = Keypair.generate().publicKey) {
    const d = Buffer.alloc(408);
    Buffer.from([10, 66, 229, 135, 220, 239, 217, 114]).copy(d, 0);
    d.writeBigUInt64LE(seedSlot, 8 + 96);
    d.writeBigUInt64LE(revealSlot, 8 + 136);
    value.copy(d, 8 + 144);
    this.set(key, d, owner);
    return key;
  }
  commitIx(camp: PublicKey, rnd: PublicKey, payer = this.payer.publicKey) {
    return this.m.commitDraw().accountsPartial({ payer, campaign: camp, randomness: rnd }).instruction();
  }
  /** Close sales, then commit with a fresh randomness account (seed_slot = slot - 1). */
  async commit(camp: any) {
    this.setTime(BigInt(this.acct("campaign", camp.key).closeTs.toString()), this.slot + 1n);
    const rnd = this.randomness(this.slot - 1n);
    this.ok([await this.commitIx(camp.key, rnd)], [this.payer]);
    return rnd;
  }
  /** Reveal in the current slot (what Switchboard's reveal ix does just before settle). */
  reveal(rnd: PublicKey, value: Buffer) {
    const seed = this.svm.getAccount(rnd)!.data.slice(8 + 96, 8 + 104);
    this.randomness(Buffer.from(seed).readBigUInt64LE(), this.slot, value, SB_ID, rnd);
  }
  async settleIx(camp: any, rnd: PublicKey, ticketIdx: number, buyerWallet: PublicKey, o: { treasury?: PublicKey } = {}) {
    return this.m.settleDraw().accountsPartial({
      payer: this.payer.publicKey, config: configPda(), campaign: camp.key, randomness: rnd,
      ticket: ticketPda(camp.key, ticketIdx), vault: camp.vault, treasury: o.treasury ?? this.treasury.publicKey, buyerWallet,
      systemProgram: SystemProgram.programId,
    }).instruction();
  }
  cancelIx(camp: any) { return this.m.cancelCampaign().accountsPartial({ payer: this.payer.publicKey, campaign: camp.key }).instruction(); }
  async refundIx(camp: any, idx: number, wallet: PublicKey) {
    return this.m.refundTicket().accountsPartial({
      payer: this.payer.publicKey, campaign: camp.key, ticket: ticketPda(camp.key, idx), vault: camp.vault,
      buyerWallet: wallet, systemProgram: SystemProgram.programId,
    }).instruction();
  }

  // ---- devnet faucet (tests/08_faucet.test.ts)
  /** Credit the dedicated faucet vault the way the deploy wallet does: a plain system transfer. */
  fundFaucet(sol = 1n, from = this.admin) {
    this.ok([SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: faucetVaultPda(), lamports: sol * SOL })], [from]);
  }
  claimIx(claimer: Keypair, amount: bigint, o: { recipient?: PublicKey; vault?: PublicKey } = {}) {
    return this.m.claimSol(new anchor.BN(amount.toString())).accountsPartial({
      claimer: claimer.publicKey, recipient: o.recipient ?? claimer.publicKey,
      claimRecord: claimPda(claimer.publicKey), faucet: faucetPda(),
      faucetVault: o.vault ?? faucetVaultPda(), systemProgram: SystemProgram.programId,
    }).instruction();
  }
  async claim(claimer: Keypair, amount: bigint) {
    return this.ok([await this.claimIx(claimer, amount)], [claimer]);
  }
}

/** A value whose little-endian u128 head is `n` (tail bytes arbitrary): winning index = n % ticket_count. */
export const valueFor = (n: bigint) => { const b = Buffer.alloc(32, 0xab); b.writeBigUInt64LE(n & ((1n << 64n) - 1n), 0); b.writeBigUInt64LE(n >> 64n, 8); return b; };
