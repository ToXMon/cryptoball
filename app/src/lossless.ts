import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, DEVNET_RPC } from "./program.ts";

export const LOSSLESS_PROGRAM_ID = new PublicKey("EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF");
export const LOSSLESS_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const LOSSLESS_CAMPAIGN_DISC = sha256(new TextEncoder().encode("account:Campaign")).slice(0, 8);
const connection = new Connection(DEVNET_RPC, "confirmed");
const STATES = ["Open", "DrawCommitted", "Settled", "Cancelled"] as const;

export interface LosslessCampaign {
  address: string;
  id: bigint;
  closeTs: number;
  state: typeof STATES[number];
  principal: bigint;
  mockValue: bigint;
  shares: bigint;
  prize: bigint;
  positions: number;
  maxPositions: number;
  shortfall: boolean;
}

export function decodeLosslessCampaign(address: string, bytes: Uint8Array): LosslessCampaign {
  if (bytes.length < 206 || !LOSSLESS_CAMPAIGN_DISC.every((b, i) => bytes[i] === b)) throw new Error("Not a lossless-v1 Campaign account");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  const u8 = () => view.getUint8(offset++);
  const u16 = () => { const n = view.getUint16(offset, true); offset += 2; return n; };
  const u64 = () => { const n = view.getBigUint64(offset, true); offset += 8; return n; };
  const i64 = () => { const n = view.getBigInt64(offset, true); offset += 8; return n; };
  const skip = (n: number) => { offset += n; };
  const id = u64();
  const mint = new PublicKey(bytes.slice(offset, offset + 32));
  offset += 32;
  if (!mint.equals(LOSSLESS_USDC_MINT)) throw new Error("Unexpected lossless-v1 campaign mint");
  skip(32 * 3); // the three isolated token vaults
  skip(8); // principal cap
  const closeTs = Number(i64());
  const state = STATES[u8()];
  if (!state) throw new Error("Unknown lossless-v1 campaign state");
  const principal = u64();
  const mockValue = u64();
  const shares = u64();
  const prize = u64();
  const positions = u16();
  const maxPositions = u16();
  skip(8); // last deposit slot
  const shortfall = u8() !== 0;
  return { address, id, closeTs, state, principal, mockValue, shares, prize, positions, maxPositions, shortfall };
}

export async function discoverLosslessCampaigns() {
  const accounts = await connection.getProgramAccounts(LOSSLESS_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: base58([...LOSSLESS_CAMPAIGN_DISC]) } }],
  });
  const campaigns = accounts.map(({ pubkey, account }) => decodeLosslessCampaign(pubkey.toBase58(), new Uint8Array(account.data)));
  campaigns.sort((a, b) => a.closeTs - b.closeTs);
  return { campaigns: campaigns.slice(-100).reverse(), found: campaigns.length, truncated: campaigns.length > 100 };
}

export const usdc = (amount: bigint) => `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, "0")} USDC`;
