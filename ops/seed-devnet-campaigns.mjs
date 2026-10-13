#!/usr/bin/env node
// Seed the two already-deployed devnet products from one fixed manifest. Default is read-only;
// pass --send only after reviewing the exact campaign addresses, signer, and deadlines.
import anchor from "@coral-xyz/anchor";
import web3 from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RPC, retry, PROGRAM_ID as SOL_PROGRAM_ID, loadIdl } from "./open-game.mjs";

const { AnchorProvider, BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = web3;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_MANIFEST = path.join(ROOT, "ops", "devnet-campaign-seed.json");
const RECEIPTS = path.join(ROOT, "ops", "log", "devnet-campaigns.jsonl");
const EXPLORER = "https://explorer.solana.com";
const LOSSLESS_ID = "EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF";
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const pda = (program, ...seeds) => PublicKey.findProgramAddressSync(seeds, program)[0];
const solCampaign = (program, id) => pda(program, Buffer.from("campaign"), u64le(id));
const losslessCampaign = (program, id) => pda(program, Buffer.from("lossless-campaign"), u64le(id));
const link = (kind, address) => `${EXPLORER}/${kind}/${address}?cluster=devnet`;

export function parseArgs(argv) {
  const out = { send: false, manifest: DEFAULT_MANIFEST, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--send") out.send = true;
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
    else if (argv[i] === "--manifest") {
      if (!argv[i + 1]) throw new Error("--manifest needs a path");
      out.manifest = path.resolve(argv[++i]);
    } else throw new Error(`unexpected argument: ${argv[i]}`);
  }
  return out;
}

export function validateManifest(m) {
  if (m.cluster !== "devnet") throw new Error("seed manifest must target devnet");
  if (m.sol?.programId !== SOL_PROGRAM_ID || m.lossless?.programId !== LOSSLESS_ID) throw new Error("manifest program IDs do not match the deployed programs");
  if (m.lossless?.mint !== USDC_MINT) throw new Error("manifest must use the pinned devnet USDC mint");
  for (const [label, c] of [["SOL", m.sol], ["USDC", m.lossless]]) {
    if (!/^\d+$/.test(String(c.id)) || BigInt(c.id) <= 0n) throw new Error(`${label} campaign id must be positive`);
    if (!Number.isFinite(Date.parse(c.closeAt)) || !c.closeAt.endsWith("Z")) throw new Error(`${label} closeAt must be an ISO UTC timestamp`);
  }
  if (BigInt(m.sol.priceLamports) < 2_000_000n || !Number.isInteger(m.sol.feeBps) || m.sol.feeBps < 0 || m.sol.feeBps > 2_000 || !Number.isInteger(m.sol.maxTickets) || m.sol.maxTickets < 1 || m.sol.maxTickets > 10_000) throw new Error("SOL campaign parameters are outside the raffle program limits");
  if (BigInt(m.lossless.principalCap) <= 0n || !Number.isInteger(m.lossless.maxPositions) || m.lossless.maxPositions < 1 || m.lossless.maxPositions > 24 || !Number.isInteger(m.lossless.feeBps) || m.lossless.feeBps < 0 || m.lossless.feeBps > 250) throw new Error("USDC campaign parameters are outside the Lossless V1 limits");
  return m;
}

const exact = (actual, expected) => String(actual) === String(expected);
export function existingCampaignAction(existing, expected) {
  if (!existing) return "create";
  const mismatches = Object.entries(expected).filter(([key, value]) => !exact(existing[key], value)).map(([key]) => key);
  if (mismatches.length) throw new Error(`campaign ID already exists with different ${mismatches.join(", ")}; refusing to overwrite or duplicate it`);
  return "exists";
}
export function existingConfigAction(existing, expected) {
  if (!existing) return "initialize";
  const mismatches = Object.entries(expected).filter(([key, value]) => !exact(existing[key], value)).map(([key]) => key);
  if (mismatches.length) throw new Error(`Lossless config differs in ${mismatches.join(", ")}; refusing to mutate deployment identity`);
  return "exists";
}

function ata(owner, mint) { return pda(ATA_ID, owner.toBuffer(), TOKEN_ID.toBuffer(), mint.toBuffer()); }
function createAtaIx(payer, owner, mint) {
  const address = ata(owner, mint);
  return new TransactionInstruction({
    programId: ATA_ID,
    keys: [payer, address, owner, mint, SystemProgram.programId, TOKEN_ID].map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: i < 2 })),
    data: Buffer.from([1]), // Associated Token Program CreateIdempotent.
  });
}
function assertTokenAccount(info, mint, owner) {
  if (!info || !info.owner.equals(TOKEN_ID) || info.data.length !== 165 || info.data[108] !== 1 || !new PublicKey(info.data.subarray(0, 32)).equals(mint) || !new PublicKey(info.data.subarray(32, 64)).equals(owner)) {
    throw new Error(`token account must be initialized, owned by ${owner.toBase58()}, and use mint ${mint.toBase58()}`);
  }
}
function assertUsdcMint(info, mint) {
  if (!info || !info.owner.equals(TOKEN_ID) || info.data.length !== 82 || info.data[44] !== 6 || info.data[45] !== 1) throw new Error(`pinned test-USDC mint ${mint.toBase58()} is missing or is not an initialized six-decimal classic SPL mint`);
}

