import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { LiteSVM, FailedTransactionMetadata, TransactionMetadata, Clock } from "litesvm";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "chai";

const BN: any = (anchor as any).default.BN;
const root = process.cwd();
const idl = JSON.parse(fs.readFileSync(path.join(root, "target/idl/lossless_v1.json"), "utf8"));
const PROGRAM_ID = new PublicKey(idl.address);
const TOKEN_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const LOSSLESS_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const SOL = 1_000_000_000n;
const u64le = (n: bigint | number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const configPda = () => pda([Buffer.from("lossless-config")]);
const campaignPda = (id: bigint) => pda([Buffer.from("lossless-campaign"), u64le(id)]);
const positionPda = (campaign: PublicKey, owner: PublicKey) => pda([Buffer.from("position"), campaign.toBuffer(), owner.toBuffer()]);
const vaultPda = (seed: string, campaign: PublicKey) => pda([Buffer.from(seed), campaign.toBuffer()]);
const programDataPda = () => PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], LOADER)[0];
const err = (name: string) => name;

class LosslessWorld {
  svm = new LiteSVM();
  coder = new anchor.BorshCoder(idl);
  program = new anchor.Program(idl, new anchor.AnchorProvider(new Connection("http://127.0.0.1:1"), new anchor.Wallet(Keypair.generate()), {}));
  m = this.program.methods as any;
  authority = Keypair.generate();
  admin = this.authority;
  attacker = Keypair.generate();
  payer = Keypair.generate();
  treasury = Keypair.generate();
  mint = LOSSLESS_USDC_MINT;
  treasuryToken = Keypair.generate().publicKey;
  adminToken = Keypair.generate().publicKey;
  users = Array.from({ length: 24 }, () => Keypair.generate());
  userTokens = this.users.map(() => Keypair.generate().publicKey);
  wrongMint = Keypair.generate().publicKey;
  wrongAuthority = Keypair.generate().publicKey;

  constructor() {
    const so = fs.readFileSync(path.join(root, "target/deploy/lossless_v1.so"));
    const pd = Buffer.alloc(45 + so.length);
    pd.writeUInt32LE(3, 0); pd.writeBigUInt64LE(1n, 4); pd[12] = 1;
    this.authority.publicKey.toBuffer().copy(pd, 13); so.copy(pd, 45);
    this.set(programDataPda(), pd, LOADER);
    this.set(PROGRAM_ID, Buffer.concat([Buffer.from([2, 0, 0, 0]), programDataPda().toBuffer()]), LOADER, true);
    this.svm.addProgramFromFile(TOKEN_ID, path.join(root, "tests/fixtures/spl_token.so"));
    this.setTime(1_700_000_000n, 100n);
    for (const key of [this.authority, this.attacker, this.payer, ...this.users]) this.svm.airdrop(key.publicKey, 100n * SOL);
    this.svm.airdrop(this.treasury.publicKey, SOL);
    this.mintAccount(this.mint, this.authority.publicKey);
    this.mintAccount(this.wrongMint, this.authority.publicKey);
    this.tokenAccount(this.treasuryToken, this.treasury.publicKey, this.mint, 0n);
    this.tokenAccount(this.adminToken, this.admin.publicKey, this.mint, 100_000_000n);
    this.users.forEach((user, i) => this.tokenAccount(this.userTokens[i], user.publicKey, this.mint, 5_000_000n));
    this.tokenAccount(this.wrongAuthority, this.attacker.publicKey, this.mint, 5_000_000n);
  }

