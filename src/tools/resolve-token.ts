import { findTokenByAddress, type TokenEntry } from "./token-db.js";

// Non-EVM chain IDs where tokens use synthetic EVM addresses
const NON_EVM_CHAINS = new Set([
  5426,       // Solana
  85918,      // TON
]);

export interface ResolvedToken {
  address: string;         // Synthetic EVM address (for URLs and API)
  decimals?: number;
  attributes?: Record<string, string>;
}

/**
 * For non-EVM chains (Solana, TON), resolve native addresses to synthetic EVM addresses.
 * The Symbiosis API and web app require synthetic EVM addresses, not native chain addresses.
 *
 * - If the address is already a synthetic EVM address (0x...), verify it and add attributes.
 * - If the address is a native chain address (base58, EQ...), look it up and return the synthetic one.
 * - For EVM chains and Tron, no resolution is needed — pass through as-is.
 */
export async function resolveToken(
  chainId: number,
  address: string
): Promise<ResolvedToken | null> {
  // Not a non-EVM chain — no resolution needed
  if (!NON_EVM_CHAINS.has(chainId)) return null;

  // Native gas token (empty string) — no resolution needed
  if (address === "") return null;

  const match = findTokenByAddress(chainId, address);
  if (match) {
    return {
      address: match.address,
      decimals: match.decimals,
      attributes: match.attributes,
    };
  }

  // No match found — token might not be in the database
  return null;
}
