use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
};

pub mod errors;
pub mod state;
use errors::LosslessError as E;
use state::*;

declare_id!("EcFzauTsYV41yUFxnJtx17fz4awZnGRaQKtZWiBF69VF");

const CONFIG_SEED: &[u8] = b"lossless-config";
const CAMPAIGN_SEED: &[u8] = b"lossless-campaign";
const PRINCIPAL_SEED: &[u8] = b"principal-vault";
const PRIZE_SEED: &[u8] = b"prize-vault";
const LOSS_SEED: &[u8] = b"mock-loss-vault";
const POSITION_SEED: &[u8] = b"position";
const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const LOSSLESS_USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const MAX_FEE_BPS: u16 = 250;
// ponytail: one-transaction settlement fits the 1232-byte packet limit at 24 positions; larger needs batching.
const MAX_POSITIONS: u16 = 24;
const REVEAL_TIMEOUT_SECS: i64 = 3_600;
const DRAW_RETRIES: u8 = 4;

#[program]
pub mod lossless_v1 {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, treasury: Pubkey, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, E::FeeTooHigh);
        validate_mint(&ctx.accounts.mint)?;
        validate_token_account(
            &ctx.accounts.treasury_token,
            ctx.accounts.mint.key(),
            treasury,
        )?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.upgrade_authority.key();
        c.mint = ctx.accounts.mint.key();
        c.treasury = treasury;
        c.treasury_token = ctx.accounts.treasury_token.key();
        c.fee_bps = fee_bps;
        c.paused = false;
        c.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            admin: c.admin,
            mint: c.mint,
            fee_bps
        });
        Ok(())
    }

    pub fn update_config(
        ctx: Context<AdminOnly>,
        fee_bps: Option<u16>,
        paused: Option<bool>,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(fee) = fee_bps {
            require!(fee <= MAX_FEE_BPS, E::FeeTooHigh);
            c.fee_bps = fee;
        }
        if let Some(value) = paused {
            c.paused = value;
        }
        emit!(ConfigUpdated {
            fee_bps: c.fee_bps,
            paused: c.paused
        });
        Ok(())
    }

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        id: u64,
        close_ts: i64,
        principal_cap: u64,
        max_positions: u16,
    ) -> Result<()> {
        require!(close_ts > Clock::get()?.unix_timestamp, E::InvalidParams);
        require!(
            principal_cap > 0 && (1..=MAX_POSITIONS).contains(&max_positions),
            E::InvalidParams
        );
        let c = &mut ctx.accounts.campaign;
        c.id = id;
        c.mint = ctx.accounts.config.mint;
        c.principal_vault = ctx.accounts.principal_vault.key();
        c.prize_vault = ctx.accounts.prize_vault.key();
        c.loss_vault = ctx.accounts.loss_vault.key();
        c.principal_cap = principal_cap;
        c.close_ts = close_ts;
        c.state = CampaignState::Open;
        c.principal_liability = 0;
        c.mock_value = 0;
        c.share_supply = 0;
        c.prize_balance = 0;
        c.position_count = 0;
        c.max_positions = max_positions;
        c.last_deposit_slot = 0;
        c.shortfall = false;
        c.snapshot_share_supply = 0;
        c.snapshot_prize_balance = 0;
        c.snapshot_position_count = 0;
        c.snapshot_slot = 0;
        c.commit_ts = 0;
        c.mock_randomness = [0; 32];
        c.winner = Pubkey::default();
        c.bump = ctx.bumps.campaign;
        initialize_token_account(
            &ctx.accounts.principal_vault,
            &ctx.accounts.mint,
            &ctx.accounts.token_program,
            c.key(),
        )?;
        initialize_token_account(
            &ctx.accounts.prize_vault,
            &ctx.accounts.mint,
            &ctx.accounts.token_program,
            c.key(),
        )?;
        initialize_token_account(
            &ctx.accounts.loss_vault,
            &ctx.accounts.mint,
            &ctx.accounts.token_program,
            c.key(),
        )?;
        emit!(CampaignCreated {
            campaign: c.key(),
            id,
            close_ts,
            principal_cap,
            max_positions
        });
        Ok(())
    }

    /// One position per wallet/campaign; shares are six-decimal test-USDC base units.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, E::ZeroAmount);
        let clock = Clock::get()?;
        let c = &mut ctx.accounts.campaign;
        require!(c.state == CampaignState::Open, E::WrongState);
        require!(!ctx.accounts.config.paused, E::Paused);
        require!(clock.unix_timestamp < c.close_ts, E::Closed);
        require!(!c.shortfall, E::Shortfall);
        require!(c.mock_value == c.principal_liability, E::HarvestRequired);
        require!(c.position_count < c.max_positions, E::CapReached);
        let next = c
            .principal_liability
            .checked_add(amount)
            .ok_or(E::Overflow)?;
        require!(next <= c.principal_cap, E::CapReached);
        validate_token_account(&ctx.accounts.source, c.mint, ctx.accounts.owner.key())?;
        validate_token_account(&ctx.accounts.principal_vault, c.mint, c.key())?;
        token_transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.source,
            &ctx.accounts.principal_vault,
            ctx.accounts.owner.to_account_info(),
            amount,
            None,
        )?;
        let eligible_after = clock.slot.checked_add(1).ok_or(E::Overflow)?;
        let p = &mut ctx.accounts.position;
        p.campaign = c.key();
        p.owner = ctx.accounts.owner.key();
        p.shares = amount;
        p.eligible_after_slot = eligible_after;
        p.withdrawn = false;
        p.bump = ctx.bumps.position;
        c.principal_liability = next;
        c.mock_value = c.mock_value.checked_add(amount).ok_or(E::Overflow)?;
        c.share_supply = c.share_supply.checked_add(amount).ok_or(E::Overflow)?;
        c.position_count = c.position_count.checked_add(1).ok_or(E::Overflow)?;
        c.last_deposit_slot = clock.slot;
        emit!(Deposited {
            campaign: c.key(),
            owner: p.owner,
            amount,
            shares: p.shares,
            eligible_after_slot: eligible_after
        });
        Ok(())
    }

    /// Devnet/test-only yield: admin transfers test USDC into the mock principal vault.
    pub fn mock_accrue(ctx: Context<MockValueChange>, amount: u64) -> Result<()> {
        require!(amount > 0, E::ZeroAmount);
        let c = &mut ctx.accounts.campaign;
        require!(c.state == CampaignState::Open, E::WrongState);
        validate_token_account(&ctx.accounts.source, c.mint, ctx.accounts.admin.key())?;
        validate_token_account(&ctx.accounts.principal_vault, c.mint, c.key())?;
        token_transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.source,
            &ctx.accounts.principal_vault,
            ctx.accounts.admin.to_account_info(),
            amount,
            None,
        )?;
        c.mock_value = c.mock_value.checked_add(amount).ok_or(E::Overflow)?;
        c.shortfall = c.mock_value < c.principal_liability;
        emit!(MockValueChanged {
            campaign: c.key(),
            amount,
            value: c.mock_value,
            shortfall: c.shortfall
        });
        Ok(())
    }

    /// Move mock assets into an inaccessible sink to exercise shortfall and pro-rata withdrawal.
    pub fn mock_loss(ctx: Context<MockLoss>, amount: u64) -> Result<()> {
        require!(amount > 0, E::ZeroAmount);
        let c = &mut ctx.accounts.campaign;
        require!(c.state == CampaignState::Open, E::WrongState);
        let value = c.mock_value.checked_sub(amount).ok_or(E::Shortfall)?;
        campaign_transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.principal_vault,
            &ctx.accounts.loss_vault,
            c,
            amount,
        )?;
        c.mock_value = value;
        c.shortfall = value < c.principal_liability;
        emit!(MockLossRecorded {
            campaign: c.key(),
            amount,
            value,
            shortfall: c.shortfall
        });
        Ok(())
    }

    /// Only tracked mock value counts; unsolicited principal-vault donations do not create yield.
    pub fn harvest(ctx: Context<Harvest>) -> Result<()> {
        let c = &mut ctx.accounts.campaign;
        require!(c.state == CampaignState::Open, E::WrongState);
        require!(!ctx.accounts.config.paused, E::Paused);
        require_keys_eq!(c.mint, ctx.accounts.config.mint, E::WrongMint);
        validate_token_account(&ctx.accounts.principal_vault, c.mint, c.key())?;
        validate_token_account(&ctx.accounts.prize_vault, c.mint, c.key())?;
        require_keys_eq!(
            ctx.accounts.treasury_token.key(),
            ctx.accounts.config.treasury_token,
            E::WrongTokenAccount
        );
        validate_token_account(
            &ctx.accounts.treasury_token,
            c.mint,
            ctx.accounts.config.treasury,
        )?;
        if c.mock_value < c.principal_liability {
            c.shortfall = true;
            emit!(ShortfallDetected {
                campaign: c.key(),
                value: c.mock_value,
                principal: c.principal_liability
            });
            return Ok(());
        }
        c.shortfall = false;
        let yield_amount = c
            .mock_value
            .checked_sub(c.principal_liability)
            .ok_or(E::Overflow)?;
        let (fee, prize) = split_yield(yield_amount, ctx.accounts.config.fee_bps)?;
        if fee > 0 {
            campaign_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.principal_vault,
                &ctx.accounts.treasury_token,
                c,
                fee,
            )?;
        }
        if prize > 0 {
            campaign_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.principal_vault,
                &ctx.accounts.prize_vault,
                c,
                prize,
            )?;
        }
        c.mock_value = c.principal_liability;
        c.prize_balance = c.prize_balance.checked_add(prize).ok_or(E::Overflow)?;
        emit!(YieldHarvested {
            campaign: c.key(),
            yield_amount,
            fee,
            prize,
            prize_balance: c.prize_balance
        });
        Ok(())
    }

    /// Caller-supplied deterministic test seed; not secure oracles/randomness.
    pub fn commit_draw(ctx: Context<CommitDraw>, mock_randomness: [u8; 32]) -> Result<()> {
        let c = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;
        require!(c.state == CampaignState::Open, E::WrongState);
        require!(clock.unix_timestamp >= c.close_ts, E::Closed);
        require!(
            !c.shortfall && c.mock_value >= c.principal_liability,
            E::Shortfall
        );
        require!(c.mock_value == c.principal_liability, E::HarvestRequired);
        require!(c.share_supply > 0 && c.position_count > 0, E::NoShares);
        require!(clock.slot > c.last_deposit_slot, E::SharesNotMature);
        c.state = CampaignState::DrawCommitted;
        c.snapshot_share_supply = c.share_supply;
        c.snapshot_prize_balance = c.prize_balance;
        c.snapshot_position_count = c.position_count;
        c.snapshot_slot = clock.slot;
        c.commit_ts = clock.unix_timestamp;
        c.mock_randomness = mock_randomness;
        emit!(DrawCommitted {
            campaign: c.key(),
            shares: c.snapshot_share_supply,
            positions: c.snapshot_position_count,
            prize: c.snapshot_prize_balance,
            slot: c.snapshot_slot
        });
        Ok(())
    }

    pub fn settle_draw(ctx: Context<SettleDraw>) -> Result<()> {
        let c = &mut ctx.accounts.campaign;
        require!(c.state == CampaignState::DrawCommitted, E::WrongState);
        require!(
            c.share_supply == c.snapshot_share_supply
                && c.position_count == c.snapshot_position_count,
            E::BadSnapshot
        );
        require!(c.prize_balance == c.snapshot_prize_balance, E::BadSnapshot);
        require!(
            ctx.remaining_accounts.len() == c.snapshot_position_count as usize,
            E::BadSnapshot
        );
        let selected = uniform_index(&c.mock_randomness, c.snapshot_share_supply)?;
        let mut total = 0u64;
        let mut winner = None;
        let mut previous_key = None;
        for account in ctx.remaining_accounts.iter() {
            require!(account.owner == &crate::ID, E::BadSnapshot);
            let key = account.key().to_bytes();
            if let Some(previous) = previous_key {
                require!(previous < key, E::BadSnapshot);
            }
            previous_key = Some(key);
            let data = account.try_borrow_data()?;
            let mut bytes: &[u8] = &data;
            let p = Position::try_deserialize(&mut bytes).map_err(|_| error!(E::BadSnapshot))?;
            let (expected, bump) = Pubkey::find_program_address(
                &[POSITION_SEED, c.key().as_ref(), p.owner.as_ref()],
                &crate::ID,
            );
            require_keys_eq!(expected, account.key(), E::BadSnapshot);
            require!(
                p.bump == bump && p.campaign == c.key() && p.shares > 0 && !p.withdrawn,
                E::BadSnapshot
            );
            require!(p.eligible_after_slot <= c.snapshot_slot, E::BadSnapshot);
            let next = total.checked_add(p.shares).ok_or(E::Overflow)?;
            if selected >= total && selected < next {
                winner = Some(p.owner);
            }
            total = next;
        }
        require!(total == c.snapshot_share_supply, E::BadSnapshot);
        let winner = winner.ok_or(E::BadSnapshot)?;
        validate_token_account(&ctx.accounts.prize_vault, c.mint, c.key())?;
        validate_token_account(&ctx.accounts.winner_token, c.mint, winner)?;
        let prize = c.snapshot_prize_balance;
        if prize > 0 {
            campaign_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.prize_vault,
                &ctx.accounts.winner_token,
                c,
                prize,
            )?;
        }
        c.prize_balance = 0;
        c.winner = winner;
        c.state = CampaignState::Settled;
        emit!(DrawSettled {
            campaign: c.key(),
            winner,
            winning_share: selected,
            prize
        });
        Ok(())
    }

    pub fn cancel_campaign(ctx: Context<CancelCampaign>) -> Result<()> {
        let c = &mut ctx.accounts.campaign;
        let now = Clock::get()?.unix_timestamp;
        match c.state {
            CampaignState::Open => require!(now >= c.close_ts, E::Closed),
            CampaignState::DrawCommitted => {
                let deadline = c
                    .commit_ts
                    .checked_add(REVEAL_TIMEOUT_SECS)
                    .ok_or(E::Overflow)?;
                require!(now > deadline, E::TimeoutNotElapsed);
            }
            _ => return err!(E::WrongState),
        }
        require_keys_eq!(
            ctx.accounts.principal_vault.key(),
            c.principal_vault,
            E::WrongTokenAccount
        );
        require_keys_eq!(
            ctx.accounts.prize_vault.key(),
            c.prize_vault,
            E::WrongTokenAccount
        );
        validate_token_account(&ctx.accounts.principal_vault, c.mint, c.key())?;
        validate_token_account(&ctx.accounts.prize_vault, c.mint, c.key())?;
        let prize = c.prize_balance;
        if prize > 0 {
            campaign_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.prize_vault,
                &ctx.accounts.principal_vault,
                c,
                prize,
            )?;
            c.mock_value = c.mock_value.checked_add(prize).ok_or(E::Overflow)?;
        }
        c.prize_balance = 0;
        c.shortfall = c.mock_value < c.principal_liability;
        c.state = CampaignState::Cancelled;
        emit!(CampaignCancelled {
            campaign: c.key(),
            returned_prize: prize,
            shortfall: c.shortfall
        });
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let c = &mut ctx.accounts.campaign;
        require!(
            matches!(c.state, CampaignState::Settled | CampaignState::Cancelled)
                || (c.state == CampaignState::Open && c.shortfall),
            E::WrongState
        );
        let p = &mut ctx.accounts.position;
        require!(!p.withdrawn && p.shares > 0, E::AlreadyWithdrawn);
        require!(
            c.principal_liability >= p.shares && c.principal_liability > 0,
            E::BadSnapshot
        );
        validate_token_account(&ctx.accounts.principal_vault, c.mint, c.key())?;
        validate_token_account(&ctx.accounts.destination, c.mint, p.owner)?;
        let shares = p.shares;
        let open_shortfall = c.state == CampaignState::Open && c.shortfall;
        let tracked_value = if open_shortfall {
            c.mock_value
                .checked_add(c.prize_balance)
                .ok_or(E::Overflow)?
        } else {
            c.mock_value
        };
        let payout = if open_shortfall && shares == c.principal_liability {
            tracked_value
        } else {
            withdrawal_amount(shares, tracked_value, c.principal_liability)?
        };
        let principal_payout = payout.min(c.mock_value);
        let prize_payout = payout.checked_sub(principal_payout).ok_or(E::Overflow)?;
        if principal_payout > 0 {
            campaign_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.principal_vault,
                &ctx.accounts.destination,
                c,
                principal_payout,
            )?;
        }
        if prize_payout > 0 {
            validate_token_account(&ctx.accounts.prize_vault, c.mint, c.key())?;
            campaign_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.prize_vault,
                &ctx.accounts.destination,
                c,
                prize_payout,
            )?;
        }
        c.principal_liability = c
            .principal_liability
            .checked_sub(shares)
            .ok_or(E::Overflow)?;
        c.mock_value = c
            .mock_value
            .checked_sub(principal_payout)
            .ok_or(E::Overflow)?;
        c.prize_balance = c
            .prize_balance
            .checked_sub(prize_payout)
            .ok_or(E::Overflow)?;
        c.share_supply = c.share_supply.checked_sub(shares).ok_or(E::Overflow)?;
        c.position_count = c.position_count.checked_sub(1).ok_or(E::Overflow)?;
        c.shortfall = c.mock_value < c.principal_liability;
        p.shares = 0;
        p.withdrawn = true;
        emit!(Withdrawn {
            campaign: c.key(),
            owner: p.owner,
            shares,
            amount: payout,
            remaining_principal: c.principal_liability
        });
        Ok(())
    }
}

