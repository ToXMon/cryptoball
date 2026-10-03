#!/usr/bin/env node
// Ops: rescue a stuck campaign - cancel it once the program allows, then refund every Active ticket.
//
//   node ops/cancel-refund.mjs --id 3            # cancel (if eligible) + refund all active tickets
//   node ops/cancel-refund.mjs --id 3 --dry-run  # print the plan, sign nothing
//
// Eligible states (programs/cryptoball/src/lib.rs cancel_campaign):
//   Open + no tickets + past close_ts, or DrawCommitted + past committed_at + REVEAL_TIMEOUT_SECS.
// Prints a receipt per transaction with the buyer, the refunded lamports and an Explorer link.
// Never mainnet.
import anchor from "@coral-xyz/anchor";
import web3 from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadIdl, retry, RPC, WALLET, PROGRAM_ID } from "./open-game.mjs";

const { Keypair, PublicKey, Connection, SystemProgram, LAMPORTS_PER_SOL } = web3;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(ROOT, "ops", "log", "cancel-refund.log");
const EXPLORER = "https://explorer.solana.com";
export const REVEAL_TIMEOUT_SECS = 3600; // programs/cryptoball/src/constants.rs

// The anchor coder camelCases enum variants (drawCommitted); lower-case them all for comparisons.
const stateName = (c) => Object.keys(c.state)[0].toLowerCase();
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const log = (line) => { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); };
const link = (sig) => `${EXPLORER}/tx/${sig}?cluster=devnet`;

