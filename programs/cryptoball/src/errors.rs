use anchor_lang::prelude::*;

/// Typed errors; the client maps each code to an English message (R-69).
#[error_code]
pub enum CryptoballError {
    #[msg("Instruction body not implemented yet (phase 3)")]
    NotImplemented,
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
    #[msg("Arithmetic overflow")]
    Overflow,
}
