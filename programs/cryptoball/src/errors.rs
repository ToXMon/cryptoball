use anchor_lang::prelude::*;

/// Typed errors; the client maps each code to an English message (R-69).
#[error_code]
pub enum CryptoballError {
    #[msg("Fee above the hard cap")]
    FeeTooHigh,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Campaign is not in the required state")]
    WrongState,
    #[msg("Ticket sales are paused")]
    Paused,
    #[msg("Campaign has closed for sales")]
    SalesClosed,
    #[msg("Campaign has not closed yet")]
    NotClosed,
    #[msg("Invalid ticket price or ticket cap")]
    InvalidParams,
    #[msg("Picked numbers are invalid")]
    InvalidNumbers,
    #[msg("Campaign is sold out")]
    SoldOut,
    #[msg("Randomness account is not the pinned Switchboard account")]
    BadRandomness,
    #[msg("Randomness is not revealed yet")]
    NotRevealed,
    #[msg("Account does not match the derived address")]
    BadAccount,
    #[msg("Reveal timeout has not elapsed")]
    TimeoutNotElapsed,
    #[msg("Ticket already refunded")]
    AlreadyRefunded,
    #[msg("Draw cannot be settled by this ticket or randomness account")]
    BadSettlement,
    #[msg("Campaign has no tickets")]
    NoTickets,
    #[msg("Treasury wallet is below the rent-exempt minimum")]
    TreasuryBelowRent,
    #[msg("Revealed randomness could not yield unbiased numbers")]
    RandomnessExhausted,
    #[msg("Arithmetic overflow")]
    Overflow,
    // Appended, never inserted: an error's number is part of the client contract, so existing
    // codes must keep their values across upgrades.
    #[msg("Claim amount is zero or above the per-claim maximum")]
    ClaimTooLarge,
    #[msg("This wallet has reached its lifetime faucet cap")]
    ClaimLifetimeCap,
    #[msg("The faucet pool is exhausted")]
    FaucetDrained,
    #[msg("The faucet vault holds less than the claim amount")]
    FaucetEmpty,
}
