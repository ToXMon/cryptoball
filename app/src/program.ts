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
  /** Switchboard slot the randomness was seeded from: half of what makes the draw verifiable. */
  seedSlot?: number;
  committedAt?: number;
  randomness?: string;
  winningIndex?: number;
  winner?: string;
  /** The numbers actually drawn at settle, as distinct from the numbers on the winning ticket. */
  winningNumbers?: number[];
  winningBonus?: number;
  feeLamports?: bigint;
  prizeLamports?: bigint;
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
 * The one funding rule every surface shares: the checkout card and the wallet dialog card both read the same state from
 * the latest read, so shrinking the cart clears the funding prompt and growing it raises one again, and nothing latches.
 * `needed` is what the surface is about to ask for, and a surface with no checkout in hand passes none. A read that failed
 * is its own state at every cart size, so a flaky RPC neither claims the wallet is short nor hides the helper; a balance
 * not read yet claims nothing. Nothing here stops a payment: the chain is the judge of whether a wallet can pay.
 */
export const funding = (balance: bigint | undefined, unreadable: boolean, needed?: bigint): Funding => {
  if (needed != null && needed <= 0n) return { kind: "ok" }; // nothing selected, so there is nothing to fund and nothing to ask for
  if (unreadable) return { kind: "unreadable" };
  if (balance == null) return { kind: "ok" };
  if (needed == null) return balance === 0n ? { kind: "empty" } : { kind: "ok" };
  return balance < needed ? { kind: "short", balance, needed } : { kind: "ok" };
};

/**
 * What a checkout does with the order, and the whole of what it decides before it sends: no wallet yet means open the
 * wallet dialog, a payment already running or an empty cart means wait, anything else means pay with that same wallet.
 * The funding state is deliberately not a question here — the question has nowhere to put one — so a wallet that could not
 * be read, and a wallet short for the order, both go to the chain, which rejects the ones that cannot pay and comes back
 * as `FUNDING_ERROR` with the faucet in it. So a failed or slow read can never turn the funding card into a payment that
 * will not start.
 */
export type PayGate = { kind: "connect" } | { kind: "wait" } | { kind: "pay"; buyer: string };
export const payGate = (q: { buyer?: string; busy: boolean; cartons: number }): PayGate =>
  !q.buyer ? { kind: "connect" } : q.busy || q.cartons < 1 ? { kind: "wait" } : { kind: "pay", buyer: q.buyer };

/** Raw RPC failures that really mean "this wallet has no money" (an unfunded devnet wallet). */
export const isFundingError = (e: unknown) =>
  /prior credit|insufficient/i.test(e instanceof Error ? e.message : String(e));

/** The one sentence an unfunded wallet gets instead of raw RPC simulation text. */
export const FUNDING_ERROR = "This wallet does not have enough devnet SOL yet. Get free devnet SOL from the faucet, then try again.";
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const connection = new Connection(DEVNET_RPC, "confirmed");

const DISCRIMINATORS = {
  buyTicket: [11, 24, 17, 193, 168, 116, 164, 169],
  refundTicket: [178, 97, 75, 218, 227, 28, 21, 73],
  claimSol: [139, 113, 179, 189, 190, 30, 132, 195], // sha256("global:claim_sol")[0..8]
  campaign: [50, 40, 49, 11, 157, 220, 229, 192], // account:campaign, checked against ops/cryptoball.idl.json by app checks
  ticket: [41, 228, 24, 165, 78, 90, 235, 200],
};
export const { campaign: CAMPAIGN_ACCOUNT_DISC } = DISCRIMINATORS;

