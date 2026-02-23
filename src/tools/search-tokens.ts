import { searchTokensInDb, type TokenEntry } from "./token-db.js";
import { getGasToken } from "./chain-utils.js";

interface SearchParams {
  query: string;
  chainId?: number;
  limit?: number;
}

// Map gas token symbols to their primary chain IDs and chain names
// Used to inject native gas token results when agents search by symbol
const NATIVE_TOKEN_CHAINS: Record<string, Array<{ chainId: number; name: string }>> = {
  ETH: [
    { chainId: 1, name: "Ethereum" },
    { chainId: 42161, name: "Arbitrum" },
    { chainId: 10, name: "Optimism" },
    { chainId: 8453, name: "Base" },
    { chainId: 324, name: "zkSync" },
    { chainId: 59144, name: "Linea" },
    { chainId: 534352, name: "Scroll" },
    { chainId: 81457, name: "Blast" },
  ],
  BNB: [{ chainId: 56, name: "BNB Chain" }],
  POL: [{ chainId: 137, name: "Polygon" }],
  AVAX: [{ chainId: 43114, name: "Avalanche" }],
  SOL: [{ chainId: 5426, name: "Solana" }],
  BTC: [{ chainId: 3652501241, name: "Bitcoin" }],
  TON: [{ chainId: 85918, name: "TON" }],
  TRX: [{ chainId: 728126428, name: "Tron" }],
  HYPE: [{ chainId: 999, name: "HyperEVM" }],
  MNT: [{ chainId: 5000, name: "Mantle" }],
  S: [{ chainId: 146, name: "Sonic" }],
  BERA: [{ chainId: 80094, name: "Berachain" }],
  SEI: [{ chainId: 1329, name: "Sei" }],
  CORE: [{ chainId: 1116, name: "CORE" }],
  KAVA: [{ chainId: 2222, name: "KAVA" }],
  TLOS: [{ chainId: 40, name: "Telos" }],
  APE: [{ chainId: 33139, name: "ApeChain" }],
  ZETA: [{ chainId: 7000, name: "ZetaChain" }],
  MON: [{ chainId: 143, name: "Monad" }],
};

function getNativeTokenResults(query: string, chainId?: number): TokenEntry[] {
  const q = query.toUpperCase().trim();
  const results: TokenEntry[] = [];

  for (const [symbol, chains] of Object.entries(NATIVE_TOKEN_CHAINS)) {
    if (symbol !== q) continue;
    for (const { chainId: cid, name } of chains) {
      if (chainId && chainId !== cid) continue;
      const gas = getGasToken(cid);
      if (!gas) continue;
      results.push({
        chainId: cid,
        symbol: gas.symbol,
        name: `${name} native token`,
        address: "",
        decimals: gas.decimals,
      });
    }
  }

  return results;
}

export async function searchTokens(params: SearchParams): Promise<TokenEntry[]> {
  const { query, chainId, limit = 10 } = params;

  // Inject native gas token results first (most common agent need)
  const nativeResults = getNativeTokenResults(query, chainId);
  const dbResults = searchTokensInDb(params);

  // Native results go first, DB results follow (including wrapped versions — user may want those)
  return [...nativeResults, ...dbResults].slice(0, limit);
}
