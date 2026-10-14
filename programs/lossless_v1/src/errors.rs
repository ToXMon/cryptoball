use anchor_lang::prelude::*;

#[error_code]
pub enum LosslessError {
    #[msg("Unauthorized admin")]
    Unauthorized,
    #[msg("Fee exceeds the 250 bps prototype cap")]
    FeeTooHigh,
    #[msg("Invalid campaign parameters")]
    InvalidParams,
    #[msg("Wrong campaign state")]
    WrongState,
    #[msg("Deposits are paused")]
    Paused,
    #[msg("Campaign is closed")]
    Closed,
    #[msg("Deposit cap reached")]
    CapReached,
    #[msg("Token account, owner, or mint does not match")]
    WrongTokenAccount,
    #[msg("Token mint must be initialized six-decimal test USDC")]
    WrongMint,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Principal is in shortfall; deposits, harvest, and draws are stopped")]
    Shortfall,
    #[msg("Harvest tracked yield before issuing shares or committing the draw")]
    HarvestRequired,
    #[msg("Draw has no eligible shares")]
    NoShares,
    #[msg("A deposit in the current slot is not eligible yet")]
    SharesNotMature,
    #[msg("Reveal timeout has not elapsed")]
    TimeoutNotElapsed,
    #[msg("Position is not part of the committed snapshot")]
    BadSnapshot,
    #[msg("Position already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Draw seed exhausted bounded rejection sampling")]
    RandomnessExhausted,
    #[msg("Checked arithmetic overflow")]
    Overflow,
}