fn uniform_index(seed: &[u8; 32], supply: u64) -> Result<u64> {
    require!(supply > 0, E::NoShares);
    for attempt in 0..DRAW_RETRIES {
        let start = attempt as usize * 8;
        let word = u64::from_le_bytes(
            seed[start..start + 8]
                .try_into()
                .map_err(|_| error!(E::RandomnessExhausted))?,
        );
        if let Some(index) = index_from_word(word, supply) {
            return Ok(index);
        }
    }
    err!(E::RandomnessExhausted)
}

fn index_from_word(word: u64, supply: u64) -> Option<u64> {
    if supply == 0 {
        return None;
    }
    let n = supply as u128;
    let rejected = ((u64::MAX as u128 % n) + 1) % n;
    let limit = u64::MAX - rejected as u64;
    (word <= limit).then_some(word % supply)
}

fn split_yield(yield_amount: u64, fee_bps: u16) -> Result<(u64, u64)> {
    require!(fee_bps <= MAX_FEE_BPS, E::FeeTooHigh);
    let fee = (yield_amount as u128 * fee_bps as u128 / 10_000) as u64;
    Ok((fee, yield_amount.checked_sub(fee).ok_or(E::Overflow)?))
}

fn withdrawal_amount(shares: u64, value: u64, liability: u64) -> Result<u64> {
    require!(liability > 0 && shares <= liability, E::BadSnapshot);
    u64::try_from(
        (shares as u128)
            .checked_mul(value as u128)
            .ok_or(E::Overflow)?
            / liability as u128,
    )
    .map_err(|_| error!(E::Overflow))
}