/** base58 of a few discriminator bytes, because an RPC `memcmp` filter takes base58 and the app adds no dependency for eight bytes. */
const base58 = (bytes: number[]) => {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return out || alphabet[0];
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
const faucetPda = () => pda([new TextEncoder().encode("faucet-v2")]);
const faucetVaultPda = () => pda([new TextEncoder().encode("faucet-vault")]);
const claimRecordPda = (claimer: PublicKey) => pda([new TextEncoder().encode("claim"), claimer.toBytes()]);
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

export function decodeCampaign(bytes: Uint8Array): Campaign {
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
  const seedSlot = Number(r.u64());
  const committedAt = Number(r.i64());
  const randomness = r.bytes(32);
  const winningIndex = r.u32();
  const winner = r.key();
  const winningNumbers = [...r.bytes(5)];
  const winningBonus = r.u8();
  const feeLamports = r.u64();
  const prizeLamports = r.u64();
  return {
    id, priceLamports, closeTs, maxTickets, ticketCount, feeBps, state, collection,
    randAccount: /^1+$/.test(randAccount) ? undefined : randAccount,
    seedSlot: seedSlot || undefined,
    committedAt: committedAt || undefined,
    randomness: randomness.some(Boolean) ? hex(randomness) : undefined,
    winningIndex: state === "Settled" ? winningIndex : undefined,
    winner: /^1+$/.test(winner) ? undefined : winner,
    winningNumbers: winningNumbers.some(Boolean) ? winningNumbers : undefined,
    winningBonus: winningBonus || undefined,
    feeLamports: feeLamports || undefined,
    prizeLamports: prizeLamports || undefined,
  };
}

function decodeTicket(bytes: Uint8Array, campaignId: number, signature = ""): Ticket {
  const data = new Uint8Array(bytes);
  if (!same(data, DISCRIMINATORS.ticket)) throw new ProgramError("BadAccount");
  const r = new Reader(data);
  return {
    campaign: campaignId,
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

/**
 * What a draw is to a reader, decided once from the chain rather than from a state word. A Settled draw is only "settled"
 * once it names a winning ticket and a wallet: a settled account whose ticket read failed is still shown as settled, with
 * a missing ticket, rather than quietly re-labelled. Cancelled and committed are their own answers because both have
 * something to say (everyone refunded / the reveal is still owed).
 */
export type Outcome = "open" | "settled" | "committed" | "cancelled";
export const outcome = (c: Pick<Campaign, "state" | "winningIndex" | "winner">): Outcome =>
  c.state === "Settled" ? "settled" : c.state === "Cancelled" ? "cancelled" : c.state === "DrawCommitted" ? "committed" : "open";

/** Whether the connected wallet holds the one ticket that won. The winner is the winning ticket's stored buyer. */
export const iWon = (c: Pick<Campaign, "state" | "winner">, me?: string) => Boolean(me && c.state === "Settled" && c.winner === me);

/** The settle transaction announces `DrawSettled`, which is what tells it apart from the commit on the same accounts. */
export const isSettleLog = (logs: string[]) => logs.some((l) => l.startsWith("Program log: DrawSettled"));

/** The on-chain address of a draw, for the Explorer history link. */
export const campaignAddress = (id: number) => campaignPda(id).toBase58();

/**
 * The settlement proof, read from the chain: the settle transaction that settled this draw. Only two transactions ever
 * touch the randomness account (commit, then settle), so a short history is enough and it is scanned for the event.
 */
export async function fetchSettleSignature(randAccount: string): Promise<string | undefined> {
  const history = await connection.getSignaturesForAddress(new PublicKey(randAccount), { limit: 5 });
  for (const { signature } of history) {
    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (isSettleLog(tx?.meta?.logMessages ?? [])) return signature;
  }
  return undefined;
}

// ---- devnet SOL faucet (claim_sol). The three ceilings are program constants, read from its source, never arguments.

/** `MAX_CLAIM_LAMPORTS`: the largest single drip. */
export const CLAIM_MAX = 110_000_000n;
/** `MAX_CLAIM_LIFETIME_LAMPORTS`: three max claims per wallet. */
export const CLAIM_LIFETIME_CAP = 330_000_000n;
/** `INITIAL_POOL_LAMPORTS`: the admin-set ceiling on one pool's total dispensing. */
export const CLAIM_POOL_CAP = 1_000_000_000n;

export interface FaucetLedger { dispensed: bigint; pool: bigint; }
export interface ClaimRecord { claimer: string; claimed: bigint; }

/** Lamports left in the pool, or undefined when the ledger could not be read (never a claim about an unread pool). */
export const faucetRemaining = (f?: FaucetLedger) => (f == null ? undefined : f.pool > f.dispensed ? f.pool - f.dispensed : 0n);

/**
 * What the claim button does, decided from the two on-chain tallies. It never proposes more than the pool has left or
 * more than this wallet's lifetime allowance, so a button that says `Claim 0.11 SOL` means the chain will accept it: an
 * unreachable request is a wallet that is told nothing until it is told no. `capped` is the lifetime allowance spent and
 * `drained` is the pool empty; both are the program's own words, rendered with the external faucet as the way out.
 */
export type ClaimGate = { kind: "connect" } | { kind: "wait" } | { kind: "capped" } | { kind: "drained" } | { kind: "claim"; amount: bigint };
export const claimGate = (q: { address?: string; busy: boolean; remaining?: bigint; claimed?: bigint }): ClaimGate => {
  if (!q.address) return { kind: "connect" };
  if (q.busy) return { kind: "wait" };
  const lifetime = q.claimed == null ? CLAIM_MAX : CLAIM_LIFETIME_CAP - q.claimed;
  const room = q.remaining == null ? CLAIM_MAX : q.remaining;
  const ceiling = lifetime < CLAIM_MAX ? lifetime : CLAIM_MAX; // the per-claim cap applies whatever the lifetime left
  const amount = ceiling < room ? ceiling : room;
  if (amount <= 0n) return lifetime <= 0n ? { kind: "capped" } : { kind: "drained" };
  return { kind: "claim", amount };
};

/** The pool ledger: `dispensed` is ever-dispensed, `pool` is what the admin budgeted (README receipts). */
export async function fetchFaucet(): Promise<FaucetLedger> {
  const a = await connection.getAccountInfo(faucetPda(), "confirmed");
  if (!a) throw new ProgramError("BadAccount");
  const data = new Uint8Array(a.data);
  return { dispensed: new DataView(data.buffer, data.byteOffset + 8, 16).getBigUint64(0, true), pool: new DataView(data.buffer, data.byteOffset + 16, 8).getBigUint64(0, true) };
}

/** One wallet's lifetime tally, or nothing claimed yet if the account does not exist. */
export async function fetchClaimRecord(address: string): Promise<ClaimRecord> {
  const a = await connection.getAccountInfo(claimRecordPda(new PublicKey(address)), "confirmed");
  if (!a) return { claimer: address, claimed: 0n };
  const data = new Uint8Array(a.data);
  return { claimer: address, claimed: new DataView(data.buffer, data.byteOffset + 40, 8).getBigUint64(0, true) };
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
  // Devnet SOL faucet (claim_sol). Appended in the same order as errors.rs.
  ClaimTooLarge: "That is more than one claim allows. Ask for 0.11 SOL or less.",
  ClaimLifetimeCap: "This wallet has already claimed its lifetime allowance from the faucet.",
  FaucetDrained: "The faucet is empty for now. It is topped up periodically - try again later.",
  FaucetEmpty: "The faucet does not have enough SOL right now. Try again later.",
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

/**
 * Every campaign the program owns, discovered from the chain rather than from a hardcoded id list: the draw account
 * discriminator is what tells a campaign from a ticket, a config or the faucet ledger, and the id each one carries is
 * the admin's own counter. Open draws come first (soonest close first), finished ones newest first, so the home page is
 * never blank because everything it had is over.
 *
 * `DISCOVERY_CAP` only bounds what a page will draw. Discovery itself is never partial: if the count is over the cap,
 * the newest are shown and the caller is told how many were left out (see `truncated`), because a quietly shortened
 * list reads as "these are all the draws" and that is the one thing this must not say.
 */
export const DISCOVERY_CAP = 50;

export interface Campaigns { campaigns: Campaign[]; found: number; truncated: number }

export async function fetchCampaigns(): Promise<Campaign[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: base58(DISCRIMINATORS.campaign) } }],
  });
  return campaignsFrom(accounts.map((a) => decodeCampaign(new Uint8Array(a.account.data))));
}