  set(key: PublicKey, data: Buffer, owner: PublicKey, executable = false) {
    this.svm.setAccount(key, { lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(data.length))) + 1, data, owner, executable });
  }

  mintAccount(key: PublicKey, authority: PublicKey) {
    const data = Buffer.alloc(82);
    data.writeUInt32LE(1, 0); authority.toBuffer().copy(data, 4); data.writeBigUInt64LE(1_000_000_000n, 36); data[44] = 6; data[45] = 1;
    this.set(key, data, TOKEN_ID);
  }

  tokenAccount(key: PublicKey, owner: PublicKey, mint: PublicKey, amount: bigint) {
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data, 0); owner.toBuffer().copy(data, 32); data.writeBigUInt64LE(amount, 64); data[108] = 1;
    this.set(key, data, TOKEN_ID);
  }

  balance(key: PublicKey) { return Buffer.from(this.svm.getAccount(key)!.data).readBigUInt64LE(64); }
  setTime(ts: bigint, slot?: bigint) {
    if (slot !== undefined) this.svm.warpToSlot(slot);
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, ts));
  }
  get now() { return this.svm.getClock().unixTimestamp; }
  get slot() { return this.svm.getClock().slot; }
  send(ixs: TransactionInstruction[], signers: Keypair[]) {
    const tx = new Transaction(); tx.recentBlockhash = this.svm.latestBlockhash(); tx.feePayer = signers[0].publicKey;
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 700_000 }), ...ixs); tx.sign(...signers);
    const result = this.svm.sendTransaction(tx); this.svm.expireBlockhash(); return result;
  }
  ok(ixs: TransactionInstruction[], signers: Keypair[]) {
    const result = this.send(ixs, signers);
    if (result instanceof FailedTransactionMetadata) throw new Error(result.toString() + "\n" + result.meta().prettyLogs());
    return result as TransactionMetadata;
  }
  fails(ixs: TransactionInstruction[], signers: Keypair[], error: string) {
    const result = this.send(ixs, signers);
    expect(result instanceof FailedTransactionMetadata, `expected ${error}`).to.equal(true);
    const logs = (result as FailedTransactionMetadata).meta().logs().join("\n") + (result as FailedTransactionMetadata).toString();
    expect(logs, logs).to.contain(error);
  }
  acct(key: PublicKey): any {
    const account = this.svm.getAccount(key);
    if (!account) throw new Error(`missing ${key.toBase58()}`);
    const raw = this.coder.accounts.decode("Campaign", Buffer.from(account.data));
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.replace(/_(\w)/g, (_, letter) => letter.toUpperCase()), value]));
  }

  initIx(authority = this.authority, mint = this.mint, treasuryToken = this.treasuryToken) {
    return this.m.initialize(this.treasury.publicKey, 250).accountsPartial({
      upgradeAuthority: authority.publicKey, config: configPda(), program: PROGRAM_ID, programData: programDataPda(),
      mint, treasuryToken, tokenProgram: TOKEN_ID, systemProgram: SystemProgram.programId,
    }).instruction();
  }
  createIx(id: bigint, closeTs: bigint, cap = 10_000_000n, max = 24) {
    const campaign = campaignPda(id);
    return this.m.createCampaign(new BN(id.toString()), new BN(closeTs.toString()), new BN(cap.toString()), max)
      .accountsPartial({
        admin: this.admin.publicKey, config: configPda(), campaign,
        principalVault: vaultPda("principal-vault", campaign), prizeVault: vaultPda("prize-vault", campaign),
        lossVault: vaultPda("mock-loss-vault", campaign), mint: this.mint, tokenProgram: TOKEN_ID, systemProgram: SystemProgram.programId,
      }).instruction();
  }
  async depositIx(id: bigint, user = this.users[0], source = this.userTokens[this.users.indexOf(user)], amount = 1_000_000n) {
    const campaign = campaignPda(id);
    return this.m.deposit(new BN(amount.toString())).accountsPartial({
      owner: user.publicKey, config: configPda(), campaign, position: positionPda(campaign, user.publicKey), source,
      principalVault: vaultPda("principal-vault", campaign), tokenProgram: TOKEN_ID, systemProgram: SystemProgram.programId,
    }).instruction();
  }
  async mockAccrueIx(id: bigint, admin = this.admin, amount = 1_000_000n) {
    const campaign = campaignPda(id);
    return this.m.mockAccrue(new BN(amount.toString())).accountsPartial({
      admin: admin.publicKey, config: configPda(), campaign, source: this.adminToken,
      principalVault: vaultPda("principal-vault", campaign), tokenProgram: TOKEN_ID,
    }).instruction();
  }
  async mockLossIx(id: bigint, amount = 1_000_000n) {
    const campaign = campaignPda(id);
    return this.m.mockLoss(new BN(amount.toString())).accountsPartial({
      admin: this.admin.publicKey, config: configPda(), campaign,
      principalVault: vaultPda("principal-vault", campaign), lossVault: vaultPda("mock-loss-vault", campaign), tokenProgram: TOKEN_ID,
    }).instruction();
  }
  harvestIx(id: bigint) {
    const campaign = campaignPda(id);
    return this.m.harvest().accountsPartial({
      payer: this.payer.publicKey, config: configPda(), campaign,
      principalVault: vaultPda("principal-vault", campaign), prizeVault: vaultPda("prize-vault", campaign),
      treasuryToken: this.treasuryToken, tokenProgram: TOKEN_ID,
    }).instruction();
  }
  commitIx(id: bigint, seed = new Array(32).fill(0)) {
    return this.m.commitDraw(seed).accountsPartial({ payer: this.payer.publicKey, campaign: campaignPda(id) }).instruction();
  }
  settleIx(id: bigint, winnerToken: PublicKey, positions: PublicKey[]) {
    const campaign = campaignPda(id);
    return this.m.settleDraw().accountsPartial({
      payer: this.payer.publicKey, campaign, prizeVault: vaultPda("prize-vault", campaign), winnerToken, tokenProgram: TOKEN_ID,
    }).remainingAccounts(positions.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).instruction();
  }
  cancelIx(id: bigint) {
    const campaign = campaignPda(id);
    return this.m.cancelCampaign().accountsPartial({
      payer: this.payer.publicKey, campaign, principalVault: vaultPda("principal-vault", campaign),
      prizeVault: vaultPda("prize-vault", campaign), tokenProgram: TOKEN_ID,
    }).instruction();
  }
  withdrawIx(id: bigint, user = this.users[0], destination = this.userTokens[this.users.indexOf(user)]) {
    const campaign = campaignPda(id);
    return this.m.withdraw().accountsPartial({
      owner: user.publicKey, campaign, position: positionPda(campaign, user.publicKey),
      principalVault: vaultPda("principal-vault", campaign), prizeVault: vaultPda("prize-vault", campaign), destination, tokenProgram: TOKEN_ID,
    }).instruction();
  }

  async init() { this.ok([await this.initIx()], [this.authority]); }
  async campaign(id: bigint, closeIn = 10n) {
    const closeTs = BigInt(this.now) + closeIn;
    this.ok([await this.createIx(id, closeTs)], [this.admin]);
    return { address: campaignPda(id), closeTs };
  }
  data(key: PublicKey) {
    const account = this.svm.getAccount(key)!;
    return Buffer.from(account.data);
  }
  save(key: PublicKey, data: Buffer) {
    const account = this.svm.getAccount(key)!;
    this.svm.setAccount(key, { lamports: account.lamports, data, owner: account.owner, executable: account.executable });
  }
}