fn validate_mint(mint: &UncheckedAccount) -> Result<()> {
    require_keys_eq!(mint.key(), LOSSLESS_USDC_MINT, E::WrongMint);
    require!(mint.owner == &TOKEN_PROGRAM_ID, E::WrongMint);
    let data = mint.try_borrow_data()?;
    require!(
        data.len() == 82 && data[45] == 1 && data[44] == 6,
        E::WrongMint
    );
    Ok(())
}

fn validate_token_account(account: &UncheckedAccount, mint: Pubkey, owner: Pubkey) -> Result<()> {
    require!(account.owner == &TOKEN_PROGRAM_ID, E::WrongTokenAccount);
    let data = account.try_borrow_data()?;
    require!(data.len() == 165 && data[108] == 1, E::WrongTokenAccount);
    require!(
        Pubkey::new_from_array(
            data[0..32]
                .try_into()
                .map_err(|_| error!(E::WrongTokenAccount))?
        ) == mint,
        E::WrongMint
    );
    require!(
        Pubkey::new_from_array(
            data[32..64]
                .try_into()
                .map_err(|_| error!(E::WrongTokenAccount))?
        ) == owner,
        E::WrongTokenAccount
    );
    Ok(())
}

fn initialize_token_account<'info>(
    account: &UncheckedAccount<'info>,
    mint: &UncheckedAccount<'info>,
    token_program: &UncheckedAccount<'info>,
    owner: Pubkey,
) -> Result<()> {
    let mut data = Vec::with_capacity(33);
    data.push(18); // SPL Token InitializeAccount3
    data.extend_from_slice(owner.as_ref());
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(account.key(), false),
            AccountMeta::new_readonly(mint.key(), false),
        ],
        data,
    };
    invoke(
        &ix,
        &[
            account.to_account_info(),
            mint.to_account_info(),
            token_program.to_account_info(),
        ],
    )?;
    Ok(())
}

