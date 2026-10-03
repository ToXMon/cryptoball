#!/usr/bin/env node
// Ops: open one devnet campaign with explicit parameters.
//
//   node ops/open-game.mjs --price 0.1 --duration 8 --cap 1000
//
// Prints the campaign address, the close time in UTC, the tx signature with an
// Explorer link, and the measured devnet cost. Reuses target/idl/cryptoball.json
// and the deploy key at ~/.tape/cryptoball-deploy.json. Never mainnet.
import anchor from "@coral-xyz/anchor";
import web3 from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Keypair, PublicKey, SystemProgram, Connection, LAMPORTS_PER_SOL } = web3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.CRYPTOBALL_RPC || "https://api.devnet.solana.com";
const WALLET = process.env.ANCHOR_WALLET || `${process.env.HOME}/.tape/cryptoball-deploy.json`;
const LOG = path.join(ROOT, "ops", "log", "open-game.log");
const EXPLORER = "https://explorer.solana.com";
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// mirrors programs/cryptoball/src/constants.rs
export const LIMITS = {
  minPriceLamports: 2_000_000n, // MIN_TICKET_PRICE_LAMPORTS (0.002 SOL)
  maxTickets: 10_000, // MAX_TICKETS
};

// public devnet rate-limits hard, so every RPC call is retried with backoff.
export async function retry(fn, what, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e);
      const retryable = /429|too many|rate limit|timeout|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i.test(msg);
      if (!retryable || i === tries - 1) break;
      const wait = 2 ** i * 1000;
      console.error(`  ${what}: ${msg.split("\n")[0]} - retrying in ${wait}ms (${i + 1}/${tries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

export function parseArgs(argv) {
  const out = { dryRun: false, allowDuplicate: false, price: "0.1", duration: 8, cap: 1000, id: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--allow-duplicate") out.allowDuplicate = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    else {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = argv[i + 1];
      if (val === undefined) throw new Error(`${a} needs a value`);
      if (!(key in out)) throw new Error(`unknown flag: ${a}`);
      out[key] = ["price", "duration", "cap", "id"].includes(key) && val !== "auto" ? Number(val) : val;
      i++;
    }
  }
  return out;
}

// Refuse before signing anything, and say which limit was hit.
export function validate({ price, cap, duration, now }) {
  if (!Number.isFinite(price) || price <= 0) throw new Error("--price must be a positive number of SOL (tiers: 0.01 / 0.1 / 1)");
  const lamports = BigInt(Math.round(price * LAMPORTS_PER_SOL));
  if (lamports < LIMITS.minPriceLamports) {
    throw new Error(`price ${price} SOL is ${lamports} lamports, below the program's MIN_TICKET_PRICE_LAMPORTS of ${LIMITS.minPriceLamports} (0.002 SOL): the smallest prize would not cover vault rent`);
  }
  if (!Number.isInteger(cap) || cap <= 0 || cap > LIMITS.maxTickets) {
    throw new Error(`--cap ${cap} is outside the program's limits: 1..${LIMITS.maxTickets} tickets (MAX_TICKETS)`);
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("--duration must be a positive number of hours");
  if (!Number.isInteger(duration)) throw new Error("--duration must be whole hours");
  return { priceLamports: lamports, closeTs: Math.floor(now / 1000) + duration * 3600 };
}

// Two close windows "overlap" when they land within TOLERANCE of each other: that is the case
// where players would have to choose between two games at the same price closing together.
export const CLOSE_OVERLAP_TOLERANCE_SECS = 2 * 3600;
export function findDuplicate(campaigns, priceLamports, closeTs, nowSec) {
  // state/price come off the anchor coder (a plain object, and a BN), so normalise before comparing.
  return campaigns.find(
    (c) =>
      JSON.stringify(c.state) === JSON.stringify({ open: {} }) &&
      String(c.priceLamports) === String(priceLamports) &&
      Number(c.closeTs) > nowSec &&
      Math.abs(Number(c.closeTs) - closeTs) <= CLOSE_OVERLAP_TOLERANCE_SECS,
  );
}

