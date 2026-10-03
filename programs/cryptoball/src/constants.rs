//! Shared constants. Economics values are DEVNET PLACEHOLDERS (captain default, 2026-10-02),
//! clamped at set-time by the hard caps below. See docs/requirements.md section D.

use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const CAMPAIGN_SEED: &[u8] = b"campaign";
pub const TICKET_SEED: &[u8] = b"ticket";
pub const VAULT_SEED: &[u8] = b"vault";
/// Devnet faucet. Distinct seeds: the faucet vault is a plain system PDA with no campaign in its
/// derivation, so no `vault_pay`/ticket path can ever be routed at it.
pub const FAUCET_SEED: &[u8] = b"faucet-v2";
pub const FAUCET_VAULT_SEED: &[u8] = b"faucet-vault";
pub const CLAIM_SEED: &[u8] = b"claim";

/// Pick format: 5 distinct numbers in 1..=69 plus one Cryptoball bonus ball in 1..=26.
pub const PICK_COUNT: usize = 5;
pub const MAX_NUMBER: u8 = 69;
pub const MAX_BONUS: u8 = 26;

/// Devnet placeholder defaults (the admin passes real values, clamped by the caps).
pub const DEFAULT_TICKET_PRICE_LAMPORTS: u64 = 100_000_000; // 0.1 SOL
pub const DEFAULT_FEE_BPS: u16 = 1_000; // 10 %
pub const DEFAULT_MAX_TICKETS: u32 = 1_000;

/// Hard caps enforced on every set.
pub const MAX_FEE_BPS: u16 = 2_000;
pub const MAX_TICKETS: u32 = 10_000;
/// Floor: a system-owned vault/wallet must hold >= 890_880 lamports (rent-exempt, 0 data) after any
/// credit, so even the smallest prize (price * (1 - MAX_FEE_BPS/10_000)) must clear it: 2_000_000 * 0.8 = 1.6M.
pub const MIN_TICKET_PRICE_LAMPORTS: u64 = 2_000_000;
/// Seconds after commit_draw before anyone may cancel an unrevealed draw (placeholder).
pub const REVEAL_TIMEOUT_SECS: i64 = 3_600;

// ---- Devnet SOL faucet (NOTHING here may ship on a real-money deployment; see docs/design.md 11).
// All three ceilings are program constants, never instruction arguments: the client cannot raise them.
/// The captain can retune them here and redeploy; there is no admin setter to get out of sync.
/// Largest single drip (the captain's "0.11 per claim").
pub const MAX_CLAIM_LAMPORTS: u64 = 110_000_000; // 0.11 SOL
/// Lifetime ceiling per wallet: three max claims (firstmate spec, "0.33 = three tickets' worth").
pub const MAX_CLAIM_LIFETIME_LAMPORTS: u64 = 330_000_000; // 0.33 SOL
/// Ceiling one `initialize_faucet` call may budget. The admin may raise a live ledger's ceiling past
/// this with `update_faucet_pool` - that is the documented refill - but cannot start above it.
pub const INITIAL_POOL_LAMPORTS: u64 = 1_000_000_000; // 1.0 SOL

/// Static metadata uri for every ticket NFT (DEVNET PLACEHOLDER; never trusted by the program).
pub const TICKET_URI: &str = "https://cryptoball.invalid/ticket.json";

/// Pinned external program ids (never read from instruction accounts). Source: docs/design.md section 10.
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
/// Switchboard On-Demand, devnet. Mainnet is `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv` (out of MVP scope).
pub const SWITCHBOARD_DEVNET_ID: Pubkey = pubkey!("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");

#[cfg(test)]
mod tests {
    use super::*;

    /// Pinned ids must equal the ids shipped in the pinned crates (fails if a crate bump changes them).
    #[test]
    fn pinned_ids_match_crates() {
        assert_eq!(MPL_CORE_ID.to_bytes(), mpl_core::ID.to_bytes());
        assert_eq!(
            SWITCHBOARD_DEVNET_ID.to_bytes(),
            switchboard_on_demand::ON_DEMAND_DEVNET_PID.to_bytes()
        );
    }
}
