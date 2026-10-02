/**
 * Passkey wallet: a Wallet Standard wallet whose ed25519 key is derived on the user's device from a
 * WebAuthn passkey PRF output (mera, pinned 0.2.0). It is a plain system-owned keypair, NOT a smart account.
 * The app sees it through the same `useWallet()` seam as Phantom and friends (research report 1.3, 4.1).
 *
 * Derivation, frozen on purpose (report section 6): PRF output -> BIP-39 24 words -> seed -> SLIP-0010
 * ed25519 m/44'/501'/0'/0'. Those 24 words are the recovery path if the passkey is lost or the host changes.
 *
 * WebAuthn ceremonies always need a user gesture, so `connect({ silent: true })` never prompts: it reports
 * no accounts and the app stays "locked" until the user taps the wallet (report section 4.2 step 3).
 */
import { createEd25519SigningSession, createPasskeyWithPrfOutput, getPasskeyPrfOutput, getSolanaAddress, isMeraError, type Ed25519SigningSession, type PasskeyCredentialMetadata } from "@category-labs/mera";
import { SolanaSignMessage, SolanaSignTransaction } from "@solana/wallet-standard-features";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { StandardConnect, StandardDisconnect, StandardEvents } from "@wallet-standard/features";
import { registerWallet } from "@wallet-standard/wallet";

const STORAGE_KEY = "cb-passkey";
const HARDENED = 0x80000000;
const DERIVATION_PATH = [44, 501, 0, 0] as const;
const ICON = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#0B1220"/><circle cx="16" cy="13" r="5" fill="#F8FAFC"/><path d="M5 30c2-7 6.5-10 11-10s9 3 11 10z" fill="#F8FAFC"/></svg>');

interface Stored {
  credentialId: string;
  transports?: readonly string[];
  address: string;
}
interface Account {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
  label: string;
}

let stored: Stored | undefined;
try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") ?? undefined; } catch { stored = undefined; }

let session: Ed25519SigningSession | undefined;
let current: Account[] = [];
let address: string | undefined = stored?.address;
const listeners = new Set<(p: { accounts?: readonly unknown[] }) => void>();

/** SLIP-0010 ed25519 private key for a hardened-only path (recipe `m/44'/501'/0'/0'`). */
export function deriveKey(seed64: Uint8Array, path: readonly number[] = DERIVATION_PATH): Uint8Array {
  let key = seed64.slice(0, 32);
  for (const index of path) {
    const data = new Uint8Array(37);
    data.set([0], 0);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index + HARDENED, false);
    key = hmac(sha512, data, key).slice(0, 32);
  }
  return key;
}

const toMnemonic = (entropy: Uint8Array) => entropyToMnemonic(new Uint8Array(entropy), wordlist);

/** PRF output -> signing session + recovery words. Exported so the derivation has a known-answer check. */
export function accountFromPrfOutput(prfOutput: Uint8Array) {
  const words = toMnemonic(prfOutput);
  const session = createEd25519SigningSession({ privateKey: deriveKey(mnemonicToSeedSync(words)) });
  return { words, session, address: getSolanaAddress(session.publicKey) };
}

function adopt(prf: Uint8Array, credential: PasskeyCredentialMetadata) {
  const { words, session: next, address: addr } = accountFromPrfOutput(prf);
  session?.end();
  session = next;
  address = addr;
  current = [{ address: addr, publicKey: next.publicKey, chains: ["solana:devnet"], features: [SolanaSignTransaction, SolanaSignMessage], label: "Passkey" }];
  stored = { credentialId: credential.credentialId, transports: credential.transports ? [...credential.transports] : undefined, address: addr };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  for (const l of listeners) l({ accounts: current });
  return addr;
}

const credential = () => ({ credentialId: stored!.credentialId, transports: stored!.transports });

