import { getBalance } from "./program.ts";

/** What one devnet balance read found: the address it was read for, and either that address's balance or the fact it could not be read. */
export interface BalanceLanding {
  address: string;
  balance?: bigint;
  unreadable: boolean;
}

/** The shared read as every funding surface sees it: the newest landing, and whether a newer read is still in flight. */
export interface BalanceState {
  landing?: BalanceLanding;
  reading: boolean;
}

/**
 * The one devnet balance read behind every funding surface, with no React in it so its rules can be held against a
 * scripted RPC. The newest request wins however late an older one lands; a landing carries the address it was read for, so
 * a read still in flight for the wallet the user just switched away from cannot speak for the new one; a failed read lands
 * `unreadable` rather than a zero balance, because a failed RPC is not an empty wallet; and starting a read only raises
 * `reading`, so a re-read holds the landing it already has until the newest one replaces it. `read()` with no address
 * clears the read: a disconnected wallet has no balance to claim. Nothing here decides anything about payment, and nothing
 * here starts a read by itself, so every surface asks for the read it needs.
 */
export function createBalanceRead(
  publish: (patch: Partial<BalanceState>) => void,
  source: (address: string) => Promise<bigint> = getBalance,
) {
  let newest = 0;
  const read = async (address?: string): Promise<void> => {
    const mine = ++newest; // a read still in flight from here on is stale, whoever it was for
    if (!address) { publish({ landing: undefined, reading: false }); return; }
    publish({ reading: true });
    try {
      const balance = await source(address);
      if (mine === newest) publish({ landing: { address, balance, unreadable: false }, reading: false });
    } catch {
      if (mine === newest) publish({ landing: { address, unreadable: true }, reading: false });
    }
  };
  return { read };
}