// Staggered durations for the rolling schedule, so closes never all land together.
export const CYCLE_HOURS = [6, 10, 14];
export function staggeredDuration(cycleIndex) {
  return CYCLE_HOURS[((cycleIndex % CYCLE_HOURS.length) + CYCLE_HOURS.length) % CYCLE_HOURS.length];
}
// --duration auto: rotate the cycle by wall-clock slot, so any launcher (launchd, cron, a human)
// gets a staggered duration with no state of its own to keep.
export function autoDuration(epochMs) {
  return staggeredDuration(Math.floor(epochMs / (6 * 3600 * 1000)));
}

const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

function log(line) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(`open-game --price <SOL> --duration <hours> --cap <n> [--id <n>] [--dry-run] [--allow-duplicate]

  --price      ticket price in SOL (program floor 0.002, tiers 0.01 / 0.1 / 1)
  --duration   hours from now until the campaign closes, or 'auto' to rotate 6/10/14h by slot
  --cap        max tickets (program max 10000)
  --id         campaign id (default: next free id on chain)
  --dry-run    validate, price it, print the plan, send nothing
  --allow-duplicate  skip the same-price/overlapping-window guard

wallet: ${WALLET}   rpc: ${RPC}   log: ${path.relative(ROOT, LOG)}`);
    return 0;
  }

  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target", "idl", "cryptoball.json"), "utf8"));
  const programId = new PublicKey("GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC");
  if (idl.address !== programId.toBase58()) throw new Error(`IDL address ${idl.address} is not the deployed program ${programId}`);

  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, "utf8"))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const duration = args.duration === "auto" ? autoDuration(now) : args.duration;
  const { priceLamports, closeTs } = validate({ price: args.price, cap: args.cap, duration, now });

  // Every campaign that already exists, so we never reuse an id and never double-book a price.
  // Devnet rejects memcmp/dataSize filters on getProgramAccounts (INVALID_PARAMS), so fetch the
  // program's accounts - a handful - and pick the campaign discriminator out client side.
  const CAMPAIGN_DISCRIMINATOR = Buffer.from([50, 40, 49, 11, 157, 220, 229, 192]).toString("hex"); // anchor: sha256("account:Campaign")[..8]
  const accounts = await retry(() => connection.getProgramAccounts(programId, { commitment: "confirmed" }), "getProgramAccounts");
  const existing = [];
  for (const a of accounts) {
    if (a.account.data.subarray(0, 8).toString("hex") !== CAMPAIGN_DISCRIMINATOR) continue;
    const c = program.coder.accounts.decode("campaign", a.account.data);
    existing.push({ ...c, id: BigInt(c.id), address: a.pubkey }); // id after the spread: the anchor coder's id is a BN
  }
  existing.sort((x, y) => (x.id < y.id ? -1 : 1));
  const dup = findDuplicate(existing, priceLamports, closeTs, nowSec);
  if (dup && !args.allowDuplicate && !args.dryRun) {
    throw new Error(
      `refusing: campaign ${dup.id} (${dup.address.toBase58()}) is already open at ${Number(dup.priceLamports) / LAMPORTS_PER_SOL} SOL ` +
        `until ${new Date(Number(dup.closeTs) * 1000).toISOString()}, which overlaps the requested window. ` +
        `Pick a different price/duration, wait for it to close, or pass --allow-duplicate`,
    );
  }
  if (dup) console.log(`  note: duplicate of campaign ${dup.id} allowed by --allow-duplicate`);

  const id = BigInt(args.id ?? (existing.reduce((m, c) => (c.id > m ? c.id : m), 0n) + 1n));
  const [campaign] = PublicKey.findProgramAddressSync([Buffer.from("campaign"), u64le(id)], programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), campaign.toBuffer()], programId);
  const collection = Keypair.generate();
  const closeIso = new Date(closeTs * 1000).toISOString().replace(".000Z", "Z");

  const before = await retry(() => connection.getBalance(payer.publicKey, "confirmed"), "getBalance");
  console.log(`plan  id=${id} price=${args.price} SOL cap=${args.cap} closes=${closeIso} (${duration}h${args.duration === "auto" ? ", auto" : ""})`);
  console.log(`      campaign=${campaign.toBase58()}`);
  console.log(`      vault=${vault.toBase58()} collection=${collection.publicKey.toBase58()}`);
  console.log(`      wallet=${payer.publicKey.toBase58()} balance=${(before / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  if (args.dryRun) {
    const dupNote = dup ? " (would refuse without --allow-duplicate)" : "";
    console.log(`dry-run: nothing sent${dupNote}`);
    log(`DRYRUN id=${id} price=${args.price} cap=${args.cap} close=${closeIso} campaign=${campaign.toBase58()}${dup ? ` duplicate_of=${dup.id}` : ""}`);
    return 0;
  }

  let signature;
  try {
    signature = await program.methods
      .createCampaign(new anchor.BN(id.toString()), new anchor.BN(priceLamports.toString()), new anchor.BN(String(closeTs)), args.cap)
      .accountsPartial({
        admin: payer.publicKey,
        config,
        campaign,
        vault,
        collection: collection.publicKey,
        coreProgram: CORE_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([collection])
      .rpc();
    await retry(() => connection.confirmTransaction(signature, "confirmed"), "confirmTransaction");
  } catch (e) {
    // Say exactly where it stopped: campaign account and/or Core collection on chain or not.
    const [cInfo, colInfo] = await Promise.all([
      connection.getAccountInfo(campaign, "confirmed").catch(() => null),
      connection.getAccountInfo(collection.publicKey, "confirmed").catch(() => null),
    ]);
    const state = [
      `campaign account ${campaign.toBase58()}: ${cInfo ? "EXISTS" : "absent"}`,
      `Core collection ${collection.publicKey.toBase58()}: ${colInfo ? "EXISTS" : "absent"}`,
      signature ? `tx ${signature}` : "no tx signature was returned",
    ].join("; ");
    const failed = `FAILED id=${id} reason=${String(e).split("\n")[0]} state=${state}`;
    console.error(`create_campaign ${failed}`);
    log(failed);
    process.exitCode = 1;
    return 1;
  }

  const after = await retry(() => connection.getBalance(payer.publicKey, "confirmed"), "getBalance");
  const cost = before - after;
  const receipt = {
    id: id.toString(),
    campaign: campaign.toBase58(),
    vault: vault.toBase58(),
    collection: collection.publicKey.toBase58(),
    priceSol: args.price,
    cap: args.cap,
    closeTs,
    closeIso,
    signature,
    explorer: `${EXPLORER}/tx/${signature}?cluster=devnet`,
    costLamports: String(cost),
    costSol: (cost / LAMPORTS_PER_SOL).toFixed(9),
  };

  console.log(`\nopened campaign ${receipt.id}`);
  console.log(`  campaign   ${receipt.campaign}`);
  console.log(`  close (UTC) ${receipt.closeIso}`);
  console.log(`  tx         ${receipt.signature}`);
  console.log(`  explorer   ${receipt.explorer}`);
  console.log(`  cost       ${receipt.costSol} SOL (${receipt.costLamports} lamports: campaign + vault + Core collection + fee)`);
  console.log(`  app        add ${receipt.id} to CAMPAIGN_IDS in app/src/program.ts so players can see it`);

  log(`OPENED ${JSON.stringify(receipt)}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`open-game: ${e.message ?? e}`);
    log(`REFUSED ${String(e.message ?? e).split("\n")[0]}`);
    process.exit(2);
  });
}
