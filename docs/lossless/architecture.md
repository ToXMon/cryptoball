# Cryptoball lossless architecture diagram

Revised after `threat-model.md`. Money never moves on a dotted line.

## Money and trust

```mermaid
flowchart LR
  depositor[Depositor]
  sponsor[Sponsor]
  crank[Anyone crank]
  admin[Admin key]

  vault[Vault PDA]
  buffer[Idle USDC buffer]
  receipt[Receipt ATA]
  prize[Weekly prize ATA]
  grand[Grand pot ATA]
  ticket[Withdraw ticket]

  adapter[Allowlisted adapter]
  kamino[Kamino Earn USDC vault]
  sb[Switchboard account]

  depositor -->|deposit USDC| vault
  vault --> buffer
  vault -->|above buffer target| adapter
  adapter --> kamino
  adapter -->|receipt shares| receipt

  sponsor -->|USDC, no shares| prize
  receipt -->|harvest yield only| prize
  receipt -->|30 percent of yield| grand

  depositor -->|request withdraw| buffer
  buffer -->|shortfall vs instant| ticket
  ticket -->|claim when liquid| depositor

  crank -->|commit| sb
  sb -->|reveal| crank
  crank -->|settle one Deposit range| prize
  prize -->|owner payout plus crank tip| depositor
  grand -->|every 4th settle| depositor

  admin -.->|pause, params, adapter queue| vault
```

Solid arrows move tokens or open a ticket. The admin arrow is a config write. It does not touch principal, prize, or grand.

## Draw state

```mermaid
stateDiagram-v2
  [*] --> Open
  Open --> Committed: commit_draw if prize >= min
  Committed --> Open: settle_draw pays range owner
  Committed --> Open: cancel_draw after timeout
  Open --> Shortfall: harvest value < liabilities
  Shortfall --> Open: later harvest covers liabilities
```

Pause is a flag on top of these states. It blocks deposit and commit. It does not block withdraw, claim, settle, or cancel.

## Winner check

Commit stores `supply_snapshot` and the randomness account. The winning index is the revealed word reduced into `[0, supply_snapshot)` with rejection sampling. Settle passes one Deposit. The program pays only if `range_start <= index < range_start + shares` and `eligible_after <= commit_slot`. No loop over depositors.

## What the threat model removed from the diagram

No bridge box. No Jupiter swap. No lending-reserve account list. No admin withdrawal. No path from the prize ATA back into the adapter. Donations to the principal ATA are not an input to share price.