describe("lossless-v1 accounting (LiteSVM + devnet SPL Token binary)", () => {
  it("isolates principal, excludes donations, splits only tracked yield, snapshots once and withdraws", async () => {
    const w = new LosslessWorld();
    // A non-upgrade-authority cannot initialize the singleton config.
    w.fails([await w.initIx(w.attacker)], [w.attacker], err("Unauthorized"));
    w.fails([await w.initIx(w.authority, w.wrongMint)], [w.authority], err("WrongMint"));
    await w.init();
    const id = 1n;
    const campaign = await w.campaign(id);
    const [alice, bob] = w.users;
    const [aliceToken, bobToken] = w.userTokens;
    w.fails([await w.depositIx(id, alice, wrongMintSource(w, alice), 1_000_000n)], [alice], err("WrongMint"));
    w.fails([await w.depositIx(id, alice, w.wrongAuthority, 1_000_000n)], [alice], err("WrongTokenAccount"));
    w.fails([await w.mockAccrueIx(id, w.attacker)], [w.attacker], err("Unauthorized"));
    w.ok([await w.depositIx(id, alice)], [alice]);
    w.fails([await w.depositIx(id, alice)], [alice], "already in use"); // one position per wallet/campaign; replay cannot mint shares twice
    w.ok([await w.depositIx(id, bob)], [bob]);

    // A direct SPL donation increases raw vault tokens but not mock value, shares, or harvestable yield.
    const principal = vaultPda("principal-vault", campaign.address);
    const principalData = w.data(principal);
    principalData.writeBigUInt64LE(principalData.readBigUInt64LE(64) + 9_000_000n, 64);
    w.save(principal, principalData);
    w.ok([await w.harvestIx(id)], [w.payer]);
    expect(w.acct(campaign.address).prizeBalance.toString()).to.equal("0");

    // Early close and same-slot commit fail; a later slot matures the positions.
    w.fails([await w.commitIx(id)], [w.payer], err("Closed"));
    w.setTime(campaign.closeTs, w.slot);
    w.fails([await w.commitIx(id)], [w.payer], err("SharesNotMature"));
    w.setTime(campaign.closeTs, w.slot + 1n);

    // Tracked yield must be harvested into the prize ledger before committing.
    w.ok([await w.mockAccrueIx(id)], [w.admin]);
    w.fails([await w.commitIx(id)], [w.payer], err("HarvestRequired"));
    w.ok([await w.harvestIx(id)], [w.payer]);
    let state = w.acct(campaign.address);
    expect([state.principalLiability.toString(), state.mockValue.toString(), state.prizeBalance.toString()]).to.deep.equal(["2000000", "2000000", "975000"]);
    expect(w.balance(w.treasuryToken)).to.equal(25_000n);

    // Commit snapshots only the harvested prize and the mature positions.
    w.ok([await w.commitIx(id)], [w.payer]);
    state = w.acct(campaign.address);
    expect([state.snapshotShareSupply.toString(), state.snapshotPositionCount, state.snapshotPrizeBalance.toString()]).to.deep.equal(["2000000", 2, "975000"]);
    w.fails([await w.withdrawIx(id, alice)], [alice], err("WrongState"));
    const positions = [positionPda(campaign.address, alice.publicKey), positionPda(campaign.address, bob.publicKey)]
      .sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));
    const firstIsAlice = positions[0].equals(positionPda(campaign.address, alice.publicKey));
    const winnerToken = firstIsAlice ? aliceToken : bobToken;
    const otherToken = firstIsAlice ? bobToken : aliceToken;
    w.fails([await w.settleIx(id, winnerToken, [positions[0]])], [w.payer], err("BadSnapshot"));
    w.fails([await w.settleIx(id, winnerToken, [positions[0], positions[0]])], [w.payer], err("BadSnapshot"));
    w.fails([await w.settleIx(id, winnerToken, [...positions].reverse())], [w.payer], err("BadSnapshot"));
    w.fails([await w.settleIx(id, otherToken, positions)], [w.payer], err("WrongTokenAccount"));

    w.ok([await w.settleIx(id, winnerToken, positions)], [w.payer]);
    expect(w.balance(winnerToken)).to.equal(4_975_000n); // seed 0 selects the first weighted share
    w.fails([await w.settleIx(id, winnerToken, positions)], [w.payer], err("WrongState"));
    w.ok([await w.withdrawIx(id, alice)], [alice]);
    w.ok([await w.withdrawIx(id, bob)], [bob]);
    expect(w.balance(winnerToken)).to.equal(5_975_000n);
    expect(w.balance(otherToken)).to.equal(5_000_000n);
    expect(w.acct(campaign.address).principalLiability.toString()).to.equal("0");
    w.fails([await w.withdrawIx(id, alice)], [alice], err("AlreadyWithdrawn"));
    expect(w.balance(principal)).to.equal(9_000_000n); // donation is still inert, not claimed as principal/yield
  });

  it("rejects replayed config creation, insufficient funds, and deposits after close", async () => {
    const w = new LosslessWorld(); await w.init();
    w.fails([await w.initIx()], [w.authority], "already in use");
    const id = 10n; const campaign = await w.campaign(id);
    w.fails([await w.depositIx(id, w.users[0], w.userTokens[0], 5_000_001n)], [w.users[0]], "insufficient funds");
    expect(w.acct(campaign.address).principalLiability.toString()).to.equal("0");
    w.setTime(campaign.closeTs, w.slot + 1n);
    w.fails([await w.depositIx(id, w.users[0])], [w.users[0]], err("Closed"));
    expect(w.acct(campaign.address).positionCount).to.equal(0);
  });

  it("caps one-transaction settlement at 24 positions", async () => {
    const w = new LosslessWorld(); await w.init();
    const closeTs = BigInt(w.now) + 10n;
    w.ok([await w.createIx(6n, closeTs, 10_000_000n, 24)], [w.admin]);
    w.fails([await w.createIx(7n, closeTs, 10_000_000n, 25)], [w.admin], err("InvalidParams"));
  });

  it("settles a full 24-position campaign when the winner ATA already exists", async () => {
    const w = new LosslessWorld(); await w.init();
    const id = 6n; const closeTs = BigInt(w.now) + 10n;
    w.ok([await w.createIx(id, closeTs, 24_000_000n, 24)], [w.admin]);
    const campaign = { address: campaignPda(id), closeTs };
    for (const user of w.users) w.ok([await w.depositIx(id, user)], [user]);
    w.setTime(campaign.closeTs, w.slot + 1n);
    w.ok([await w.commitIx(id)], [w.payer]);
    const positions = w.users.map((user) => positionPda(campaign.address, user.publicKey))
      .sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));
    const winner = w.users.find((user) => positionPda(campaign.address, user.publicKey).equals(positions[0]))!;
    w.ok([await w.settleIx(id, w.userTokens[w.users.indexOf(winner)], positions)], [w.payer]);
    expect(w.acct(campaign.address).state).to.deep.equal({ settled: {} });
  });

  it("harvests existing yield before issuing more one-to-one shares", async () => {
    const w = new LosslessWorld(); await w.init();
    const id = 8n; const campaign = await w.campaign(id);
    w.ok([await w.depositIx(id, w.users[0])], [w.users[0]]);
    w.ok([await w.mockAccrueIx(id, w.admin, 1_000_000n)], [w.admin]);
    w.fails([await w.depositIx(id, w.users[1])], [w.users[1]], err("HarvestRequired"));
    w.ok([await w.harvestIx(id)], [w.payer]);
    w.ok([await w.depositIx(id, w.users[1])], [w.users[1]]);
    const state = w.acct(campaign.address);
    expect([state.principalLiability.toString(), state.mockValue.toString(), state.shareSupply.toString()]).to.deep.equal(["2000000", "2000000", "2000000"]);
    expect(state.prizeBalance.toString()).to.equal("975000");
  });

  it("pauses draw/harvest on shortfall, cancels after close, and pays withdrawals pro rata", async () => {
    const w = new LosslessWorld(); await w.init();
    const id = 2n; const campaign = await w.campaign(id);
    const user = w.users[0]; const token = w.userTokens[0];
    w.ok([await w.depositIx(id, user)], [user]);
    w.ok([await w.mockLossIx(id, 400_000n)], [w.admin]);
    expect(w.acct(campaign.address).shortfall).to.equal(true);
    w.ok([await w.harvestIx(id)], [w.payer]);
    expect(w.acct(campaign.address).prizeBalance.toString()).to.equal("0");
    w.setTime(campaign.closeTs, w.slot + 1n);
    w.fails([await w.commitIx(id)], [w.payer], err("Shortfall"));
    w.ok([await w.withdrawIx(id, user)], [user]); // shortfall exits remain available while no draw is committed
    expect(w.balance(token)).to.equal(4_600_000n);
    expect(w.acct(campaign.address).principalLiability.toString()).to.equal("0");
    w.ok([await w.cancelIx(id)], [w.payer]);
  });

  it("withdraws open shortfall from principal and prize ledgers", async () => {
    const w = new LosslessWorld(); await w.init();
    const id = 11n; const campaign = await w.campaign(id);
    const [alice, bob] = w.users; const [aliceToken, bobToken] = w.userTokens;
    w.ok([await w.depositIx(id, alice), await w.depositIx(id, bob)], [alice, bob]);
    w.ok([await w.mockAccrueIx(id, w.admin, 2_000_000n)], [w.admin]);
    w.ok([await w.harvestIx(id)], [w.payer]);
    w.ok([await w.mockLossIx(id, 1_500_000n)], [w.admin]);
    expect(w.acct(campaign.address).prizeBalance.toString()).to.equal("1950000");
    w.ok([await w.withdrawIx(id, alice)], [alice]);
    expect(w.balance(aliceToken)).to.equal(6_225_000n);
    w.ok([await w.withdrawIx(id, bob)], [bob]);
    expect(w.balance(bobToken)).to.equal(6_225_000n);
    const state = w.acct(campaign.address);
    expect([state.mockValue.toString(), state.prizeBalance.toString(), state.principalLiability.toString()]).to.deep.equal(["0", "0", "0"]);
    expect(w.balance(vaultPda("principal-vault", campaign.address))).to.equal(0n);
    expect(w.balance(vaultPda("prize-vault", campaign.address))).to.equal(0n);
  });

  it("keeps rounded open shortfall exits available and excludes donations", async () => {
    const w = new LosslessWorld(); await w.init();
    const id = 12n; const campaign = await w.campaign(id);
    const [alice, bob, carol] = w.users; const [aliceToken, bobToken, carolToken] = w.userTokens;
    const principal = vaultPda("principal-vault", campaign.address);
    const principalData = w.data(principal);
    principalData.writeBigUInt64LE(principalData.readBigUInt64LE(64) + 9_000_000n, 64);
    w.save(principal, principalData);
    w.ok([await w.depositIx(id, alice), await w.depositIx(id, bob), await w.depositIx(id, carol)], [alice, bob, carol]);
    w.ok([await w.mockLossIx(id, 1_000_000n)], [w.admin]);
    w.ok([await w.withdrawIx(id, alice)], [alice]);
    expect(w.balance(aliceToken)).to.equal(5_000_000n);
    expect(w.acct(campaign.address).shortfall).to.equal(true);
    w.ok([await w.withdrawIx(id, bob)], [bob]);
    w.ok([await w.withdrawIx(id, carol)], [carol]);
    expect(w.balance(bobToken)).to.equal(6_000_000n);
    expect(w.balance(carolToken)).to.equal(6_000_000n);
    const state = w.acct(campaign.address);
    expect([state.mockValue.toString(), state.principalLiability.toString(), state.positionCount]).to.deep.equal(["0", "0", 0]);
    expect(w.balance(principal)).to.equal(9_000_000n);
  });

  it("clears shortfall only when mock assets restore full principal and then permits a draw", async () => {
    const w = new LosslessWorld(); await w.init();
    const id = 5n; const campaign = await w.campaign(id);
    const user = w.users[0]; const token = w.userTokens[0];
    const position = positionPda(campaign.address, user.publicKey);
    w.ok([await w.depositIx(id, user)], [user]);
    w.ok([await w.mockLossIx(id, 400_000n)], [w.admin]);
    w.ok([await w.harvestIx(id)], [w.payer]);
    expect(w.acct(campaign.address).shortfall).to.equal(true);
    w.ok([await w.mockAccrueIx(id, w.admin, 400_000n)], [w.admin]);
    expect(w.acct(campaign.address).shortfall).to.equal(false);
    w.setTime(campaign.closeTs, w.slot + 1n);
    w.ok([await w.commitIx(id)], [w.payer]);
    w.ok([await w.settleIx(id, token, [position])], [w.payer]);
    w.ok([await w.withdrawIx(id, user)], [user]);
    expect(w.balance(token)).to.equal(5_000_000n);
  });

  it("cancels an unrevealed committed draw only after timeout and rolls prize back to withdrawals", async () => {
    const w = new LosslessWorld(); await w.init();
    const id = 3n; const campaign = await w.campaign(id);
    const user = w.users[0]; const token = w.userTokens[0];
    w.ok([await w.depositIx(id, user)], [user]);
    w.ok([await w.mockAccrueIx(id)], [w.admin]);
    w.ok([await w.harvestIx(id)], [w.payer]);
    w.setTime(campaign.closeTs, w.slot + 1n);
    w.ok([await w.commitIx(id)], [w.payer]);
    w.fails([await w.cancelIx(id)], [w.payer], err("TimeoutNotElapsed"));
    w.setTime(BigInt(w.now) + 3_601n, w.slot + 1n);
    w.ok([await w.cancelIx(id)], [w.payer]);
    expect(w.acct(campaign.address).prizeBalance.toString()).to.equal("0");
    expect(w.acct(campaign.address).mockValue.toString()).to.equal("1975000");
    w.ok([await w.withdrawIx(id, user)], [user]);
    expect(w.balance(token)).to.equal(5_975_000n);
  });

  it("rejects overflow atomically", async () => {
    const w = new LosslessWorld(); await w.init();
    const id = 4n; const campaign = await w.campaign(id);
    const user = w.users[0];
    w.ok([await w.depositIx(id, user)], [user]);
    const raw = w.data(campaign.address); raw.writeBigUInt64LE((1n << 64n) - 1n, 169); w.save(campaign.address, raw);
    const before = w.balance(w.adminToken);
    w.fails([await w.mockAccrueIx(id, w.admin, 1n)], [w.admin], err("Overflow"));
    expect(w.balance(w.adminToken)).to.equal(before);
  });
});

// A source with a valid mint but the wrong token authority is not a depositor source.
// Keep this helper outside the suite to make the malformed account construction explicit.
function wrongMintSource(w: LosslessWorld, user: Keypair) {
  const source = Keypair.generate().publicKey;
  w.tokenAccount(source, user.publicKey, w.wrongMint, 1_000_000n);
  return source;
}