fn campaign_transfer<'info>(
    token_program: &UncheckedAccount<'info>,
    source: &UncheckedAccount<'info>,
    destination: &UncheckedAccount<'info>,
    campaign: &Account<'info, Campaign>,
    amount: u64,
) -> Result<()> {
    let id = campaign.id.to_le_bytes();
    let bump = [campaign.bump];
    let seeds: &[&[u8]] = &[CAMPAIGN_SEED, &id, &bump];
    token_transfer(
        token_program,
        source,
        destination,
        campaign.to_account_info(),
        amount,
        Some(seeds),
    )
}

fn token_transfer<'info>(
    token_program: &UncheckedAccount<'info>,
    source: &UncheckedAccount<'info>,
    destination: &UncheckedAccount<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    signer_seeds: Option<&[&[u8]]>,
) -> Result<()> {
    require_keys_eq!(token_program.key(), TOKEN_PROGRAM_ID, E::WrongTokenAccount);
    if amount == 0 {
        return Ok(());
    }
    let mut data = Vec::with_capacity(9);
    data.push(3); // SPL Token Transfer
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(source.key(), false),
            AccountMeta::new(destination.key(), false),
            AccountMeta::new_readonly(authority.key(), true),
        ],
        data,
    };
    let infos = [
        source.to_account_info(),
        destination.to_account_info(),
        authority,
        token_program.to_account_info(),
    ];
    if let Some(seeds) = signer_seeds {
        invoke_signed(&ix, &infos, &[seeds])?;
    } else {
        invoke(&ix, &infos)?;
    }
    Ok(())
}

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub fee_bps: u16,
}
#[event]
pub struct ConfigUpdated {
    pub fee_bps: u16,
    pub paused: bool,
}
#[event]
pub struct CampaignCreated {
    pub campaign: Pubkey,
    pub id: u64,
    pub close_ts: i64,
    pub principal_cap: u64,
    pub max_positions: u16,
}
#[event]
pub struct Deposited {
    pub campaign: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub shares: u64,
    pub eligible_after_slot: u64,
}
#[event]
pub struct MockValueChanged {
    pub campaign: Pubkey,
    pub amount: u64,
    pub value: u64,
    pub shortfall: bool,
}
#[event]
pub struct MockLossRecorded {
    pub campaign: Pubkey,
    pub amount: u64,
    pub value: u64,
    pub shortfall: bool,
}
#[event]
pub struct ShortfallDetected {
    pub campaign: Pubkey,
    pub value: u64,
    pub principal: u64,
}
#[event]
pub struct YieldHarvested {
    pub campaign: Pubkey,
    pub yield_amount: u64,
    pub fee: u64,
    pub prize: u64,
    pub prize_balance: u64,
}
#[event]
pub struct DrawCommitted {
    pub campaign: Pubkey,
    pub shares: u64,
    pub positions: u16,
    pub prize: u64,
    pub slot: u64,
}
#[event]
pub struct DrawSettled {
    pub campaign: Pubkey,
    pub winner: Pubkey,
    pub winning_share: u64,
    pub prize: u64,
}
#[event]
pub struct CampaignCancelled {
    pub campaign: Pubkey,
    pub returned_prize: u64,
    pub shortfall: bool,
}
#[event]
pub struct Withdrawn {
    pub campaign: Pubkey,
    pub owner: Pubkey,
    pub shares: u64,
    pub amount: u64,
    pub remaining_principal: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,
    #[account(init, payer = upgrade_authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::LosslessV1>,
    #[account(constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key()) @ E::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    /// CHECK: initialized six-decimal classic SPL mint, validated by handler.
    #[account(owner = TOKEN_PROGRAM_ID)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: token owner and mint are validated by handler.
    pub treasury_token: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ E::Unauthorized)]
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
    /// CHECK: PDA token vault initialized by the classic Token program.
    #[account(init, payer = admin, space = 165, owner = TOKEN_PROGRAM_ID, seeds = [PRINCIPAL_SEED, campaign.key().as_ref()], bump)]
    pub principal_vault: UncheckedAccount<'info>,
    /// CHECK: separate prize-only token vault.
    #[account(init, payer = admin, space = 165, owner = TOKEN_PROGRAM_ID, seeds = [PRIZE_SEED, campaign.key().as_ref()], bump)]
    pub prize_vault: UncheckedAccount<'info>,
    /// CHECK: no instruction can withdraw from the mock loss sink.
    #[account(init, payer = admin, space = 165, owner = TOKEN_PROGRAM_ID, seeds = [LOSS_SEED, campaign.key().as_ref()], bump)]
    pub loss_vault: UncheckedAccount<'info>,
    /// CHECK: configuration-pinned mint.
    #[account(address = config.mint, owner = TOKEN_PROGRAM_ID)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    #[account(init, payer = owner, space = 8 + Position::INIT_SPACE, seeds = [POSITION_SEED, campaign.key().as_ref(), owner.key().as_ref()], bump)]
    pub position: Account<'info, Position>,
    /// CHECK: source token-account owner and mint are validated.
    #[account(mut)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: campaign's principal vault.
    #[account(mut, address = campaign.principal_vault, seeds = [PRINCIPAL_SEED, campaign.key().as_ref()], bump)]
    pub principal_vault: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MockValueChange<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ E::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: admin-owned test token account.
    #[account(mut)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: campaign's principal vault.
    #[account(mut, address = campaign.principal_vault, seeds = [PRINCIPAL_SEED, campaign.key().as_ref()], bump)]
    pub principal_vault: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MockLoss<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ E::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: campaign's principal vault.
    #[account(mut, address = campaign.principal_vault, seeds = [PRINCIPAL_SEED, campaign.key().as_ref()], bump)]
    pub principal_vault: UncheckedAccount<'info>,
    /// CHECK: inaccessible simulated-loss sink.
    #[account(mut, address = campaign.loss_vault, seeds = [LOSS_SEED, campaign.key().as_ref()], bump)]
    pub loss_vault: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Harvest<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: principal-only token vault.
    #[account(mut, address = campaign.principal_vault, seeds = [PRINCIPAL_SEED, campaign.key().as_ref()], bump)]
    pub principal_vault: UncheckedAccount<'info>,
    /// CHECK: prize-only token vault.
    #[account(mut, address = campaign.prize_vault, seeds = [PRIZE_SEED, campaign.key().as_ref()], bump)]
    pub prize_vault: UncheckedAccount<'info>,
    /// CHECK: configured treasury token account.
    #[account(mut, address = config.treasury_token)]
    pub treasury_token: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CommitDraw<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
