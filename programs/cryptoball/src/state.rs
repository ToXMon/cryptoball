//! Account layouts. Seeds and field meaning: docs/design.md section 4.

use anchor_lang::prelude::*;

/// Global config. Seeds: ["config"].
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Option<Pubkey>,
    /// Wallet that receives the fee (SOL). Address pinned here, never passed by the caller.
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CampaignState {
    Open,
    DrawCommitted,
    Settled,
    Cancelled,
}

/// One draw. Seeds: ["campaign", id u64 LE].
#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub id: u64,
    pub price_lamports: u64,
    pub close_ts: i64,
    pub max_tickets: u32,
    pub ticket_count: u32,
    /// Snapshot of Config.fee_bps at creation.
    pub fee_bps: u16,
    pub state: CampaignState,
    /// Core collection address for this campaign's ticket NFTs.
    pub collection: Pubkey,
    pub rand_account: Pubkey,
    pub seed_slot: u64,
    pub committed_at: i64,
    pub randomness: [u8; 32],
    pub winning_index: u32,
    pub winner: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum TicketStatus {
    Active,
    Refunded,
}

/// One purchased ticket. Seeds: ["ticket", campaign, index u32 LE].
#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub campaign: Pubkey,
    pub index: u32,
    /// Payout / refund destination. The NFT owner is never consulted.
    pub buyer: Pubkey,
    pub numbers: [u8; 5],
    pub bonus: u8,
    /// Core asset address (the receipt NFT).
    pub asset: Pubkey,
    pub status: TicketStatus,
    pub bump: u8,
}
