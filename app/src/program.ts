import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, type SendOptions } from "@solana/web3.js";

export type CampaignState = "Open" | "DrawCommitted" | "Settled" | "Cancelled";
export type TicketStatus = "Active" | "Refunded";

export interface Campaign {
  id: number;
  priceLamports: bigint;
  closeTs: number;
  maxTickets: number;
  ticketCount: number;
  feeBps: number;
  state: CampaignState;
  collection: string;
  randAccount?: string;
  randomness?: string;
  winningIndex?: number;
  winner?: string;
}

export interface Ticket {
  campaign: number;
  index: number;
  buyer: string;
  numbers: number[];
  bonus: number;
  asset: string;
  status: TicketStatus;
  signature: string;
}

export interface WalletSigner {
  publicKey: PublicKey | null;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  sendTransaction?: (tx: Transaction, connection: Connection, options?: SendOptions) => Promise<string>;
}

// The one devnet endpoint for the whole app: a dedicated QuickNode plan, because the free public
// devnet RPC rate-limited us (HTTP 429 on program uploads and pipeline runs). Browser-visible by
// design - this is a public static site, so the token is a public value; watch the plan's quota.
export const DEVNET_RPC = "https://hardworking-broken-field.solana-devnet.quiknode.pro/ec3c0ae727818aaaead289ef2e844d4df1411e75/";
export const PROGRAM_ID = new PublicKey("GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC");

/** Official Solana devnet faucet. We run no faucet of our own: that is real infrastructure with abuse and rate-limit liability. */
export const FAUCET_URL = "https://faucet.solana.com";
/**
 * What one carton costs on top of its price: the rent-exempt minimum of the ticket account and of the Core asset it
 * mints, plus the transaction fee, since a checkout sends one transaction per carton. Rounded up (rent is about
 * 0.0037 SOL of that) so the stated need covers a cart of any size and never lands on zero.
 */
const CARTON_COST_LAMPORTS = 4_000_000n; // 0.004 SOL

/** What a checkout actually needs: the ticket price(s) plus that per-carton cost. An empty cart needs nothing. */
export const fundingNeeded = (priceLamports: bigint, count = 1) => {
  const cartons = BigInt(Math.max(0, count));
  return (priceLamports + CARTON_COST_LAMPORTS) * cartons;
};

/**
 * What the funding helper says about a wallet, from its latest balance read. `empty` is the same fact the wallet dialog
 * shows: a wallet that holds nothing, which only a surface with no cart total to compare against can report that way.
 */
export type Funding = { kind: "ok" } | { kind: "unreadable" } | { kind: "empty" } | { kind: "short"; balance: bigint; needed: bigint };

/**
 * The one funding rule every surface shares: the checkout card, the wallet dialog card and the pre-payment gate all read
 * the same state from the latest read, so shrinking the cart clears the funding prompt and growing it raises one again,
 * and nothing latches. `needed` is what the surface is about to ask for, and a surface with no checkout in hand passes
 * none. A read that failed is its own state, so a flaky RPC neither claims the wallet is short nor hides the helper; a
 * balance not read yet claims nothing.
 */
export const funding = (balance: bigint | undefined, unreadable: boolean, needed?: bigint): Funding => {
  if (needed != null && needed <= 0n) return { kind: "ok" }; // nothing selected, so there is nothing to fund and nothing to ask for
  if (unreadable) return { kind: "unreadable" };
  if (balance == null) return { kind: "ok" };
  if (needed == null) return balance === 0n ? { kind: "empty" } : { kind: "ok" };
  return balance < needed ? { kind: "short", balance, needed } : { kind: "ok" };
};

/**
 * Whether a payment has to stop on this state: only a read that came back and found the wallet short does. A read that
 * failed fails open, because the chain is the real judge of whether the wallet can pay and a wallet that cannot fails
 * there with FUNDING_ERROR.
 */
export const blocksPayment = (fund: Funding) => fund.kind === "short";

/** Raw RPC failures that really mean "this wallet has no money" (an unfunded devnet wallet). */
export const isFundingError = (e: unknown) =>
  /prior credit|insufficient/i.test(e instanceof Error ? e.message : String(e));

/** The one sentence an unfunded wallet gets instead of raw RPC simulation text. */
export const FUNDING_ERROR = "This wallet does not have enough devnet SOL yet. Get free devnet SOL from the faucet, then try again.";
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const CAMPAIGN_IDS = [1];
const connection = new Connection(DEVNET_RPC, "confirmed");