pub struct SettleDraw<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: prize-only vault.
    #[account(mut, address = campaign.prize_vault, seeds = [PRIZE_SEED, campaign.key().as_ref()], bump)]
    pub prize_vault: UncheckedAccount<'info>,
    /// CHECK: must be owned by the selected position owner and the configured mint.
    #[account(mut)]
    pub winner_token: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelCampaign<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: principal-only vault.
    #[account(mut, address = campaign.principal_vault, seeds = [PRINCIPAL_SEED, campaign.key().as_ref()], bump)]
    pub principal_vault: UncheckedAccount<'info>,
    /// CHECK: prize-only vault.
    #[account(mut, address = campaign.prize_vault, seeds = [PRIZE_SEED, campaign.key().as_ref()], bump)]
    pub prize_vault: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CAMPAIGN_SEED, &campaign.id.to_le_bytes()], bump = campaign.bump)]
    pub campaign: Account<'info, Campaign>,
    #[account(mut, has_one = campaign, has_one = owner, seeds = [POSITION_SEED, campaign.key().as_ref(), owner.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    /// CHECK: principal-only vault.
    #[account(mut, address = campaign.principal_vault, seeds = [PRINCIPAL_SEED, campaign.key().as_ref()], bump)]
    pub principal_vault: UncheckedAccount<'info>,
    /// CHECK: prize-only vault used for open-shortfall withdrawals.
    #[account(mut, address = campaign.prize_vault, seeds = [PRIZE_SEED, campaign.key().as_ref()], bump)]
    pub prize_vault: UncheckedAccount<'info>,
    /// CHECK: owner's token account with the configured mint.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: fixed classic SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harvest_split_conserves_only_positive_yield_under_cap() {
        for yield_amount in [0, 1, 39, 10_000, u64::MAX] {
            let (fee, prize) = split_yield(yield_amount, MAX_FEE_BPS).unwrap();
            assert_eq!(fee + prize, yield_amount);
            assert!(fee as u128 * 10_000 <= yield_amount as u128 * MAX_FEE_BPS as u128);
        }
        assert_eq!(split_yield(10_000, 250).unwrap(), (250, 9_750));
        assert!(split_yield(1, 251).is_err());
    }

    #[test]
    fn proportional_withdrawals_preserve_the_same_shortfall_ratio() {
        let first = withdrawal_amount(50, 90, 100).unwrap();
        let second = withdrawal_amount(50, 90 - first, 50).unwrap();
        assert_eq!((first, second), (45, 45));
        assert_eq!(withdrawal_amount(100, 100, 100).unwrap(), 100);
        assert!(withdrawal_amount(101, 100, 100).is_err());
        assert!(withdrawal_amount(1, 1, 0).is_err());
    }

    #[test]
    fn draw_mapping_is_repeatable_bounded_and_rejects_the_modulo_tail() {
        let seed = [7; 32];
        for supply in [1, 2, 3, 7, 69, u32::MAX as u64, u64::MAX] {
            let index = uniform_index(&seed, supply).unwrap();
            assert!(index < supply);
            assert_eq!(index, uniform_index(&seed, supply).unwrap());
        }
        let n = 3u128;
        let rejected = ((u64::MAX as u128 % n) + 1) % n;
        let inclusive_limit = u64::MAX - rejected as u64;
        assert_eq!((inclusive_limit as u128 + 1) % n, 0);
        assert!(index_from_word(inclusive_limit, 3).is_some());
        assert_eq!(index_from_word(inclusive_limit + 1, 3), None);
        assert!(uniform_index(&seed, 0).is_err());
        assert!(uniform_index(&[0xff; 32], u64::MAX).is_err());
    }
}
