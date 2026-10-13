use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CampaignState {
    Open,
    DrawCommitted,
    Settled,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub treasury_token: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub id: u64,
    pub mint: Pubkey,
    pub principal_vault: Pubkey,
    pub prize_vault: Pubkey,
    pub loss_vault: Pubkey,
    pub principal_cap: u64,
    pub close_ts: i64,
    pub state: CampaignState,
    pub principal_liability: u64,
    pub mock_value: u64,
    pub share_supply: u64,
    pub prize_balance: u64,
    pub position_count: u16,
    pub max_positions: u16,
    pub last_deposit_slot: u64,
    pub shortfall: bool,
    pub snapshot_share_supply: u64,
    pub snapshot_prize_balance: u64,
    pub snapshot_position_count: u16,
    pub snapshot_slot: u64,
    pub commit_ts: i64,
    pub mock_randomness: [u8; 32],
    pub winner: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub campaign: Pubkey,
    pub owner: Pubkey,
    pub shares: u64,
    pub eligible_after_slot: u64,
    pub withdrawn: bool,
    pub bump: u8,
}
