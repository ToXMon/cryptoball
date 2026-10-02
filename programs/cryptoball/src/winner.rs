//! THE swappable winner-determination unit (design.md section 7).
//!
//! Today (raffle, captain default): one VRF-selected ticket wins the pool minus fee.
//! Upgrade (documented, not built): faithful jackpot-only (drawn 5+bonus must match a ticket's picks;
//! needs a tally pass, a no-winner path and per-winner payouts). Swapping means replacing this module
//! and `settle_draw`'s payout step only; every other instruction is unaffected.

use crate::constants::{MAX_BONUS, MAX_NUMBER, PICK_COUNT};
use crate::errors::CryptoballError;
use anchor_lang::prelude::*;

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

/// Uniform draw in 0..n from the next unused 32-bit little-endian word of the revealed value, by
/// rejection sampling: accept x < floor(2^32 / n) * n, return x % n. Rejection odds are n / 2^32 per word.
/// Fails closed (`RandomnessExhausted`, ~1e-23) rather than ever falling back to a biased modulo; the
/// campaign then times out into cancel + refund.
fn below(words: &mut impl Iterator<Item = u32>, n: u32) -> Result<u32> {
    let limit = (u32::MAX / n) * n; // largest multiple of n that fits; x in [0, limit) is unbiased
    words
        .find(|&x| x < limit)
        .map(|x| x % n)
        .ok_or_else(|| error!(CryptoballError::RandomnessExhausted))
}

/// Drawn lottery numbers (R-45 "known vector"): 5 distinct in 1..=MAX_NUMBER (ascending) and a bonus in
/// 1..=MAX_BONUS. Partial Fisher-Yates over 1..=69 with unbiased range reduction; no loops over tickets.
/// Display only under the raffle rule; the jackpot-only upgrade would pay on these.
pub fn winning_numbers(revealed: &[u8; 32]) -> Result<([u8; PICK_COUNT], u8)> {
    let mut words = revealed.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]));
    let mut pool = [0u8; MAX_NUMBER as usize];
    for (i, p) in pool.iter_mut().enumerate() {
        *p = i as u8 + 1;
    }
    let mut out = [0u8; PICK_COUNT];
    for i in 0..PICK_COUNT {
        let j = i + below(&mut words, (MAX_NUMBER as usize - i) as u32)? as usize;
        pool.swap(i, j);
        out[i] = pool[i];
    }
    out.sort_unstable();
    Ok((out, below(&mut words, MAX_BONUS as u32)? as u8 + 1))
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
    fn numbers_known_vector_and_no_biased_fallback() {
        // Words 1,2,3,4,5,6 -> Fisher-Yates picks (1,2,3,4,5 from shrinking pools): 1%69=1 -> pool[1]=2, ...
        let mut v = [0u8; 32];
        for (k, w) in [1u32, 2, 3, 4, 5, 6].iter().enumerate() {
            v[k * 4..k * 4 + 4].copy_from_slice(&w.to_le_bytes());
        }
        let (n, b) = winning_numbers(&v).unwrap();
        assert_eq!((n, b), ([2, 4, 6, 8, 10], 7));
        // All words above every limit: every draw rejects, so it must error instead of reducing modulo.
        assert!(winning_numbers(&[0xff; 32]).is_err());
    }

    #[test]
    fn numbers_valid_deterministic_and_spread() {
        let mut seen = [0u32; 70];
        let mut bonus_seen = [0u32; 27];
        for k in 0..2_000u32 {
            let mut v = [0u8; 32];
            let mut x = (k as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15);
            for c in v.chunks_mut(8) {
                x ^= x << 13; x ^= x >> 7; x ^= x << 17; // xorshift64
                c.copy_from_slice(&x.to_le_bytes());
            }
            let (n, b) = winning_numbers(&v).unwrap();
            assert_eq!((n, b), winning_numbers(&v).unwrap());
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
