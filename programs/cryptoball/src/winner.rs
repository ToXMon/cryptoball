//! THE swappable winner-determination unit (design.md section 7).
//!
//! Today (raffle, captain default): one VRF-selected ticket wins the pool minus fee.
//! Upgrade (documented, not built): faithful jackpot-only (drawn 5+bonus must match a ticket's picks;
//! needs a tally pass, a no-winner path and per-winner payouts). Swapping means replacing this module
//! and `settle_draw`'s payout step only; every other instruction is unaffected.

use crate::errors::CryptoballError;
use anchor_lang::prelude::*;

/// Derive the winning ticket index from the revealed 32-byte Switchboard value.
/// Planned body (R-46): `u128::from_le_bytes(value[0..16]) % ticket_count`
/// (modulo bias <= N/2^128, negligible). Phase 3 implements it with a known-vector test.
pub fn winning_index(_revealed: &[u8; 32], _ticket_count: u32) -> Result<u32> {
    err!(CryptoballError::NotImplemented)
}
