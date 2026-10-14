import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, DEVNET_RPC, type WalletSigner } from "./program.ts";

export const LOSSLESS_PROGRAM_ID = new PublicKey("EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF");
export const LOSSLESS_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const LOSSLESS_CAMPAIGN_DISC = sha256(new TextEncoder().encode("account:Campaign")).slice(0, 8);
export const LOSSLESS_POSITION_DISC = sha256(new TextEncoder().encode("account:Position")).slice(0, 8);
export const LOSSLESS_CONFIG_DISC = sha256(new TextEncoder().encode("account:Config")).slice(0, 8);
const connection = new Connection(DEVNET_RPC, "confirmed");
const STATES = ["Open", "DrawCommitted", "Settled", "Cancelled"] as const;
const losslessConfig = () => pda([new TextEncoder().encode("lossless-config")]);
const positionPda = (campaign: PublicKey, owner: PublicKey) => pda([new TextEncoder().encode("position"), campaign.toBytes(), owner.toBytes()]);
const pda = (seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, LOSSLESS_PROGRAM_ID)[0];
const u64le = (n: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const disc = (name: string) => sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);
const readKey = (bytes: Uint8Array, offset: number) => new PublicKey(bytes.slice(offset, offset + 32));
const compareKeys = (a: string, b: string) => {
  const left = new PublicKey(a).toBytes(), right = new PublicKey(b).toBytes();
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};
const readU64 = (view: DataView, offset: number) => view.getBigUint64(offset, true);
const same = (a: Uint8Array, b: Uint8Array) => b.every((x, i) => a[i] === x);

const LOSSLESS_TRANSACTION_FAILED = "The Lossless transaction failed. Check the campaign state and try again.";

export const LOSSLESS_ERROR_COPY = [
  "This wallet is not allowed to manage this Lossless campaign.",
  "The Lossless fee exceeds the prototype cap.",
  "The Lossless campaign parameters are invalid.",
  "The Lossless campaign is not in the required state.",
  "Lossless deposits are paused.",
  "The Lossless campaign is closed.",
  "The Lossless campaign has reached its deposit cap.",
  "The token account, owner, or mint does not match this Lossless campaign.",
  "The token mint is not the pinned six-decimal test USDC mint.",
  "The USDC amount must be positive.",
  "The campaign is in shortfall; deposits, harvest, and draws are stopped.",
  "Harvest tracked yield before issuing shares or committing the draw.",
  "The Lossless draw has no eligible shares.",
  "The latest deposit is not mature yet; wait for the next slot.",
  "The reveal timeout has not elapsed.",
  "The committed position snapshot no longer matches.",
  "This Lossless position was already withdrawn.",
  "The deterministic draw seed was exhausted.",
  "The Lossless transaction overflowed.",
] as const;