const DISCRIMINATORS = {
  buyTicket: [11, 24, 17, 193, 168, 116, 164, 169],
  refundTicket: [178, 97, 75, 218, 227, 28, 21, 73],
  campaign: [50, 40, 49, 11, 157, 220, 229, 192],
  ticket: [41, 228, 24, 165, 78, 90, 235, 200],
};
const CAMPAIGN_STATE: CampaignState[] = ["Open", "DrawCommitted", "Settled", "Cancelled"];
const TICKET_STATUS: TicketStatus[] = ["Active", "Refunded"];
const u64le = (n: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const u32le = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const pda = (seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const configPda = () => pda([new TextEncoder().encode("config")]);
const campaignPda = (id: number) => pda([new TextEncoder().encode("campaign"), u64le(id)]);
const vaultPda = (campaign: PublicKey) => pda([new TextEncoder().encode("vault"), campaign.toBytes()]);
const ticketPda = (campaign: PublicKey, index: number) => pda([new TextEncoder().encode("ticket"), campaign.toBytes(), u32le(index)]);
const hex = (a: Uint8Array) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");

class Reader {
  o = 8;
  data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }
  u8() { return this.data[this.o++]; }
  u16() { const n = new DataView(this.data.buffer, this.data.byteOffset + this.o, 2).getUint16(0, true); this.o += 2; return n; }
  u32() { const n = new DataView(this.data.buffer, this.data.byteOffset + this.o, 4).getUint32(0, true); this.o += 4; return n; }
  u64() { const n = new DataView(this.data.buffer, this.data.byteOffset + this.o, 8).getBigUint64(0, true); this.o += 8; return n; }
  i64() { const n = new DataView(this.data.buffer, this.data.byteOffset + this.o, 8).getBigInt64(0, true); this.o += 8; return n; }
  key() { const k = new PublicKey(this.data.slice(this.o, this.o + 32)); this.o += 32; return k.toBase58(); }
  bytes(n: number) { const b = this.data.slice(this.o, this.o + n); this.o += n; return b; }
}
const same = (a: Uint8Array, b: number[]) => b.every((x, i) => a[i] === x);

function decodeCampaign(bytes: Uint8Array): Campaign {
  const data = new Uint8Array(bytes);
  if (!same(data, DISCRIMINATORS.campaign)) throw new ProgramError("BadAccount");
  const r = new Reader(data);
  const id = Number(r.u64());
  const priceLamports = r.u64();
  const closeTs = Number(r.i64());
  const maxTickets = r.u32();
  const ticketCount = r.u32();
  const feeBps = r.u16();
  const state = CAMPAIGN_STATE[r.u8()] ?? "Cancelled";
  const collection = r.key();
  const randAccount = r.key();
  r.u64(); r.i64();
  const randomness = r.bytes(32);
  const winningIndex = r.u32();
  const winner = r.key();
  return {
    id, priceLamports, closeTs, maxTickets, ticketCount, feeBps, state, collection,
    randAccount: /^1+$/.test(randAccount) ? undefined : randAccount,
    randomness: randomness.some(Boolean) ? hex(randomness) : undefined,
    winningIndex: state === "Settled" ? winningIndex : undefined,
    winner: /^1+$/.test(winner) ? undefined : winner,
  };
}

function decodeTicket(bytes: Uint8Array, signature = ""): Ticket {
  const data = new Uint8Array(bytes);
  if (!same(data, DISCRIMINATORS.ticket)) throw new ProgramError("BadAccount");
  const r = new Reader(data);
  const campaign = r.key();
  const id = CAMPAIGN_IDS.find((i) => campaignPda(i).toBase58() === campaign) ?? 0;
  return {
    campaign: id,
    index: r.u32(),
    buyer: r.key(),
    numbers: [...r.bytes(5)],
    bonus: r.u8(),
    asset: r.key(),
    status: TICKET_STATUS[r.u8()] ?? "Refunded",
    signature,
  };
}

export function payout(c: Pick<Campaign, "priceLamports" | "ticketCount" | "feeBps">) {
  const pool = c.priceLamports * BigInt(c.ticketCount);
  const fee = (pool * BigInt(c.feeBps)) / 10_000n;
  return { pool, fee, prize: pool - fee };
}

export const ERROR_COPY = {
  FeeTooHigh: "The fee is above the allowed cap.",
  Unauthorized: "This wallet is not allowed to do that.",
  WrongState: "This draw is not in the right state for that.",
  Paused: "Ticket sales are paused. Try again soon.",
  SalesClosed: "Sales for this draw have closed.",
  NotClosed: "This draw has not closed yet.",
  InvalidParams: "Invalid ticket price or ticket cap.",
  InvalidNumbers: "Those numbers are not valid. Pick 5 different numbers from 1 to 69 and a Cryptoball from 1 to 26.",
  SoldOut: "This draw is sold out.",
  BadRandomness: "The randomness account is not the expected one.",
  NotRevealed: "The randomness is not revealed yet.",
  BadAccount: "An account did not match what the program expected.",
  TimeoutNotElapsed: "The reveal timeout has not passed yet.",
  AlreadyRefunded: "This ticket was already refunded.",
  BadSettlement: "This ticket cannot settle the draw.",
  NoTickets: "This draw has no tickets.",
  TreasuryBelowRent: "The treasury wallet is below rent exemption.",
  RandomnessExhausted: "The revealed randomness could not produce draw numbers.",
  Overflow: "A number overflowed. Please try again.",
} as const;
export type CryptoballError = keyof typeof ERROR_COPY;

export class ProgramError extends Error {
  code: CryptoballError;
  constructor(code: CryptoballError) { super(ERROR_COPY[code]); this.code = code; }
}

export function describeError(e: unknown): string {
  if (e instanceof ProgramError) return e.message;
  // An unfunded wallet must never reach the player as raw RPC text.
  if (isFundingError(e)) return FUNDING_ERROR;
  const msg = e instanceof Error ? e.message : String(e);
  const code = msg.match(/custom program error: 0x([0-9a-f]+)/i)?.[1];
  const key = code && (Object.keys(ERROR_COPY)[parseInt(code, 16) - 6000] as CryptoballError | undefined);
  if (key && ERROR_COPY[key]) return ERROR_COPY[key];
  if (/reject|denied|cancel/i.test(msg)) return "The wallet request was cancelled.";
  return msg || "Something went wrong. Check your wallet and tickets before trying again.";
}

/** Devnet balance in lamports. */
export const getBalance = async (address: string) => BigInt(await connection.getBalance(new PublicKey(address), "confirmed"));

export async function fetchCampaigns(): Promise<Campaign[]> {
  return (await Promise.all(CAMPAIGN_IDS.map(fetchCampaign))).filter((c) => c.state === "Open" || c.ticketCount > 0);
}
export async function fetchCampaign(id: number): Promise<Campaign> {
  const a = await connection.getAccountInfo(campaignPda(id), "confirmed");
  if (!a) throw new ProgramError("BadAccount");
  return decodeCampaign(new Uint8Array(a.data));
}
export async function fetchTicket(campaignId: number, index: number): Promise<Ticket | undefined> {
  const a = await connection.getAccountInfo(ticketPda(campaignPda(campaignId), index), "confirmed");
  return a ? decodeTicket(new Uint8Array(a.data)) : undefined;
}
export async function fetchTickets(query: string): Promise<Ticket[]> {
  const q = query.trim();
  if (!q) return [];
  const out: Ticket[] = [];
  for (const id of CAMPAIGN_IDS) {
    const c = await fetchCampaign(id);
    for (let i = 0; i < c.ticketCount; i++) {
      const t = await fetchTicket(id, i);
      if (t && (t.buyer === q || t.signature === q)) out.push(t);
    }
  }
  return out;
}

function validatePick(numbers: number[], bonus: number) {
  const ok = numbers.length === 5 && numbers.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 69 && (i === 0 || n > numbers[i - 1]));
  if (!ok || !Number.isInteger(bonus) || bonus < 1 || bonus > 26) throw new ProgramError("InvalidNumbers");
}

