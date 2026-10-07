# RWA tokenization strategies

An RWA campaign is a second toy. It does not move a USDC deposit into another asset.

## Strategies

1. Receipt campaign. The player deposits USDY. Withdrawal returns the same number of USDY. The prize is the price increase harvested into a separate vault. USDY is not a $1 coin. Say that on the campaign page.
2. Supply campaign. The player deposits USDC. The adapter supplies a credit token such as Maple `syrupUSDC`. Harvest only the increase. Cap the campaign. The borrower is a credit book, not a Treasury bill.
3. Excluded from principal. Kamino `kicUSDC` targets 7%+ from commodity trade finance. The issuer says the deposit can be lost. It is not an adapter. OnRe `ONyc` loops and sUSDai multiply positions are borrowed. They fail the harvest check.

## Order

- Now: mock adapter, then Kamino USDC and Jupiter Lend USDC.
- Next: JitoSOL campaign, prize in SOL.
- After 19 October 2026, if the Nysa USDY market is live: USDY receipt campaign.
- Later, capped: `syrupUSDC`.
- Never as principal: commodity vault, leveraged loops.

## Tokenization rule

The campaign token is a receipt for the deposit, or the deposit itself. It is not a new share that rebases the player's balance. Rebase hides whether the withdrawal matched the deposit. A separate prize vault is easier to audit.