export function parseArgs(argv) {
  const out = { id: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--id") { const v = argv[++i]; if (v === undefined) throw new Error("--id needs a value"); out.id = Number(v); }
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (out.id === undefined) throw new Error("--id needs the campaign id: node ops/cancel-refund.mjs --id 3");
  if (!Number.isInteger(out.id) || out.id <= 0) throw new Error("--id must be a positive integer");
  return out;
}

// The program owns both gates; this only explains which one is expected to fire, so a stuck
// campaign reports "not eligible yet" instead of a bare chain error.
export function cancelEligibility(campaign, nowSec) {
  const st = stateName(campaign);
  if (st === "open") {
    return Number(campaign.closeTs) <= nowSec
      ? { ok: true, why: "Open, no tickets, past close_ts" }
      : { ok: false, why: `Open but closes at ${new Date(Number(campaign.closeTs) * 1000).toISOString()}` };
  }
  if (st === "drawcommitted") {
    const deadline = Number(campaign.committedAt) + REVEAL_TIMEOUT_SECS;
    return nowSec > deadline
      ? { ok: true, why: `DrawCommitted, reveal timeout passed at ${new Date(deadline * 1000).toISOString()}` }
      : { ok: false, why: `DrawCommitted, reveal timeout not elapsed until ${new Date(deadline * 1000).toISOString()}` };
  }
  if (st === "cancelled") return { ok: false, why: "already cancelled - nothing to cancel; refund any ticket still Active" };
  return { ok: false, why: `state ${st} - only Open or DrawCommitted can be cancelled` };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const idl = loadIdl();
  const programId = new PublicKey(PROGRAM_ID);
  const connection = new Connection(RPC, "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf8"))));
  anchor.setProvider(new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" }));
  const program = new anchor.Program(idl, anchor.provider);

  const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const [campaignPda] = PublicKey.findProgramAddressSync([Buffer.from("campaign"), u64le(args.id)], programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), campaignPda.toBuffer()], programId);
  const raw = await retry(() => connection.getAccountInfo(campaignPda, "confirmed"), "getAccountInfo");
  if (!raw) throw new Error(`campaign ${args.id} (${campaignPda.toBase58()}) does not exist`);
  const campaign = program.coder.accounts.decode("campaign", raw.data);
  const nowSec = Math.floor(Date.now() / 1000);

  console.log(`campaign ${args.id} ${campaignPda.toBase58()}`);
  console.log(`  state=${stateName(campaign)} price=${Number(campaign.priceLamports) / LAMPORTS_PER_SOL} SOL tickets=${campaign.ticketCount} close=${new Date(Number(campaign.closeTs) * 1000).toISOString()} committed_at=${campaign.committedAt ? new Date(Number(campaign.committedAt) * 1000).toISOString() : "-"}`);
  if (campaign.randomness && Buffer.from(campaign.randomness).some((b) => b !== 0)) {
    console.log(`  revealed randomness already on chain (${Buffer.from(campaign.randomness).toString("hex").slice(0, 16)}...): this campaign already settled its draw value, cancellation is the fallback only`);
  }
  if (campaign.randAccount) {
    const ra = await connection.getAccountInfo(new PublicKey(campaign.randAccount), "confirmed").catch(() => null);
    console.log(`  randomness account ${campaign.randAccount}: ${ra ? `${ra.data.length} bytes on chain` : "ABSENT"}`);
  }

  const eligibility = cancelEligibility(campaign, nowSec);
  console.log(`  cancel: ${eligibility.ok ? "eligible" : "NOT ELIGIBLE"} - ${eligibility.why}`);

  // Every Active ticket, by index, so the refund loop covers the buyer who is waiting.
  const tickets = [];
  for (let i = 0; i < Number(campaign.ticketCount); i++) {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("ticket"), campaignPda.toBuffer(), u32le(i)], programId);
    const info = await connection.getAccountInfo(pda, "confirmed");
    if (!info) { console.log(`  ticket #${i}: account missing`); continue; }
    const t = program.coder.accounts.decode("ticket", info.data);
    const status = Object.keys(t.status)[0].toLowerCase(); // anchor camelCases "refunded"
    const buyer = new PublicKey(t.buyer);
    console.log(`  ticket #${i} ${status} buyer=${buyer.toBase58()}`);
    if (status === "active") tickets.push({ index: i, pda, buyer });
  }

  const receipts = [];
  const st = stateName(campaign);
  // A campaign that still needs cancelling but cannot is a dead end; an already-Cancelled one is not
  // - its tickets may still be Active and those refunds are the whole point.
  if (args.dryRun) {
    console.log(`\ndry-run: would ${st === "cancelled" ? "" : "cancel campaign " + args.id + " and "}refund ${tickets.length} ticket(s): ${tickets.map((t) => `#${t.index}->${t.buyer.toBase58()}`).join(", ") || "none"}`);
    return 0;
  }
  if (!eligibility.ok && st !== "cancelled") {
    console.log(`\nnothing sent: ${eligibility.why}`);
    log(`SKIP id=${args.id} state=${st} why=${eligibility.why} activeTickets=${tickets.length}`);
    return 0;
  }

  const send = async (label, fn) => {
    const before = await retry(() => connection.getBalance(payer.publicKey, "confirmed"), "getBalance");
    let signature;
    try {
      signature = await fn();
      await retry(() => connection.confirmTransaction(signature, "confirmed"), "confirmTransaction");
    } catch (e) {
      const msg = String(e.message ?? e).split("\n")[0];
      console.error(`  ${label} FAILED: ${msg}`);
      log(`FAILED id=${args.id} ${label} reason=${msg}`);
      receipts.push({ label, ok: false, reason: msg });
      return null;
    }
    const after = await retry(() => connection.getBalance(payer.publicKey, "confirmed"), "getBalance");
    const r = { label, ok: true, signature, explorer: link(signature), costSol: ((before - after) / LAMPORTS_PER_SOL).toFixed(9) };
    console.log(`  ${label} ${signature} (${r.costSol} SOL) ${r.explorer}`);
    receipts.push(r);
    return r;
  };

  if (st !== "cancelled") {
    const r = await send("cancel_campaign", () =>
      program.methods.cancelCampaign().accountsPartial({ payer: payer.publicKey, campaign: campaignPda }).rpc());
    if (!r) return 1;
  }

  for (const t of tickets) {
    const balBefore = await retry(() => connection.getBalance(t.buyer, "confirmed"), "getBalance");
    const r = await send(`refund_ticket #${t.index} -> ${t.buyer.toBase58()}`, () =>
      program.methods
        .refundTicket()
        .accountsPartial({
          payer: payer.publicKey,
          campaign: campaignPda,
          ticket: t.pda,
          vault,
          buyerWallet: t.buyer,
          systemProgram: SystemProgram.programId,
        })
        .rpc());
    if (!r) continue;
    const balAfter = await retry(() => connection.getBalance(t.buyer, "confirmed"), "getBalance");
    const delta = balAfter - balBefore;
    console.log(`    buyer ${t.buyer.toBase58()} +${delta} lamports (${(delta / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    receipts[receipts.length - 1].refundedLamports = String(delta);
    receipts[receipts.length - 1].buyer = t.buyer.toBase58();
  }

  log(`RESCUED ${JSON.stringify({ id: args.id, campaign: campaignPda.toBase58(), receipts })}`);
  const failed = receipts.filter((r) => !r.ok).length;
  console.log(`\n${receipts.length - failed}/${receipts.length} transactions landed`);
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`cancel-refund: ${e.message ?? e}`); log(`ERROR ${String(e.message ?? e).split("\n")[0]}`); process.exit(2); });
}