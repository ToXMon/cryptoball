//! Cryptoball: raffle-style SOL lottery on Solana (devnet MVP).
//!
//! Behaviour, accounts, seeds and checks: docs/design.md; requirement ids (R-xx): docs/requirements.md.
//! Lifecycle: create_campaign -> buy_ticket* -> commit_draw -> settle_draw (pays fee + winner atomically),
//! or cancel_campaign -> refund_ticket*. Every state change has exactly one owning instruction.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use mpl_core::instructions::{CreateCollectionV2CpiBuilder, CreateV2CpiBuilder};
use mpl_core::types::{Attribute, Attributes, Plugin, PluginAuthorityPair};
use switchboard_on_demand::RandomnessAccountData;

pub mod constants;
pub mod errors;
pub mod events;
pub mod state;
pub mod winner;

use constants::*;
use errors::CryptoballError as E;
use events::*;
use state::*;

// Placeholder program id (keypair not committed). Replaced at devnet deploy; see README receipts.
declare_id!("GtdcPM3LTX8G8pB1bVW1jWfuxTj3kZmD3axt4Q7whBpC");

#[program]
pub mod cryptoball {
    use super::*;

    /// R-01..R-06, R-51, R-76. Signer: program upgrade authority (checked against ProgramData).
    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, E::FeeTooHigh);
        check_treasury(&ctx.accounts.treasury)?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.upgrade_authority.key();
        c.pending_admin = None;
        c.treasury = ctx.accounts.treasury.key();
        c.fee_bps = fee_bps;
        c.paused = false;
        c.bump = ctx.bumps.config;
        emit_config(c);
        Ok(())
    }

    /// R-06..R-10, R-51, R-76. Signer: admin. Existing campaigns keep their fee snapshot.
    pub fn update_config(ctx: Context<UpdateConfig>, fee_bps: Option<u16>, paused: Option<bool>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(f) = fee_bps {
            require!(f <= MAX_FEE_BPS, E::FeeTooHigh);
            c.fee_bps = f;
        }
        if let Some(t) = &ctx.accounts.new_treasury {
            check_treasury(t)?;
            c.treasury = t.key();
        }
        if let Some(p) = paused {
            c.paused = p;
        }
        emit_config(c);
        Ok(())
    }

    /// R-11, R-76. Signer: admin.
    pub fn nominate_admin(ctx: Context<AdminOnly>, nominee: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.pending_admin = Some(nominee);
        emit_config(c);
        Ok(())
    }

    /// R-12, R-76. Signer: the nominee.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(c.pending_admin == Some(ctx.accounts.nominee.key()), E::Unauthorized);
        c.admin = ctx.accounts.nominee.key();
        c.pending_admin = None;
        emit_config(c);
        Ok(())
    }

    /// R-13..R-19, R-77. Signer: admin. Creates the Campaign, its Core collection (update authority =
    /// Campaign PDA) and fixes the vault bump. The vault comes alive on the first buy_ticket credit.
    pub fn create_campaign(ctx: Context<CreateCampaign>, id: u64, price_lamports: u64, close_ts: i64, max_tickets: u32) -> Result<()> {
        require!(price_lamports >= MIN_TICKET_PRICE_LAMPORTS, E::InvalidParams);
        require!(max_tickets > 0 && max_tickets <= MAX_TICKETS, E::InvalidParams);
        require!(close_ts > Clock::get()?.unix_timestamp, E::InvalidParams);

        CreateCollectionV2CpiBuilder::new(&ctx.accounts.core_program)
            .collection(&ctx.accounts.collection)
            .update_authority(Some(&ctx.accounts.campaign.to_account_info()))
            .payer(&ctx.accounts.admin)
            .system_program(&ctx.accounts.system_program)
            .name(format!("Cryptoball Campaign #{id}"))
            .uri(TICKET_URI.to_string())
            .invoke()?;

        let c = &mut ctx.accounts.campaign;
        c.id = id;
        c.price_lamports = price_lamports;
        c.close_ts = close_ts;
        c.max_tickets = max_tickets;
        c.ticket_count = 0;
        c.fee_bps = ctx.accounts.config.fee_bps;
        c.state = CampaignState::Open;
        c.collection = ctx.accounts.collection.key();
        c.bump = ctx.bumps.campaign;
        c.vault_bump = ctx.bumps.vault;
        emit!(CampaignCreated { campaign: c.key(), id, price_lamports, close_ts, max_tickets });
        Ok(())
    }

    /// R-21..R-34, R-88. Signer: buyer. Atomic: pay the vault, create the Ticket, mint the Core NFT.
    pub fn buy_ticket(ctx: Context<BuyTicket>, numbers: [u8; PICK_COUNT], bonus: u8) -> Result<()> {
        let camp = &ctx.accounts.campaign;
        require!(camp.state == CampaignState::Open, E::WrongState);
        require!(Clock::get()?.unix_timestamp < camp.close_ts, E::SalesClosed);
        require!(!ctx.accounts.config.paused, E::Paused);
        require!(camp.ticket_count < camp.max_tickets, E::SoldOut);
        require!(valid_numbers(&numbers) && (1..=MAX_BONUS).contains(&bonus), E::InvalidNumbers);

        let (price, index) = (camp.price_lamports, camp.ticket_count);
        let next = index.checked_add(1).ok_or(E::Overflow)?;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer { from: ctx.accounts.buyer.to_account_info(), to: ctx.accounts.vault.to_account_info() },
            ),
            price,
        )?;

        let mut attrs: Vec<Attribute> = numbers
            .iter()
            .enumerate()
            .map(|(i, n)| Attribute { key: format!("n{}", i + 1), value: n.to_string() })
            .collect();
        attrs.push(Attribute { key: "bonus".to_string(), value: bonus.to_string() });
        let campaign_info = ctx.accounts.campaign.to_account_info();
        let id_le = camp.id.to_le_bytes();
        let seeds: &[&[u8]] = &[CAMPAIGN_SEED, &id_le, &[camp.bump]];
        CreateV2CpiBuilder::new(&ctx.accounts.core_program)
            .asset(&ctx.accounts.asset)
            .collection(Some(&ctx.accounts.collection))
            .authority(Some(&campaign_info))
            .payer(&ctx.accounts.buyer)
            .owner(Some(&ctx.accounts.buyer))
            .system_program(&ctx.accounts.system_program)
            .name(format!("Cryptoball #{index}"))
            .uri(TICKET_URI.to_string())
            .plugins(vec![PluginAuthorityPair { plugin: Plugin::Attributes(Attributes { attribute_list: attrs }), authority: None }])
            .invoke_signed(&[seeds])?;

        let t = &mut ctx.accounts.ticket;
        t.campaign = ctx.accounts.campaign.key();
        t.index = index;
        t.buyer = ctx.accounts.buyer.key();
        t.numbers = numbers;
        t.bonus = bonus;
        t.asset = ctx.accounts.asset.key();
        t.status = TicketStatus::Active;
        t.bump = ctx.bumps.ticket;
        ctx.accounts.campaign.ticket_count = next;
        emit!(TicketPurchased { campaign: t.campaign, buyer: t.buyer, index, numbers, bonus, asset: t.asset });
        Ok(())
    }

    /// R-37..R-42. Signer: anyone. Open -> DrawCommitted. Must share a tx with Switchboard's commit ix
    /// (seed_slot == slot - 1 proves it).
    pub fn commit_draw(ctx: Context<CommitDraw>) -> Result<()> {
        let c = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;
        require!(c.state == CampaignState::Open, E::WrongState);
        require!(clock.unix_timestamp >= c.close_ts, E::NotClosed);
        require!(c.ticket_count > 0, E::NoTickets);

        let data = ctx.accounts.randomness.data.borrow();
        let r = RandomnessAccountData::parse(data).map_err(|_| error!(E::BadRandomness))?;
        require!(Some(r.seed_slot) == clock.slot.checked_sub(1), E::BadRandomness);
        require!(r.reveal_slot < r.seed_slot, E::BadRandomness); // not yet revealed for this seed

        c.rand_account = ctx.accounts.randomness.key();
        c.seed_slot = r.seed_slot;
        c.committed_at = clock.unix_timestamp;
        c.state = CampaignState::DrawCommitted;
        emit!(DrawCommitted { campaign: c.key(), rand_account: c.rand_account, seed_slot: c.seed_slot });
        Ok(())
    }

    /// R-43..R-54, R-78. Signer: anyone. DrawCommitted -> Settled. Derives numbers and the winning ticket,
    /// pays the fee to the treasury and the prize to Ticket.buyer, both in this transaction (no claim step).
    pub fn settle_draw(ctx: Context<SettleDraw>) -> Result<()> {
        let clock = Clock::get()?;
        let c = &mut ctx.accounts.campaign;
        require!(c.state == CampaignState::DrawCommitted, E::WrongState);

        let revealed = {
            let data = ctx.accounts.randomness.data.borrow();
            let r = RandomnessAccountData::parse(data).map_err(|_| error!(E::BadRandomness))?;
            require!(r.seed_slot == c.seed_slot, E::BadSettlement);
            // The oracle's reveal is durable in the randomness account, so settlement reads the STORED value
            // instead of demanding the exact reveal slot (which made settlement fail if we were one slot late).
            // The window below ends where cancel_campaign starts, so settle and cancel can never both apply.
            require!(r.reveal_slot != 0 && r.reveal_slot <= clock.slot, E::NotRevealed);
            require!(
                clock.unix_timestamp <= c.committed_at.saturating_add(REVEAL_TIMEOUT_SECS),
                E::TimeoutNotElapsed
            );
            r.value
        };

        let idx = winner::winning_index(&revealed, c.ticket_count)?;
        let t = &ctx.accounts.ticket;
        require!(t.campaign == c.key() && t.index == idx, E::BadSettlement);

        let pool = c.price_lamports.checked_mul(c.ticket_count as u64).ok_or(E::Overflow)?;
        let fee = u64::try_from(
            (pool as u128).checked_mul(c.fee_bps as u128).ok_or(E::Overflow)? / 10_000u128,
        )
        .map_err(|_| E::Overflow)?;
        let prize = pool.checked_sub(fee).ok_or(E::Overflow)?;

        // ponytail: a fee below the treasury's rent minimum fails here if the treasury was drained to 0
        // (admin-set wallet, self-inflicted); upgrade = sweep to a fallback or cancel path.
        let camp_key = c.key();
        if fee > 0 {
            vault_pay(&ctx.accounts.vault, &ctx.accounts.treasury, &ctx.accounts.system_program, &camp_key, c.vault_bump, fee)?;
        }
        let prize_paid = vault_pay(&ctx.accounts.vault, &ctx.accounts.buyer_wallet, &ctx.accounts.system_program, &camp_key, c.vault_bump, prize)?;

        let (numbers, bonus) = winner::winning_numbers(&revealed)?;
        c.randomness = revealed;
        c.winning_index = idx;
        c.winner = t.buyer;
        c.winning_numbers = numbers;
        c.winning_bonus = bonus;
        c.fee_lamports = fee;
        c.prize_lamports = prize_paid;
        c.state = CampaignState::Settled;
        emit!(DrawSettled {
            campaign: c.key(),
            randomness: revealed,
            winning_index: idx,
            winner: t.buyer,
            winning_numbers: numbers,
            winning_bonus: bonus,
            prize_lamports: prize_paid,
            fee_lamports: fee
        });
        Ok(())
    }

    /// R-55, R-56, R-60. Signer: anyone. Open (no tickets, after close) or DrawCommitted (after the
    /// reveal timeout) -> Cancelled.
    pub fn cancel_campaign(ctx: Context<CancelCampaign>) -> Result<()> {
        let c = &mut ctx.accounts.campaign;
        let now = Clock::get()?.unix_timestamp;
        match c.state {
            CampaignState::Open => {
                require!(now >= c.close_ts, E::NotClosed);
                require!(c.ticket_count == 0, E::WrongState);
            }
            CampaignState::DrawCommitted => {
                let deadline = c.committed_at.checked_add(REVEAL_TIMEOUT_SECS).ok_or(E::Overflow)?;
                require!(now > deadline, E::TimeoutNotElapsed);
            }
            _ => return err!(E::WrongState),
        }
        c.state = CampaignState::Cancelled;
        emit!(CampaignCancelled { campaign: c.key() });
        Ok(())
    }

    /// R-58, R-59, R-79, R-80. Signer: anyone. Cancelled: price back to Ticket.buyer, once per ticket.
    pub fn refund_ticket(ctx: Context<RefundTicket>) -> Result<()> {
        let c = &ctx.accounts.campaign;
        let t = &mut ctx.accounts.ticket;
        require!(c.state == CampaignState::Cancelled, E::WrongState);
        require!(t.status == TicketStatus::Active, E::AlreadyRefunded);
        t.status = TicketStatus::Refunded;
        let paid = vault_pay(&ctx.accounts.vault, &ctx.accounts.buyer_wallet, &ctx.accounts.system_program, &c.key(), c.vault_bump, c.price_lamports)?;
        emit!(TicketRefunded { campaign: c.key(), index: t.index, buyer: t.buyer, lamports: paid });
        Ok(())
    }
}