export function describeLosslessError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const hex = message.match(/custom program error: 0x([0-9a-f]+)/i)?.[1];
  const decimal = message.match(/["']?Custom["']?\s*:\s*(\d+)/)?.[1];
  const code = hex == null ? decimal == null ? undefined : Number(decimal) : parseInt(hex, 16);
  const copy = code == null ? undefined : LOSSLESS_ERROR_COPY[code - 6000];
  return copy ?? LOSSLESS_TRANSACTION_FAILED;
}

export function assertConfirmed(signature: string, result: { value: { err: unknown } }) {
  if (result.value.err != null) throw new Error(`Lossless transaction ${signature} failed after confirmation: ${JSON.stringify(result.value.err)}`);
}

export interface LosslessCampaign {
  address: string;
  id: bigint;
  mint: string;
  principalVault: string;
  prizeVault: string;
  lossVault: string;
  principalCap: bigint;
  closeTs: number;
  state: typeof STATES[number];
  principal: bigint;
  mockValue: bigint;
  shares: bigint;
  prize: bigint;
  positions: number;
  maxPositions: number;
  lastDepositSlot: bigint;
  shortfall: boolean;
  snapshotShares: bigint;
  snapshotPrize: bigint;
  snapshotPositions: number;
  snapshotSlot: bigint;
  commitTs: number;
  mockRandomness?: number[];
  winner?: string;
}

export interface LosslessPosition {
  address: string;
  campaign: string;
  owner: string;
  shares: bigint;
  eligibleAfterSlot: bigint;
  withdrawn: boolean;
}

export interface LosslessConfig { admin: string; mint: string; treasury: string; treasuryToken: string; feeBps: number; paused: boolean; }

export function decodeLosslessCampaign(address: string, bytes: Uint8Array): LosslessCampaign {
  if (bytes.length < 305 || !same(bytes, LOSSLESS_CAMPAIGN_DISC)) throw new Error("Not a lossless-v1 Campaign account");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  const u8 = () => view.getUint8(offset++);
  const u16 = () => { const n = view.getUint16(offset, true); offset += 2; return n; };
  const u64 = () => { const n = readU64(view, offset); offset += 8; return n; };
  const i64 = () => { const n = view.getBigInt64(offset, true); offset += 8; return n; };
  const key = () => { const value = readKey(bytes, offset).toBase58(); offset += 32; return value; };
  const id = u64();
  const mint = key();
  const principalVault = key();
  const prizeVault = key();
  const lossVault = key();
  if (mint !== LOSSLESS_USDC_MINT.toBase58()) throw new Error("Lossless campaign does not use the pinned devnet USDC mint");
  const principalCap = u64();
  const closeTs = Number(i64());
  const state = STATES[u8()];
  if (!state) throw new Error("Unknown lossless-v1 campaign state");
  const principal = u64();
  const mockValue = u64();
  const shares = u64();
  const prize = u64();
  const positions = u16();
  const maxPositions = u16();
  const lastDepositSlot = u64();
  const shortfall = u8() !== 0;
  const snapshotShares = u64();
  const snapshotPrize = u64();
  const snapshotPositions = u16();
  const snapshotSlot = u64();
  const commitTs = Number(i64());
  const randomness = [...bytes.slice(offset, offset + 32)]; offset += 32;
  const rawWinner = key();
  return {
    address, id, mint, principalVault, prizeVault, lossVault, principalCap, closeTs, state,
    principal, mockValue, shares, prize, positions, maxPositions, lastDepositSlot, shortfall,
    snapshotShares, snapshotPrize, snapshotPositions, snapshotSlot, commitTs,
    mockRandomness: state === "DrawCommitted" || state === "Settled" ? randomness : undefined,
    winner: /^1+$/.test(rawWinner) ? undefined : rawWinner,
  };
}

export function decodeLosslessPosition(address: string, bytes: Uint8Array): LosslessPosition {
  if (bytes.length < 90 || !same(bytes, LOSSLESS_POSITION_DISC)) throw new Error("Not a lossless-v1 Position account");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    address, campaign: readKey(bytes, 8).toBase58(), owner: readKey(bytes, 40).toBase58(),
    shares: readU64(view, 72), eligibleAfterSlot: readU64(view, 80), withdrawn: bytes[88] !== 0,
  };
}

export function decodeLosslessConfig(bytes: Uint8Array): LosslessConfig {
  if (bytes.length < 140 || !same(bytes, LOSSLESS_CONFIG_DISC)) throw new Error("Not a lossless-v1 Config account");
  return {
    admin: readKey(bytes, 8).toBase58(), mint: readKey(bytes, 40).toBase58(),
    treasury: readKey(bytes, 72).toBase58(), treasuryToken: readKey(bytes, 104).toBase58(),
    feeBps: new DataView(bytes.buffer, bytes.byteOffset + 136, 2).getUint16(0, true),
    paused: bytes[138] !== 0,
  };
}

export async function discoverLosslessCampaigns() {
  const accounts = await connection.getProgramAccounts(LOSSLESS_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: base58([...LOSSLESS_CAMPAIGN_DISC]) } }],
  });
  const campaigns = accounts.map(({ pubkey, account }) => decodeLosslessCampaign(pubkey.toBase58(), new Uint8Array(account.data)));
  campaigns.sort((a, b) => a.closeTs - b.closeTs);
  return { campaigns: campaigns.slice(-100).reverse(), found: campaigns.length, truncated: campaigns.length > 100, slot: BigInt(await connection.getSlot("confirmed")) };
}