/** The ceremony that unlocks an existing wallet, or creates one when `create` (or none is stored). User gesture required. */
export async function unlockPasskey(create = false): Promise<string> {
  if (create || !stored?.credentialId) {
    const { prfOutput, credentialId, transports } = await createPasskeyWithPrfOutput({
      rp: { id: location.hostname, name: "Cryptoball" },
      user: { name: "cryptoball-player", displayName: `Cryptoball ${new Date().toISOString().slice(0, 10)}` },
    });
    return adopt(prfOutput, { credentialId, transports });
  }
  const { prfOutput, credentialId } = await getPasskeyPrfOutput({ rpId: location.hostname, credential: credential() });
  return adopt(prfOutput, { credentialId });
}

/** The 24 recovery words. Runs a fresh ceremony; show once, then let the user write them down. */
export async function revealRecoveryPhrase(): Promise<string> {
  if (!stored?.credentialId) return "";
  const { prfOutput } = await getPasskeyPrfOutput({ rpId: location.hostname, credential: credential() });
  return toMnemonic(prfOutput);
}

export function lockPasskey() {
  session?.end();
  session = undefined;
  current = [];
  for (const l of listeners) l({ accounts: current });
}

export const passkeyAddress = () => address;

export function passkeyErrorText(e: unknown): string {
  if (!navigator.credentials) return "This browser has no passkeys. Open the site in Safari or Chrome.";
  if (isMeraError(e) && (e.code === "PRF_UNAVAILABLE" || e.code === "PASSKEY_OPERATION_FAILED")) return "This browser cannot make a passkey wallet. Open the site in Safari or Chrome, then try again.";
  return e instanceof Error ? e.message : String(e);
}

async function sign(bytes: Uint8Array): Promise<Uint8Array> {
  if (!session) throw new Error("Wallet is locked. Tap the passkey wallet to unlock.");
  return new Uint8Array(await session.signMessage(new Uint8Array(bytes)));
}

const wallet = {
  version: "1.0.0" as const,
  name: "Cryptoball Passkey",
  icon: ICON as `data:image/svg+xml;base64,${string}`,
  chains: ["solana:devnet"] as const,
  get accounts() { return current; },
  features: {
    [StandardConnect]: {
      version: "1.0.0" as const,
      connect: async (input?: { silent?: boolean }) => {
        if (session) return { accounts: current };
        if (input?.silent) return { accounts: [] };
        await unlockPasskey();
        return { accounts: current };
      },
    },
    [StandardDisconnect]: { version: "1.0.0" as const, disconnect: async () => lockPasskey() },
    [StandardEvents]: {
      version: "1.0.0" as const,
      on: (event: string, listener: (p: { accounts?: readonly unknown[] }) => void) => {
        if (event !== "change") throw new Error(`Unknown event: ${event}`);
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    [SolanaSignTransaction]: {
      version: "1.0.0" as const,
      supportedTransactionVersions: ["legacy", 0] as const,
      signTransaction: async (...inputs: readonly [{ transaction: Uint8Array }]) =>
        Promise.all(inputs.map(async ({ transaction }) => {
          if (transaction[0] === 0x80) {
            const tx = VersionedTransaction.deserialize(transaction);
            tx.signatures[0] = await sign(new Uint8Array(tx.message.serialize()));
            return { signedTransaction: tx.serialize() };
          }
          const tx = Transaction.from(transaction);
          tx.addSignature(new PublicKey(address!), (await sign(new Uint8Array(tx.serializeMessage()))) as Buffer);
          return { signedTransaction: tx.serialize() };
        })),
    },
    [SolanaSignMessage]: {
      version: "1.0.0" as const,
      signMessage: async (...inputs: readonly [{ message: Uint8Array }]) =>
        Promise.all(inputs.map(async ({ message }) => ({ signedMessage: await sign(message) }))),
    },
  },
};

/** Registered once at app start, so wallet-adapter auto-detects it like any installed wallet. */
export function registerPasskeyWallet() {
  registerWallet(wallet as never);
}
