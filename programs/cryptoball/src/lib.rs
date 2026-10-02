//! Cryptoball: raffle-style SOL lottery on Solana (devnet MVP).
//!
//! PHASE 1 SCAFFOLD: interface stubs only. Every handler returns `NotImplemented`.
//! Behaviour, accounts, seeds and checks are specified in docs/design.md; requirement ids (R-xx)
//! in docs/requirements.md. Phase 3 fills the bodies one instruction at a time (test after each).

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod state;
pub mod winner;

use errors::CryptoballError;

// Devnet program id (generated keypair, not committed). Replaced at devnet deploy; see README receipts.
declare_id!("8LjPXfLAJAifS62qRt8JAgL7g8cXiWoKDr7WAVsDmx1N");

#[program]
pub mod cryptoball {
    use super::*;

    /// R-01..R-06, R-76. Signer: program upgrade authority (checked against ProgramData).
    /// Creates Config ["config"]; stores admin, treasury wallet, fee_bps (<= MAX_FEE_BPS).
    pub fn initialize(_ctx: Context<Initialize>, _treasury: Pubkey, _fee_bps: u16) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-06..R-10, R-76. Signer: admin. Updates fee_bps (clamped), treasury, paused.
    pub fn update_config(_ctx: Context<AdminOnly>, _fee_bps: Option<u16>, _treasury: Option<Pubkey>, _paused: Option<bool>) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-11, R-76. Signer: admin. Sets Config.pending_admin.
    pub fn nominate_admin(_ctx: Context<AdminOnly>, _nominee: Pubkey) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-12, R-76. Signer: the nominee. Rotates Config.admin.
    pub fn accept_admin(_ctx: Context<AcceptAdmin>) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-13..R-19, R-77. Signer: admin. Creates Campaign ["campaign", id], the Core collection (CPI,
    /// update authority = Campaign PDA); state Open, count 0, fee snapshot. The SOL vault PDA
    /// ["vault", campaign] is system-owned and comes into existence on the first buy_ticket credit.
    pub fn create_campaign(_ctx: Context<CreateCampaign>, _id: u64, _price_lamports: u64, _close_ts: i64, _max_tickets: u32) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-21..R-34. Signer: buyer. Atomically: validate (Open, before close, not paused, not sold out,
    /// 5 ascending numbers in 1..=69, bonus in 1..=26), system-transfer price buyer -> vault, create Ticket,
    /// CPI Core CreateV2 (Attributes n1..n5 + bonus, owner = buyer), count += 1, emit TicketPurchased.
    pub fn buy_ticket(_ctx: Context<BuyTicket>, _numbers: [u8; 5], _bonus: u8) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-37..R-42. Signer: anyone. Open -> DrawCommitted at/after close_ts with count > 0. Verifies the
    /// randomness account is Switchboard-owned (pinned devnet id), seed_slot == slot - 1, not yet revealed;
    /// stores its address and seed_slot. Must share a tx with Switchboard's commit instruction.
    pub fn commit_draw(_ctx: Context<CommitDraw>) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-43..R-54, R-78. Signer: anyone (fee payer only). DrawCommitted -> Settled. Reads the revealed
    /// value (must share a tx with Switchboard's reveal instruction), calls `winner::winning_index`,
    /// verifies the supplied Ticket is that index, pays fee -> Config.treasury and pool - fee -> Ticket.buyer
    /// (both signed by the vault PDA seeds). No claim step; the destination is never caller-chosen.
    pub fn settle_draw(_ctx: Context<SettleDraw>) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-55, R-56, R-60. Signer: anyone. Open (count 0, after close_ts) or DrawCommitted (after
    /// REVEAL_TIMEOUT_SECS) -> Cancelled.
    pub fn cancel_campaign(_ctx: Context<CancelCampaign>) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }

    /// R-58, R-59, R-79, R-80. Signer: anyone. On a Cancelled campaign, returns price to Ticket.buyer
    /// from the vault and marks the Ticket Refunded (once).
    pub fn refund_ticket(_ctx: Context<RefundTicket>) -> Result<()> {
        err!(CryptoballError::NotImplemented)
    }
}

// Account contexts. Phase 1 declares only the shape (signers and key accounts); phase 3 adds
// seeds/bump/has_one/address constraints exactly as written in docs/design.md section 5.

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub nominee: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitDraw<'info> {
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleDraw<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelCampaign<'info> {
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefundTicket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