export async function fetchLosslessConfig() {
  const account = await connection.getAccountInfo(losslessConfig(), "confirmed");
  if (!account) return undefined;
  if (!account.owner.equals(LOSSLESS_PROGRAM_ID)) throw new Error("Lossless config has the wrong owner");
  const config = decodeLosslessConfig(new Uint8Array(account.data));
  if (config.mint !== LOSSLESS_USDC_MINT.toBase58()) throw new Error("Lossless config does not use the pinned devnet USDC mint");
  return config;
}

export async function fetchLosslessPosition(campaignAddress: string, owner: string) {
  const address = positionPda(new PublicKey(campaignAddress), new PublicKey(owner));
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account) return undefined;
  if (!account.owner.equals(LOSSLESS_PROGRAM_ID)) throw new Error("Position account has the wrong owner");
  const position = decodeLosslessPosition(address.toBase58(), new Uint8Array(account.data));
  if (position.campaign !== campaignAddress || position.owner !== owner) throw new Error("Position PDA does not match the connected wallet and campaign");
  return position;
}

export async function fetchLosslessPositions(campaignAddress: string) {
  const accounts = await connection.getProgramAccounts(LOSSLESS_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 0, bytes: base58([...LOSSLESS_POSITION_DISC]) } },
      { memcmp: { offset: 8, bytes: campaignAddress } },
    ],
  });
  return accounts.map(({ pubkey, account }) => decodeLosslessPosition(pubkey.toBase58(), new Uint8Array(account.data)))
    .sort((a, b) => compareKeys(a.address, b.address));
}

export const associatedTokenAddress = (owner: PublicKey, mint = LOSSLESS_USDC_MINT) =>
  PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
export const usdc = (amount: bigint) => `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, "0")} USDC`;
export const parseUsdc = (amount: string) => {
  if (!/^\d+(?:\.\d{1,6})?$/.test(amount)) throw new Error("Enter a positive USDC amount with up to six decimals");
  const [whole, fraction = ""] = amount.split(".");
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (value <= 0n) throw new Error("USDC amount must be positive");
  if (value > (1n << 64n) - 1n) throw new Error("USDC amount is outside the supported range");
  return value;
};

export function estimatedOdds(position: LosslessPosition | undefined, campaign: LosslessCampaign, currentSlot: bigint) {
  if (campaign.state === "Settled" || campaign.state === "Cancelled") return { eligible: false, numerator: 0n, denominator: 0n };
  const supply = campaign.state === "DrawCommitted" ? campaign.snapshotShares : campaign.shares;
  const eligible = position && !position.withdrawn && position.eligibleAfterSlot <= (campaign.state === "DrawCommitted" ? campaign.snapshotSlot : currentSlot);
  return { eligible: Boolean(eligible), numerator: eligible ? position!.shares : 0n, denominator: supply };
}

function ix(name: string, keys: { pubkey: PublicKey; isSigner?: boolean; isWritable?: boolean }[], args = new Uint8Array()) {
  return new TransactionInstruction({
    programId: LOSSLESS_PROGRAM_ID,
    keys: keys.map(({ pubkey, isSigner = false, isWritable = false }) => ({ pubkey, isSigner, isWritable })),
    data: new Uint8Array([...disc(name), ...args]) as Buffer,
  });
}
const account = (pubkey: PublicKey, writable = false, signer = false) => ({ pubkey, isWritable: writable, isSigner: signer });
const tokenIx = (data: number[], keys: { pubkey: PublicKey; isSigner?: boolean; isWritable?: boolean }[]) =>
  new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, keys: keys.map(({ pubkey, isSigner = false, isWritable = false }) => ({ pubkey, isSigner, isWritable })), data: new Uint8Array(data) as Buffer });

