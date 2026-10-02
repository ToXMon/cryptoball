//! THE swappable winner-determination unit (design.md section 7).
//!
//! Today (raffle, captain default): one VRF-selected ticket wins the pool minus fee.
//! Upgrade (documented, not built): faithful jackpot-only (drawn 5+bonus must match a ticket's picks;
//! needs a tally pass, a no-winner path and per-winner payouts). Swapping means replacing this module
//! and `settle_draw`'s payout step only; every other instruction is unaffected.

use crate::constants::{MAX_BONUS, MAX_NUMBER, PICK_COUNT};
use crate::errors::CryptoballError;
use anchor_lang::prelude::*;
use solana_keccak_hasher::hashv;

/// Derive the winning ticket index from the revealed 32-byte Switchboard value (R-46).
/// `u128::from_le_bytes(value[0..16]) % ticket_count`; for a uniform 128-bit value and N <= 2^32 the
/// modulo bias is below N/2^128 (~1e-29), so no rejection loop is needed.
// ponytail: raffle picks one ticket; the 5-of-69 + bonus draw is the jackpot-only upgrade (design.md section 7).
pub fn winning_index(revealed: &[u8; 32], ticket_count: u32) -> Result<u32> {
    require!(ticket_count > 0, CryptoballError::NoTickets);
    let mut head = [0u8; 16];
    head.copy_from_slice(&revealed[..16]);
    // The remainder is < ticket_count <= u32::MAX, so the cast cannot truncate.
    Ok((u128::from_le_bytes(head) % ticket_count as u128) as u32)
}

/// Deterministic byte stream: keccak256(domain || seed || counter), 32 bytes per block.
struct Stream<'a> {
    seed: &'a [u8; 32],
    counter: u32,
    block: [u8; 32],
    pos: usize,
}

impl<'a> Stream<'a> {
    fn new(seed: &'a [u8; 32]) -> Self {
        Self { seed, counter: 0, block: [0; 32], pos: 32 }
    }
    fn next_byte(&mut self) -> u8 {
        if self.pos == 32 {
            self.block = hashv(&[&b"cryptoball-numbers"[..], &self.seed[..], &self.counter.to_le_bytes()[..]]).to_bytes();
            self.counter = self.counter.wrapping_add(1);
            self.pos = 0;
        }
        self.pos += 1;
        self.block[self.pos - 1]
    }
    /// Uniform in 0..n (n in 1..=255) by rejection sampling: accept b < 256 - 256 % n, return b % n.
    // ponytail: bounded at 64 tries (reject odds <= 0.19 each, so < 1e-46 to fall through); the
    // fallback is a biased modulo that keeps settle live. Swap to a wider stream if n ever grows.
    fn below(&mut self, n: u8) -> u8 {
        let limit = 256 - 256 % n as u16;
        let mut b = self.next_byte();
        for _ in 0..64 {
            if (b as u16) < limit {
                break;
            }
            b = self.next_byte();
        }
        b % n
    }
}

/// Drawn lottery numbers (R-45 "known vector"): 5 distinct in 1..=MAX_NUMBER (ascending) and a bonus in
/// 1..=MAX_BONUS. Partial Fisher-Yates over 1..=69 with unbiased range reduction; no loops over tickets.
/// Display only under the raffle rule; the jackpot-only upgrade would pay on these.
pub fn winning_numbers(revealed: &[u8; 32]) -> ([u8; PICK_COUNT], u8) {
    let mut s = Stream::new(revealed);
    let mut pool = [0u8; MAX_NUMBER as usize];
    for (i, p) in pool.iter_mut().enumerate() {
        *p = i as u8 + 1;
    }
    let mut out = [0u8; PICK_COUNT];
    for i in 0..PICK_COUNT {
        let j = i + s.below(MAX_NUMBER - i as u8) as usize;
        pool.swap(i, j);
        out[i] = pool[i];
    }
    out.sort_unstable();
    (out, s.below(MAX_BONUS) + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vector() {
        let mut v = [0u8; 32];
        v[0] = 100; // u128 = 100
        v[31] = 255; // ignored tail
        assert_eq!(winning_index(&v, 7).unwrap(), 2);
        assert_eq!(winning_index(&v, 1).unwrap(), 0);
        assert_eq!(winning_index(&[0xff; 32], u32::MAX).unwrap(), (u128::MAX % u32::MAX as u128) as u32);
    }

    #[test]
    fn zero_tickets_errors() {
        assert!(winning_index(&[0; 32], 0).is_err());
    }

    #[test]
    fn roughly_uniform() {
        // Cheap LCG-driven distribution check over 10 buckets.
        let mut buckets = [0u32; 10];
        let mut x: u128 = 0x9e37_79b9_7f4a_7c15;
        for _ in 0..10_000 {
            x = x.wrapping_mul(0x2545_f491_4f6c_dd1d_9e37_79b9_7f4a_7c15).wrapping_add(1);
            let mut v = [0u8; 32];
            v[..16].copy_from_slice(&x.to_le_bytes());
            buckets[winning_index(&v, 10).unwrap() as usize] += 1;
        }
        assert!(buckets.iter().all(|&b| (800..1200).contains(&b)), "{buckets:?}");
    }

    #[test]
    fn numbers_valid_deterministic_and_spread() {
        let mut seen = [0u32; 70];
        let mut bonus_seen = [0u32; 27];
        for k in 0..2_000u32 {
            let mut v = [0u8; 32];
            v[..4].copy_from_slice(&k.to_le_bytes());
            let (n, b) = winning_numbers(&v);
            assert_eq!((n, b), winning_numbers(&v));
            assert!(n.windows(2).all(|w| w[0] < w[1]), "{n:?}");
            assert!(n[0] >= 1 && n[4] <= 69 && (1..=26).contains(&b));
            n.iter().for_each(|&x| seen[x as usize] += 1);
            bonus_seen[b as usize] += 1;
        }
        // expected 2000*5/69 ~ 145 per number, 2000/26 ~ 77 per bonus
        assert!(seen[1..].iter().all(|&c| (80..220).contains(&c)), "{seen:?}");
        assert!(bonus_seen[1..].iter().all(|&c| (35..130).contains(&c)), "{bonus_seen:?}");
    }
}
