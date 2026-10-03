#!/usr/bin/env node
// Ops: read and hand over the on-chain admin key.
//
//   node ops/admin.mjs status              # who is admin, who is pending
//   node ops/admin.mjs nominate <pubkey>   # signed by the CURRENT admin
//   node ops/admin.mjs accept              # signed by the NOMINEE (the pending admin)
//
// Prints the resulting admin state and the tx signature with an Explorer link.
// Never prints a secret key - only public keys. Never mainnet.
import anchor from "@coral-xyz/anchor";
import web3 from "@solana/web3.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadIdl, retry, RPC, WALLET, PROGRAM_ID } from "./open-game.mjs";

const { Keypair, PublicKey, Connection } = web3;
const EXPLORER = "https://explorer.solana.com";
const CONFIG_SEED = Buffer.from("config");

const isPubkey = (s) => {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
};

export function parseArgs(argv) {
  const out = { cmd: undefined, nominee: undefined, wallet: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--wallet") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--wallet needs a path");
      out.wallet = v;
    } else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else if (out.cmd === undefined) out.cmd = a;
    else if (out.cmd === "nominate" && out.nominee === undefined) out.nominee = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!out.help) {
    if (!out.cmd) throw new Error("say what to do: status | nominate <pubkey> | accept");
    if (!["status", "nominate", "accept"].includes(out.cmd)) throw new Error(`unknown command: ${out.cmd} (status | nominate <pubkey> | accept)`);
    if (out.cmd === "nominate") {
      if (!out.nominee) throw new Error("nominate needs the nominee's pubkey: node ops/admin.mjs nominate <pubkey>");
      if (!isPubkey(out.nominee)) throw new Error(`not a pubkey: ${out.nominee}`);
    } else if (out.nominee !== undefined) {
      throw new Error(`${out.cmd} takes no pubkey argument`);
    }
  }
  return out;
}

// Say who *should* sign before anything is signed, not a chain error afterwards.
export function guardNominate(signer, config) {
  const admin = new PublicKey(config.admin);
  if (!admin.equals(signer)) {
    throw new Error(`refusing: nominate_admin must be signed by the current admin ${admin.toBase58()}, but the signer is ${signer.toBase58()}`);
  }
  return admin;
}

export function guardAccept(signer, config) {
  const pending = config.pendingAdmin ? new PublicKey(config.pendingAdmin) : null;
  if (!pending) throw new Error(`refusing: no pending admin on chain, so nothing to accept - run 'nominate <pubkey>' as the current admin first`);
  if (!pending.equals(signer)) {
    throw new Error(`refusing: accept_admin must be signed by the nominee ${pending.toBase58()}, but the signer is ${signer.toBase58()}`);
  }
  return pending;
}

const show = (c) => `admin=${new PublicKey(c.admin).toBase58()} pending=${c.pendingAdmin ? new PublicKey(c.pendingAdmin).toBase58() : "none"}`;

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(`admin <status|nominate <pubkey>|accept> [--wallet <path>]

  status              print the current admin and pending admin (no signing)
  nominate <pubkey>   nominate a new admin; signed by the CURRENT admin
  accept              take the nomination; signed by the NOMINEE

signer: ${args.wallet ?? WALLET}   rpc: ${RPC}   program: ${PROGRAM_ID}`);
    return 0;
  }

  const idl = loadIdl();
  const programId = new PublicKey(PROGRAM_ID);
  const connection = new Connection(RPC, "confirmed");
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);

  // The signer is only loaded for the two steps that sign; its secret never leaves this file.
  // status is read-only, so it works on a host that holds no wallet at all.
  const signing = args.cmd !== "status";
  const payer = signing
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(args.wallet ?? WALLET, "utf8"))))
    : null;
  const readOnlyWallet = { publicKey: PublicKey.default, signTransaction: async () => { throw new Error("status never signs"); } };
  anchor.setProvider(new anchor.AnchorProvider(connection, payer ? new anchor.Wallet(payer) : readOnlyWallet, { commitment: "confirmed" }));
  const program = new anchor.Program(idl, anchor.provider);

  const readConfig = async () => {
    const raw = await retry(() => connection.getAccountInfo(config, "confirmed"), "getAccountInfo");
    if (!raw) throw new Error(`Config ${config.toBase58()} does not exist yet: the program is not initialized on ${RPC}`);
    return program.coder.accounts.decode("config", raw.data);
  };

  if (args.cmd === "status") {
    console.log(`config ${config.toBase58()} on ${RPC}`);
    console.log(`  ${show(await readConfig())}`);
    return 0;
  }

  const before = await readConfig();
  console.log(`before  ${show(before)}`);
  console.log(`signer  ${payer.publicKey.toBase58()}  ${args.cmd === "nominate" ? "(must be the admin)" : "(must be the nominee)"}`);

  let signature;
  try {
    if (args.cmd === "nominate") {
      guardNominate(payer.publicKey, before);
      const nominee = new PublicKey(args.nominee);
      console.log(`plan    nominate ${nominee.toBase58()} (it must then run 'node ops/admin.mjs accept' with that wallet)`);
      signature = await program.methods.nominateAdmin(nominee).accountsPartial({ admin: payer.publicKey, config }).rpc();
    } else {
      guardAccept(payer.publicKey, before);
      signature = await program.methods.acceptAdmin().accountsPartial({ nominee: payer.publicKey, config }).rpc();
    }
    await retry(() => connection.confirmTransaction(signature, "confirmed"), "confirmTransaction");
  } catch (e) {
    console.error(`admin ${args.cmd}: ${String(e.message ?? e).split("\n")[0]}`);
    return 1;
  }

  const after = await readConfig();
  console.log(`after   ${show(after)}`);
  console.log(`tx      ${signature}`);
  console.log(`explorer ${EXPLORER}/tx/${signature}?cluster=devnet`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`admin: ${e.message ?? e}`);
      process.exit(2);
    });
}