async function record(receipt) {
  fs.mkdirSync(path.dirname(RECEIPTS), { recursive: true });
  fs.appendFileSync(RECEIPTS, `${JSON.stringify(receipt)}\n`);
}

async function send(connection, payer, ixs, extra = []) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 700_000 }), ...ixs);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const signature = await connection.sendTransaction(tx, [payer, ...extra], { preflightCommitment: "confirmed" });
  await retry(() => connection.confirmTransaction(signature, "confirmed"), "confirmTransaction");
  return signature;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("seed-devnet-campaigns [--manifest path] [--send]\nDefault prints an account-checked plan only. --send signs devnet create/init instructions with ANCHOR_WALLET or ~/.tape/cryptoball-deploy.json.");
    return 0;
  }
  const manifest = validateManifest(JSON.parse(fs.readFileSync(args.manifest, "utf8")));
  const endpoint = new URL(RPC);
  if (!/devnet/i.test(endpoint.hostname)) throw new Error(`refusing non-devnet RPC: ${endpoint.hostname}`);
  const connection = new Connection(RPC, "confirmed");
  const solId = new PublicKey(SOL_PROGRAM_ID);
  const losslessId = new PublicKey(LOSSLESS_ID);
  const solIdl = loadIdl();
  const losslessIdl = JSON.parse(fs.readFileSync(path.join(ROOT, "ops", "lossless_v1.idl.json"), "utf8"));
  if (losslessIdl.address !== LOSSLESS_ID) throw new Error("committed lossless IDL has a different program address");
  const solIdNum = BigInt(manifest.sol.id), losslessIdNum = BigInt(manifest.lossless.id);
  const solCampaignKey = solCampaign(solId, solIdNum), losslessCampaignKey = losslessCampaign(losslessId, losslessIdNum);
  const solClose = Math.floor(Date.parse(manifest.sol.closeAt) / 1000), losslessClose = Math.floor(Date.parse(manifest.lossless.closeAt) / 1000);
  const solConfigKey = pda(solId, Buffer.from("config"));
  const [solInfo, losslessInfo, solConfigInfo, configInfo] = await Promise.all([
    retry(() => connection.getAccountInfo(solCampaignKey, "confirmed"), "SOL campaign"),
    retry(() => connection.getAccountInfo(losslessCampaignKey, "confirmed"), "USDC campaign"),
    retry(() => connection.getAccountInfo(solConfigKey, "confirmed"), "SOL config"),
    retry(() => connection.getAccountInfo(pda(losslessId, Buffer.from("lossless-config")), "confirmed"), "Lossless config"),
  ]);
  const solProgram = new anchor.Program(solIdl, new AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), { commitment: "confirmed" }));
  const losslessProgram = new anchor.Program(losslessIdl, new AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), { commitment: "confirmed" }));
  const solConfig = solConfigInfo ? solProgram.coder.accounts.decode("config", solConfigInfo.data) : undefined;
  const solExisting = solInfo ? solProgram.coder.accounts.decode("campaign", solInfo.data) : undefined;
  const losslessExisting = losslessInfo ? losslessProgram.coder.accounts.decode("campaign", losslessInfo.data) : undefined;
  const solAction = existingCampaignAction(solExisting, { id: solIdNum, priceLamports: manifest.sol.priceLamports, feeBps: manifest.sol.feeBps, closeTs: solClose, maxTickets: manifest.sol.maxTickets });
  const losslessAction = existingCampaignAction(losslessExisting, {
    id: losslessIdNum, mint: new PublicKey(USDC_MINT),
    principalVault: pda(losslessId, Buffer.from("principal-vault"), losslessCampaignKey.toBuffer()),
    prizeVault: pda(losslessId, Buffer.from("prize-vault"), losslessCampaignKey.toBuffer()),
    lossVault: pda(losslessId, Buffer.from("mock-loss-vault"), losslessCampaignKey.toBuffer()),
    closeTs: losslessClose, principalCap: manifest.lossless.principalCap, maxPositions: manifest.lossless.maxPositions,
  });
  const mint = new PublicKey(USDC_MINT);
  const configKey = pda(losslessId, Buffer.from("lossless-config"));
  const signerPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME || "", ".tape", "cryptoball-deploy.json");
  let payer;
  if (args.send) payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(signerPath, "utf8"))));
  const config = configInfo ? losslessProgram.coder.accounts.decode("config", configInfo.data) : undefined;
  const configAdmin = payer?.publicKey ?? config?.admin;
  const configAction = existingConfigAction(config, config ? {
    mint, admin: configAdmin, treasury: configAdmin, treasuryToken: ata(configAdmin, mint), feeBps: manifest.lossless.feeBps,
  } : {});
  if (!config && losslessAction === "exists") throw new Error("Lossless campaign exists without its singleton config; refusing to continue");
  const solCloseFuture = solClose > Math.floor(Date.now() / 1000);
  const losslessCloseFuture = losslessClose > Math.floor(Date.now() / 1000);
  console.log(`network=devnet rpc=${endpoint.hostname}`);
  console.log(`SOL ${solAction} id=${solIdNum} campaign=${solCampaignKey.toBase58()} authority=${solConfig?.admin.toBase58() ?? "not initialized"} close=${manifest.sol.closeAt} price=${manifest.sol.priceLamports} lamports fee=${manifest.sol.feeBps} bps cap=${manifest.sol.maxTickets}`);
  console.log(`USDC config=${configAction} campaign=${losslessAction} id=${losslessIdNum} campaign=${losslessCampaignKey.toBase58()} mint=${USDC_MINT} close=${manifest.lossless.closeAt} cap=${manifest.lossless.principalCap} base units`);
  if (!args.send) { console.log("plan only: nothing signed; pass --send to execute after reviewing these exact values"); return 0; }
  if (!solCloseFuture && solAction === "create" || !losslessCloseFuture && losslessAction === "create") throw new Error("a campaign deadline has passed; update the fixed manifest before creating it");
  if (!solConfig || !solConfig.admin.equals(payer.publicKey)) throw new Error(`SOL raffle admin is ${solConfig?.admin.toBase58() ?? "not initialized"}, not the signer; refusing`);
  if (!exact(solConfig.feeBps, manifest.sol.feeBps)) throw new Error(`SOL raffle fee is ${solConfig.feeBps} bps, not manifest fee ${manifest.sol.feeBps}; refusing`);
  if (config && !config.admin.equals(payer.publicKey)) throw new Error(`configured lossless admin is ${config.admin.toBase58()}, not the signer; refusing`);
  if (config?.paused) throw new Error("Lossless config is paused; refusing to seed a non-playable campaign");
  if (!config && losslessAction === "create") {
    const mintInfo = await retry(() => connection.getAccountInfo(mint, "confirmed"), "USDC mint");
    assertUsdcMint(mintInfo, mint);
    const programData = pda(LOADER_ID, losslessId.toBuffer());
    const programDataInfo = await retry(() => connection.getAccountInfo(programData, "confirmed"), "Lossless ProgramData");
    if (!programDataInfo || programDataInfo.data.readUInt32LE(0) !== 3 || programDataInfo.data[12] !== 1 || !new PublicKey(programDataInfo.data.subarray(13, 45)).equals(payer.publicKey)) throw new Error("signer is not the Lossless V1 upgrade authority; config cannot be initialized by this wallet");
    const treasuryToken = ata(payer.publicKey, mint);
    const treasuryInfo = await connection.getAccountInfo(treasuryToken, "confirmed");
    if (treasuryInfo) assertTokenAccount(treasuryInfo, mint, payer.publicKey);
    const initIx = await losslessProgram.methods.initialize(payer.publicKey, manifest.lossless.feeBps).accountsPartial({
      upgradeAuthority: payer.publicKey, config: configKey, program: losslessId, programData,
      mint, treasuryToken, tokenProgram: TOKEN_ID, systemProgram: SystemProgram.programId,
    }).instruction();
    const signature = await send(connection, payer, [...(treasuryInfo ? [] : [createAtaIx(payer.publicKey, payer.publicKey, mint)]), initIx]);
    await record({ product: "lossless-v1-config", admin: payer.publicKey.toBase58(), treasury: payer.publicKey.toBase58(), mint: USDC_MINT, feeBps: manifest.lossless.feeBps, signature, explorer: link("tx", signature) });
    console.log(`initialized lossless config ${link("tx", signature)}`);
  }
  if (solAction === "create") {
    const collection = Keypair.generate();
    const ix = await solProgram.methods.createCampaign(new BN(solIdNum.toString()), new BN(manifest.sol.priceLamports), new BN(solClose), manifest.sol.maxTickets).accountsPartial({
      admin: payer.publicKey, config: pda(solId, Buffer.from("config")), campaign: solCampaignKey,
      vault: pda(solId, Buffer.from("vault"), solCampaignKey.toBuffer()), collection: collection.publicKey,
      coreProgram: new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"), systemProgram: SystemProgram.programId,
    }).instruction();
    const signature = await send(connection, payer, [ix], [collection]);
    const receipt = { product: "sol-raffle", id: String(solIdNum), campaign: solCampaignKey.toBase58(), campaignUrl: link("address", solCampaignKey.toBase58()), program: SOL_PROGRAM_ID, authority: payer.publicKey.toBase58(), priceLamports: manifest.sol.priceLamports, maxTickets: manifest.sol.maxTickets, closeAt: manifest.sol.closeAt, signature, explorer: link("tx", signature) };
    await record(receipt); console.log(`created SOL raffle ${receipt.campaignUrl} ${receipt.explorer}`);
  } else console.log(`SOL campaign already matches manifest: ${link("address", solCampaignKey.toBase58())}`);
  if (losslessAction === "create") {
    const ix = await losslessProgram.methods.createCampaign(new BN(losslessIdNum.toString()), new BN(losslessClose), new BN(manifest.lossless.principalCap), manifest.lossless.maxPositions).accountsPartial({
      admin: payer.publicKey, config: configKey, campaign: losslessCampaignKey,
      principalVault: pda(losslessId, Buffer.from("principal-vault"), losslessCampaignKey.toBuffer()),
      prizeVault: pda(losslessId, Buffer.from("prize-vault"), losslessCampaignKey.toBuffer()),
      lossVault: pda(losslessId, Buffer.from("mock-loss-vault"), losslessCampaignKey.toBuffer()),
      mint, tokenProgram: TOKEN_ID, systemProgram: SystemProgram.programId,
    }).instruction();
    const signature = await send(connection, payer, [ix]);
    const receipt = { product: "lossless-v1", id: String(losslessIdNum), campaign: losslessCampaignKey.toBase58(), campaignUrl: link("address", losslessCampaignKey.toBase58()), program: LOSSLESS_ID, authority: payer.publicKey.toBase58(), mint: USDC_MINT, principalCap: manifest.lossless.principalCap, maxPositions: manifest.lossless.maxPositions, closeAt: manifest.lossless.closeAt, feeBps: manifest.lossless.feeBps, adapter: "admin-funded mock only", signature, explorer: link("tx", signature) };
    await record(receipt); console.log(`created USDC mock campaign ${receipt.campaignUrl} ${receipt.explorer}`);
  } else console.log(`USDC campaign already matches manifest: ${link("address", losslessCampaignKey.toBase58())}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`seed-devnet-campaigns: ${e.message ?? e}`); process.exit(1); });
}