async function ensureAta(owner: PublicKey, payer: PublicKey, ixs: TransactionInstruction[]) {
  const ata = associatedTokenAddress(owner);
  const current = await connection.getAccountInfo(ata, "confirmed");
  if (!current) {
    // Associated Token Program CreateIdempotent, so simultaneous first-use attempts are safe.
    ixs.push(tokenIx([1], [account(payer, true, true), account(ata, true), account(owner), account(LOSSLESS_USDC_MINT), account(SystemProgram.programId), account(TOKEN_PROGRAM_ID)]));
  } else {
    const data = new Uint8Array(current.data);
    if (current.owner.toBase58() !== TOKEN_PROGRAM_ID.toBase58() || data.length !== 165 || data[108] !== 1 || readKey(data, 0).toBase58() !== LOSSLESS_USDC_MINT.toBase58() || readKey(data, 32).toBase58() !== owner.toBase58()) {
      throw new Error("USDC associated token account has the wrong owner or mint");
    }
  }
  return ata;
}

async function send(ixs: TransactionInstruction[], wallet?: WalletSigner) {
  if (!wallet?.publicKey) throw new Error("Connect a devnet wallet first");
  const tx = new Transaction().add(...ixs);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const signature = wallet.sendTransaction
    ? await wallet.sendTransaction(tx, connection, { preflightCommitment: "confirmed" })
    : wallet.signTransaction
      ? await connection.sendRawTransaction((await wallet.signTransaction(tx)).serialize(), { preflightCommitment: "confirmed" })
      : (() => { throw new Error("This wallet cannot sign transactions"); })();
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  assertConfirmed(signature, confirmation);
  return signature;
}

const configKey = () => account(losslessConfig());
const tokenProgram = () => account(TOKEN_PROGRAM_ID);
const fixedCampaign = (address: string) => account(new PublicKey(address), true);
const campaignVaults = (c: LosslessCampaign) => ({
  principal: account(new PublicKey(c.principalVault), true),
  prize: account(new PublicKey(c.prizeVault), true),
  loss: account(new PublicKey(c.lossVault), true),
});

export async function depositLossless(c: LosslessCampaign, owner: string, amount: bigint, wallet?: WalletSigner) {
  if (!wallet?.publicKey || wallet.publicKey.toBase58() !== owner) throw new Error("Connected wallet must own the deposit");
  const ixs: TransactionInstruction[] = [];
  const source = await ensureAta(wallet.publicKey, wallet.publicKey, ixs);
  ixs.push(ix("deposit", [
    account(wallet.publicKey, true, true), configKey(), fixedCampaign(c.address),
    account(positionPda(new PublicKey(c.address), wallet.publicKey), true), account(source, true),
    account(new PublicKey(c.principalVault), true), tokenProgram(), account(SystemProgram.programId),
  ], u64le(amount)));
  return send(ixs, wallet);
}

export async function mockAccrueLossless(c: LosslessCampaign, admin: string, amount: bigint, wallet?: WalletSigner) {
  if (!wallet?.publicKey || wallet.publicKey.toBase58() !== admin) throw new Error("Only the configured mock admin may accrue test USDC");
  const ixs: TransactionInstruction[] = [];
  const source = await ensureAta(wallet.publicKey, wallet.publicKey, ixs);
  ixs.push(ix("mock_accrue", [account(wallet.publicKey, true, true), configKey(), fixedCampaign(c.address), account(source, true), account(new PublicKey(c.principalVault), true), tokenProgram()], u64le(amount)));
  return send(ixs, wallet);
}

export async function mockLossLossless(c: LosslessCampaign, admin: string, amount: bigint, wallet?: WalletSigner) {
  if (!wallet?.publicKey || wallet.publicKey.toBase58() !== admin) throw new Error("Only the configured mock admin may simulate a loss");
  const v = campaignVaults(c);
  return send([ix("mock_loss", [account(wallet.publicKey, false, true), configKey(), fixedCampaign(c.address), v.principal, v.loss, tokenProgram()], u64le(amount))], wallet);
}

export async function harvestLossless(c: LosslessCampaign, wallet?: WalletSigner) {
  const config = await fetchLosslessConfig();
  if (!config) throw new Error("Lossless config is not initialized");
  const v = campaignVaults(c);
  return send([ix("harvest", [account(wallet?.publicKey ?? PublicKey.default, false, true), configKey(), fixedCampaign(c.address), v.principal, v.prize, account(new PublicKey(config.treasuryToken), true), tokenProgram()])], wallet);
}