async function send(tx: Transaction, wallet: WalletSigner, extra: Keypair[] = []) {
  if (!wallet.publicKey) throw new ProgramError("Unauthorized");
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  if (extra.length) tx.partialSign(...extra);
  if (wallet.sendTransaction) return wallet.sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
  if (!wallet.signTransaction) throw new ProgramError("Unauthorized");
  const signed = await wallet.signTransaction(tx);
  return connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
}

export async function buyTicket(buyer: string, campaignId: number, numbers: number[], bonus: number, wallet?: WalletSigner): Promise<Ticket> {
  validatePick(numbers, bonus);
  if (!wallet?.publicKey || wallet.publicKey.toBase58() !== buyer) throw new ProgramError("Unauthorized");
  const c = await fetchCampaign(campaignId);
  if (c.state !== "Open") throw new ProgramError("WrongState");
  if (Math.floor(Date.now() / 1000) >= c.closeTs) throw new ProgramError("SalesClosed");
  if (c.ticketCount >= c.maxTickets) throw new ProgramError("SoldOut");
  const campaign = campaignPda(campaignId);
  const ticket = ticketPda(campaign, c.ticketCount);
  const asset = Keypair.generate();
  const data = new Uint8Array([...DISCRIMINATORS.buyTicket, ...numbers, bonus]) as Buffer; // ponytail: Buffer type only; web3.js takes the bytes as-is
  const tx = new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: campaign, isSigner: false, isWritable: true },
      { pubkey: ticket, isSigner: false, isWritable: true },
      { pubkey: asset.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(c.collection), isSigner: false, isWritable: true },
      { pubkey: vaultPda(campaign), isSigner: false, isWritable: true },
      { pubkey: CORE_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }));
  const signature = await send(tx, wallet, [asset]);
  await connection.confirmTransaction(signature, "confirmed");
  return { campaign: campaignId, index: c.ticketCount, buyer, numbers: [...numbers], bonus, asset: asset.publicKey.toBase58(), status: "Active", signature };
}

export async function refundTicket(campaignId: number, index: number, wallet?: WalletSigner): Promise<void> {
  if (!wallet?.publicKey) throw new ProgramError("Unauthorized");
  const t = await fetchTicket(campaignId, index);
  if (!t) throw new ProgramError("BadAccount");
  const campaign = campaignPda(campaignId);
  const tx = new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: campaign, isSigner: false, isWritable: false },
      { pubkey: ticketPda(campaign, index), isSigner: false, isWritable: true },
      { pubkey: vaultPda(campaign), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(t.buyer), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array(DISCRIMINATORS.refundTicket) as Buffer,
  }));
  await send(tx, wallet);
}
