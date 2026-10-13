#!/usr/bin/env node
// One repeat-safe devnet ticket for the manifest's seeded SOL campaign.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "ops", "devnet-campaign-seed.json");
const EXPLORER = "https://explorer.solana.com";
export const DEMO_PICK = { numbers: [7, 14, 21, 35, 49], bonus: 11 };
export const entryAction = (ticket, expected) => {
  if (!ticket) return "buy";
  if (!expected?.buyer) return "unverified";
  const same = ticket.buyer === expected.buyer && ticket.index === 0 && ticket.status === "Active"
    && ticket.bonus === expected.bonus && ticket.numbers.join(",") === expected.numbers.join(",");
  if (!same) throw new Error("ticket zero already belongs to another entry; refusing to buy twice or alter it");
  return "exists";
};

export function parseArgs(argv) {
  if (argv.some((arg) => arg !== "--send" && arg !== "--help" && arg !== "-h")) throw new Error("usage: demo-sol-entry.mjs [--send]");
  return { send: argv.includes("--send"), help: argv.includes("--help") || argv.includes("-h") };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log("demo-sol-entry [--send] · read-only by default; uses one fixed ticket on the manifest's devnet SOL campaign"); return 0; }
  const { buyTicket, fetchCampaign, fetchTicket } = await import("../app/src/program.ts");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const id = Number(manifest.sol.id);
  const campaign = await fetchCampaign(id);
  const current = await fetchTicket(id, 0);
  let payer;
  if (args.send) {
    const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME || "", ".tape", "cryptoball-deploy.json");
    payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
  }
  const currentAction = entryAction(current, payer ? { ...DEMO_PICK, buyer: payer.publicKey.toBase58() } : undefined);
  if (currentAction === "unverified") {
    console.log(`entry exists: buyer=${current.buyer} (owner unverified; pass --send to verify) asset=${current.asset}`);
    return 0;
  }
  if (currentAction === "exists") {
    if (campaign.ticketCount !== 1) throw new Error("campaign contains additional entries; refusing to treat the demo as an idempotent no-op");
    console.log(`entry already exists: buyer=${current.buyer} asset=${current.asset}`);
    return 0;
  }
  if (campaign.ticketCount !== 0) throw new Error(`campaign already has ${campaign.ticketCount} ticket(s); refusing to add an unplanned entry`);
  if (campaign.state !== "Open" || Date.now() / 1000 >= campaign.closeTs) throw new Error("campaign is not currently accepting tickets");
  console.log(`plan campaign=${campaign.id} ticket=0 numbers=${DEMO_PICK.numbers.join("-")} + ${DEMO_PICK.bonus} buyer=${payer?.publicKey.toBase58() ?? "signer not loaded"}`);
  if (!args.send) { console.log("plan only: nothing signed; pass --send after reviewing"); return 0; }
  const wallet = {
    publicKey: payer.publicKey,
    signTransaction: async (tx) => { tx.partialSign(payer); return tx; },
  };
  const ticket = await buyTicket(payer.publicKey.toBase58(), id, DEMO_PICK.numbers, DEMO_PICK.bonus, wallet);
  const confirmed = await fetchTicket(id, 0);
  if (!confirmed || entryAction(confirmed, { ...DEMO_PICK, buyer: payer.publicKey.toBase58() }) !== "exists") throw new Error("ticket transaction confirmed but read-back did not match the fixed entry");
  console.log(`ticket asset https://explorer.solana.com/address/${ticket.asset}?cluster=devnet`);
  console.log(`ticket transaction ${EXPLORER}/tx/${ticket.signature}?cluster=devnet`);
  console.log(`buyer ${EXPLORER}/address/${ticket.buyer}?cluster=devnet`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`demo-sol-entry: ${e.message ?? e}`); process.exit(1); });
}