export async function commitLossless(c: LosslessCampaign, seed: number[], wallet?: WalletSigner) {
  if (seed.length !== 32 || seed.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error("Draw seed must contain 32 bytes");
  return send([ix("commit_draw", [account(wallet?.publicKey ?? PublicKey.default, false, true), fixedCampaign(c.address)], new Uint8Array(seed))], wallet);
}

export function deterministicWinner(positions: LosslessPosition[], seed: number[], supply: bigint) {
  if (seed.length !== 32 || supply <= 0n) throw new Error("Draw seed or share supply is invalid");
  let selected: bigint | undefined;
  const rejected = ((0xffff_ffff_ffff_ffffn % supply) + 1n) % supply;
  const limit = 0xffff_ffff_ffff_ffffn - rejected;
  for (let attempt = 0; attempt < 4; attempt++) {
    const start = attempt * 8;
    const word = BigInt(new DataView(new Uint8Array(seed).buffer).getBigUint64(start, true));
    if (word <= limit) { selected = word % supply; break; }
  }
  if (selected == null) throw new Error("Draw seed exhausted bounded rejection sampling");
  let total = 0n, winner: string | undefined;
  for (const position of positions) {
    const next = total + position.shares;
    if (selected >= total && selected < next) winner = position.owner;
    total = next;
  }
  if (total !== supply || !winner) throw new Error("Position shares do not match the snapshotted supply");
  return winner;
}

export async function settleWithAtaSetup(
  setup: TransactionInstruction[],
  settlement: TransactionInstruction[],
  sendBatch: (ixs: TransactionInstruction[]) => Promise<string>,
) {
  if (setup.length) await sendBatch(setup);
  return sendBatch(settlement);
}

export async function settleLossless(c: LosslessCampaign, wallet?: WalletSigner) {
  if (!wallet?.publicKey || !c.mockRandomness) throw new Error("The committed deterministic seed is missing");
  const positions = await fetchLosslessPositions(c.address);
  if (positions.length !== c.snapshotPositions || positions.some((p) => p.withdrawn || p.eligibleAfterSlot > c.snapshotSlot)) throw new Error("Position set does not match the committed snapshot");
  const winner = deterministicWinner(positions, c.mockRandomness, c.snapshotShares);
  const setup: TransactionInstruction[] = [];
  const winnerToken = await ensureAta(new PublicKey(winner), wallet.publicKey, setup);
  const ixs = [ix("settle_draw", [
    account(wallet.publicKey, false, true), fixedCampaign(c.address), account(new PublicKey(c.prizeVault), true), account(winnerToken, true), tokenProgram(),
    ...positions.map((p) => account(new PublicKey(p.address))),
  ])];
  return settleWithAtaSetup(setup, ixs, (batch) => send(batch, wallet));
}

export async function cancelLossless(c: LosslessCampaign, wallet?: WalletSigner) {
  const v = campaignVaults(c);
  return send([ix("cancel_campaign", [account(wallet?.publicKey ?? PublicKey.default, false, true), fixedCampaign(c.address), v.principal, v.prize, tokenProgram()])], wallet);
}

export async function withdrawLossless(c: LosslessCampaign, owner: string, wallet?: WalletSigner) {
  if (!wallet?.publicKey || wallet.publicKey.toBase58() !== owner) throw new Error("Only the position owner can withdraw");
  const ixs: TransactionInstruction[] = [];
  const destination = await ensureAta(wallet.publicKey, wallet.publicKey, ixs);
  ixs.push(ix("withdraw", [
    account(wallet.publicKey, true, true), fixedCampaign(c.address),
    account(positionPda(new PublicKey(c.address), wallet.publicKey), true), account(new PublicKey(c.principalVault), true),
    account(new PublicKey(c.prizeVault), true), account(destination, true), tokenProgram(),
  ]));
  return send(ixs, wallet);
}
