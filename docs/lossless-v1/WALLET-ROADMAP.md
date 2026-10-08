# Wallet roadmap — devnet, then mainnet

Two paths. Pick one before writing the import screen. Do not mix them in one key store.

The current signer is `app/src/passkeyWallet.ts`. It is a Wallet Standard wallet. The ed25519 key is derived on the device from a WebAuthn PRF output through mera. It signs `buy_ticket`, `refund_ticket`, and the faucet. It is not a mainnet wallet yet.

## Path A — keep the passkey wallet

Use this if the key must never leave the device, and you accept the audit work.

1. Devnet preview. A signature request shows the program, the accounts, the amount, and the fee. The page simulates first. A failed simulation is not submitted.
2. Devnet portfolio. Show SOL, USDC, token accounts, Metaplex Core tickets, and history from `getSignaturesForAddress`.
3. Devnet transfer. A separate screen sends USDC. It uses the same preview and simulation gate.
4. Import. This is a second signer, not a passkey mode. The player pastes a base58 secret key. The page shows the address before it saves the key. The secret is not logged, posted, or stored in clear text. Phantom stays a connected Wallet Standard wallet, not an import.
5. Recovery line on the first screen. A synced passkey moves with the provider. An imported key has a copy only if the player kept one. One device and no copy is a loss.
6. Companion audit, then mainnet. See the audit section.

## Path B — Privy, or Dynamic

Use this if you want login, recovery, and export from a provider that already ships them. Privy supports Solana embedded wallets and exports a base58 key through `exportWallet` in `@privy-io/react-auth/solana`. Dynamic imports and exports a base58 Solana key. The export modal runs in the provider iframe, not in your page.

1. Create a Privy app. Enable Solana embedded wallets. Restrict the allowed origins to the Cryptoball domain.
2. Replace the passkey button with Privy login. Email, passkey, or social login creates the embedded wallet. The address is shown before the first deposit.
3. Keep Phantom as an external Wallet Standard connection. Do not import a Phantom key into Privy.
4. Export is the player's copy. Call `exportWallet` for the Solana address. The player can load that base58 key into Phantom. Say that a copied key is a second copy, and a leak of that copy spends the funds.
5. Import, if you need an existing key, uses the provider import. Do not also write a local import. Two import paths means two places a secret can land.
6. Portfolio, history, and USDC transfer stay in your app. The provider signs. Your page still simulates and shows the preview before the provider prompt.
7. Companion audit covers your preview, simulation, and transaction builder. It does not replace Privy's own review. Read their key-export terms before mainnet.

Dynamic is the same shape if you prefer it. One provider only.

## Audit

The companion runs the review. It is not the auditor.

- Catalog: `knowledge/security/` FYEO findings, about 170 by class.
- Playbook and readiness checklist: `knowledge/security/`.
- Skills: `/safe-solana-builder`, `/solana-production-readiness`.
- Workflow: the audit loop, with the security agent.
- Turbin3: Anchor, LiteSVM, and Token Extensions for the tests. No wallet-audit firm in that list.

Hunt these classes on the wallet code: signer confusion, a transaction swapped after the preview, a secret in a log or in `localStorage`, a token account whose owner is not checked, and a transfer that skips simulation.

Write the findings in the repo. An open signer or secret-handling finding blocks mainnet.

## Mainnet gate

All of these must exist on mainnet RPC before a player deposits real USDC.

- A passkey or Privy wallet address, shown before deposit.
- An import or an export, and a sentence that says a copied key can spend the funds.
- One USDC transfer that was simulated, previewed, and signed.
- One simulated reject that was not submitted.
- A ticket visible in the asset list.
- A history row that matches Explorer.
- A findings file with no open signer or secret-handling item.

Until that file exists, the wallet is a devnet signer.