/** The same discovery, keeping the count the cap would hide, so a caller can say so out loud. */
export async function discoverCampaigns(): Promise<Campaigns> {
  const found = await fetchCampaigns();
  const campaigns = found.slice(0, DISCOVERY_CAP);
  return { campaigns, found: found.length, truncated: found.length - campaigns.length };
}

/** Newest first, so a cap keeps the most recent draws. */
function campaignsFrom(all: Campaign[]): Campaign[] {
  return all.sort((a, b) => b.id - a.id);
}
export async function fetchCampaign(id: number): Promise<Campaign> {
  const a = await connection.getAccountInfo(campaignPda(id), "confirmed");
  if (!a) throw new ProgramError("BadAccount");
  return decodeCampaign(new Uint8Array(a.data));
}
export async function fetchTicket(campaignId: number, index: number): Promise<Ticket | undefined> {
  const a = await connection.getAccountInfo(ticketPda(campaignPda(campaignId), index), "confirmed");
  return a ? decodeTicket(new Uint8Array(a.data), campaignId) : undefined;
}
export async function fetchTickets(query: string): Promise<Ticket[]> {
  const q = query.trim();
  if (!q) return [];
  const out: Ticket[] = [];
  for (const c of await fetchCampaigns()) {
    const id = c.id;
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

/**
 * Claim devnet SOL from the on-chain faucet (the fast path: no leaving the site, no paste). The three accounts are
 * derived exactly as the program's seeds say - ledger `["faucet-v2"]`, vault `["faucet-vault"]`, and this wallet's own
 * `["claim", claimer]` record - and `amount` is whatever `claimGate` allowed, never more than the program allows. Every
 * ceiling is the program's, and a claim that breaks one comes back as `ClaimTooLarge`/`ClaimLifetimeCap`/`FaucetDrained`/
 * `FaucetEmpty`, which `describeError` turns into the plain-English copy rather than raw RPC text.
 */
export async function claimSol(amount: bigint, wallet?: WalletSigner): Promise<string> {
  if (!wallet?.publicKey) throw new ProgramError("Unauthorized");
  const tx = new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: claimRecordPda(wallet.publicKey), isSigner: false, isWritable: true },
      { pubkey: faucetPda(), isSigner: false, isWritable: true },
      { pubkey: faucetVaultPda(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([...DISCRIMINATORS.claimSol, ...u64le(amount)]) as Buffer,
  }));
  const signature = await send(tx, wallet);
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}
