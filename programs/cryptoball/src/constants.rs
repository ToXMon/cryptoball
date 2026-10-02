//! Shared constants. Economics values are DEVNET PLACEHOLDERS (captain default, 2026-10-02),
//! clamped at set-time by the hard caps below. See docs/requirements.md section D.

use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const CAMPAIGN_SEED: &[u8] = b"campaign";
pub const TICKET_SEED: &[u8] = b"ticket";
pub const VAULT_SEED: &[u8] = b"vault";

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
/// Ceiling so price * max_tickets can never approach u64 overflow and a typo cannot create a 1000-SOL ticket.
pub const MAX_TICKET_PRICE_LAMPORTS: u64 = 1_000_000_000; // 1 SOL, devnet placeholder
/// Seconds after commit_draw before anyone may cancel an unrevealed draw (placeholder).
pub const REVEAL_TIMEOUT_SECS: i64 = 3_600;

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