fn emit_config(c: &Config) {
    emit!(ConfigChanged { admin: c.admin, treasury: c.treasury, fee_bps: c.fee_bps, paused: c.paused });
}

/// R-51: an empty treasury could not be credited with a small fee.
fn check_treasury(t: &SystemAccount) -> Result<()> {
    require!(t.lamports() >= Rent::get()?.minimum_balance(0), E::TreasuryBelowRent);
    Ok(())
}

/// Strictly ascending, all within 1..=MAX_NUMBER (R-25, R-26).
fn valid_numbers(n: &[u8; PICK_COUNT]) -> bool {
    n[0] >= 1 && n[PICK_COUNT - 1] <= MAX_NUMBER && n.windows(2).all(|w| w[0] < w[1])
}

/// Pay `amount` out of the vault PDA. If the remainder would be left below the rent-exempt minimum
/// (only possible when a third party donated dust to the vault) sweep the whole balance instead, since
/// the runtime rejects a non-zero sub-rent system account. Returns lamports sent.
// ponytail: dust donations go to the last payee; fine for devnet, mainnet could route them to the treasury.
fn vault_pay<'info>(
    vault: &SystemAccount<'info>,
    to: &SystemAccount<'info>,
    system_program: &Program<'info, System>,
    campaign: &Pubkey,
    vault_bump: u8,
    amount: u64,
) -> Result<u64> {
    let left = vault.lamports().checked_sub(amount).ok_or(E::Overflow)?;
    let amount = if left != 0 && left < Rent::get()?.minimum_balance(0) { vault.lamports() } else { amount };
    let seeds: &[&[u8]] = &[VAULT_SEED, campaign.as_ref(), &[vault_bump]];
    transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            Transfer { from: vault.to_account_info(), to: to.to_account_info() },
            &[seeds],
        ),
        amount,
    )?;
    Ok(amount)
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,
    #[account(init, payer = upgrade_authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Cryptoball>,
    #[account(constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key()) @ E::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ E::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ E::Unauthorized)]
    pub config: Account<'info, Config>,
    pub new_treasury: Option<SystemAccount<'info>>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub nominee: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ E::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Campaign::INIT_SPACE, seeds = [CAMPAIGN_SEED, &id.to_le_bytes()], bump)]
    pub campaign: Account<'info, Campaign>,
    #[account(seeds = [VAULT_SEED, campaign.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    /// Fresh keypair for the Core collection; Core itself rejects an already-initialised account.
    #[account(mut)]
    pub collection: Signer<'info>,
    /// CHECK: pinned to the Metaplex Core program id (R-73).
    #[account(address = MPL_CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    #[account(
        init, payer = buyer, space = 8 + Ticket::INIT_SPACE,
        seeds = [TICKET_SEED, campaign.key().as_ref(), &campaign.ticket_count.to_le_bytes()], bump
    )]
    pub ticket: Account<'info, Ticket>,
    /// Fresh keypair for the Core asset.
    #[account(mut)]
    pub asset: Signer<'info>,
    /// CHECK: the campaign's Core collection (address stored at creation); Core validates the rest.
    #[account(mut, address = campaign.collection @ E::BadAccount)]
    pub collection: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_SEED, campaign.key().as_ref()], bump = campaign.vault_bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: pinned to the Metaplex Core program id (R-73).
    #[account(address = MPL_CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitDraw<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: owner pinned to the Switchboard devnet program; layout checked by `parse` (R-39).
    #[account(owner = SWITCHBOARD_DEVNET_ID @ E::BadRandomness)]
    pub randomness: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleDraw<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: must be the account stored at commit and still Switchboard-owned (R-44).
    #[account(address = campaign.rand_account @ E::BadSettlement, owner = SWITCHBOARD_DEVNET_ID @ E::BadRandomness)]
    pub randomness: UncheckedAccount<'info>,
    /// The ticket at the derived index; the index is compared in the handler (only known after the reveal).
    #[account(seeds = [TICKET_SEED, campaign.key().as_ref(), &ticket.index.to_le_bytes()], bump = ticket.bump)]
    pub ticket: Account<'info, Ticket>,
    #[account(mut, seeds = [VAULT_SEED, campaign.key().as_ref()], bump = campaign.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut, address = config.treasury @ E::BadAccount)]
    pub treasury: SystemAccount<'info>,
    /// Prize destination: always the winning Ticket's stored buyer, never the NFT owner or the caller.
    #[account(mut, address = ticket.buyer @ E::BadAccount)]
    pub buyer_wallet: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelCampaign<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
pub struct RefundTicket<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut, has_one = campaign @ E::BadAccount,
        seeds = [TICKET_SEED, campaign.key().as_ref(), &ticket.index.to_le_bytes()], bump = ticket.bump
    )]
    pub ticket: Account<'info, Ticket>,
    #[account(mut, seeds = [VAULT_SEED, campaign.key().as_ref()], bump = campaign.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut, address = ticket.buyer @ E::BadAccount)]
    pub buyer_wallet: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}
