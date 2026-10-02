use anchor_lang::prelude::*;

#[event]
pub struct ConfigChanged { pub admin: Pubkey, pub treasury: Pubkey, pub fee_bps: u16, pub paused: bool }
#[event]
pub struct CampaignCreated { pub campaign: Pubkey, pub id: u64, pub price_lamports: u64, pub close_ts: i64, pub max_tickets: u32 }
#[event]
pub struct TicketPurchased { pub campaign: Pubkey, pub buyer: Pubkey, pub index: u32, pub numbers: [u8; 5], pub bonus: u8, pub asset: Pubkey }
#[event]
pub struct DrawCommitted { pub campaign: Pubkey, pub rand_account: Pubkey, pub seed_slot: u64 }
#[event]
pub struct DrawSettled { pub campaign: Pubkey, pub randomness: [u8; 32], pub winning_index: u32, pub winner: Pubkey, pub winning_numbers: [u8; 5], pub winning_bonus: u8, pub prize_lamports: u64, pub fee_lamports: u64 }
#[event]
pub struct PrizePaid { pub campaign: Pubkey, pub index: u32, pub buyer: Pubkey, pub lamports: u64 }
#[event]
pub struct CampaignCancelled { pub campaign: Pubkey }
#[event]
pub struct TicketRefunded { pub campaign: Pubkey, pub index: u32, pub buyer: Pubkey, pub lamports: u64 }
