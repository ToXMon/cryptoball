/**
 * Program adapter (MOCK). The only module that knows how to talk to the Anchor program.
 * Shapes follow docs/design.md sections 4 to 6 (Campaign, Ticket accounts; buy_ticket, refund_ticket;
 * DrawSettled event). When the IDL lands, replace this file's bodies with Anchor calls; keep the exports.
 * initialize / commit_draw / settle_draw are admin or keeper calls, not player calls, so they are not here.
 * There is no payout call: settle_draw pays the winner in the same transaction.
 */

export type CampaignState = "Open" | "DrawCommitted" | "Settled" | "Cancelled";
export type TicketStatus = "Active" | "Refunded";

export interface Campaign {
  id: number;
  priceLamports: bigint;
  closeTs: number; // unix seconds
  maxTickets: number;
  ticketCount: number;
  feeBps: number;
  state: CampaignState;
  randAccount?: string;
  randomness?: string; // hex, once settled
  winningIndex?: number;
  winner?: string;
}

export interface Ticket {
  campaign: number;
  index: number;
  buyer: string;
  numbers: number[]; // 5, ascending, 1..=69
  bonus: number; // 1..=26
  asset: string; // Core asset (NFT) address
  status: TicketStatus;
  signature: string;
}

/** Pool math as in settle_draw (R-48): ledger pool, floor fee. */
export function payout(c: Pick<Campaign, "priceLamports" | "ticketCount" | "feeBps">) {
  const pool = c.priceLamports * BigInt(c.ticketCount);
  const fee = (pool * BigInt(c.feeBps)) / 10_000n;
  return { pool, fee, prize: pool - fee };
}

/** R-69: every CryptoballError variant (programs/cryptoball/src/errors.rs) has English copy. */
export const ERROR_COPY = {
  NotImplemented: "This action is not available yet.",
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
  Overflow: "A number overflowed. Please try again.",
} as const;
export type CryptoballError = keyof typeof ERROR_COPY;

export class ProgramError extends Error {
  code: CryptoballError;
  constructor(code: CryptoballError) { super(ERROR_COPY[code]); this.code = code; }
}

/** Anything thrown to a human-readable English string. */
export function describeError(e: unknown): string {
  if (e instanceof ProgramError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return "The wallet request was cancelled.";
  return "Something went wrong. Check your wallet and tickets before trying again.";
}

// ---------- mock chain ----------

const now = () => Math.floor(Date.now() / 1000);
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fake = (len: number) => Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => b58[b % 58]).join("");
const PRICE = 100_000_000n;

const campaigns: Campaign[] = [
  { id: 1, priceLamports: PRICE, closeTs: now() + 2 * 86400 + 4 * 3600, maxTickets: 1000, ticketCount: 412, feeBps: 1000, state: "Open" },
  { id: 2, priceLamports: PRICE, closeTs: now() + 6 * 3600 + 20 * 60, maxTickets: 1000, ticketCount: 97, feeBps: 1000, state: "Open" },
  {
    id: 3, priceLamports: PRICE, closeTs: now() - 86400, maxTickets: 1000, ticketCount: 640, feeBps: 1000, state: "Settled",
    randAccount: "7QkyBzv2mW1sTq9rFhX3dNpL5aYcE8uRjV4oGtKbH6Dn",
    randomness: "9f3ac1d27b04e65a81c9d0f3b7a2e418c6d5f0a97b3e2d1c84a6f5e0b9d37c21",
    winningIndex: 233, winner: "7xKpQm3RvTz8NwYb4LcJh2SdUe5FaGoV9fQ2",
  },
];

const tickets: Ticket[] = [
  { campaign: 3, index: 233, buyer: "7xKpQm3RvTz8NwYb4LcJh2SdUe5FaGoV9fQ2", numbers: [7, 19, 33, 48, 62], bonus: 11, asset: "Cb7wTn2xLpKd9QeVr4YhUj6MaSz3FgNcB8oX", status: "Active", signature: "mockwinner" + fake(70) },
];

const find = (id: number) => {
  const c = campaigns.find((c) => c.id === id);
  if (!c) throw new ProgramError("BadAccount");
  return c;
};

export async function fetchCampaigns(): Promise<Campaign[]> {
  await delay(); return campaigns.map((c) => ({ ...c }));
}
export async function fetchCampaign(id: number): Promise<Campaign> {
  await delay(); return { ...find(id) };
}
export async function fetchTicket(campaign: number, index: number): Promise<Ticket | undefined> {
  await delay(150); return tickets.find((t) => t.campaign === campaign && t.index === index);
}
/** Lookup by wallet address or purchase signature (R-63). */
export async function fetchTickets(query: string): Promise<Ticket[]> {
  await delay(); const q = query.trim();
  return tickets.filter((t) => t.buyer === q || t.signature === q).map((t) => ({ ...t }));
}

/** buy_ticket. `buyer` is the connected wallet; the real version sends a wallet-signed transaction on devnet. */
export async function buyTicket(buyer: string, campaignId: number, numbers: number[], bonus: number): Promise<Ticket> {
  await delay(700);
  const c = find(campaignId);
  if (c.state !== "Open") throw new ProgramError("WrongState");
  if (now() >= c.closeTs) throw new ProgramError("SalesClosed");
  if (c.ticketCount >= c.maxTickets) throw new ProgramError("SoldOut");
  const ok = numbers.length === 5 && numbers.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 69 && (i === 0 || n > numbers[i - 1]));
  if (!ok || !Number.isInteger(bonus) || bonus < 1 || bonus > 26) throw new ProgramError("InvalidNumbers");
  const t: Ticket = { campaign: c.id, index: c.ticketCount, buyer, numbers: [...numbers], bonus, asset: fake(44), status: "Active", signature: fake(88) };
  c.ticketCount += 1;
  tickets.push(t);
  return { ...t };
}

/** refund_ticket: permissionless, pays the stored buyer. Only valid on a Cancelled campaign. */
export async function refundTicket(campaignId: number, index: number): Promise<void> {
  await delay(700);
  if (find(campaignId).state !== "Cancelled") throw new ProgramError("WrongState");
  const t = tickets.find((t) => t.campaign === campaignId && t.index === index);
  if (!t) throw new ProgramError("BadAccount");
  if (t.status === "Refunded") throw new ProgramError("AlreadyRefunded");
  t.status = "Refunded";
}
