import { getChains, type ChainInfo } from "../api.js";
import { resolveToken } from "./resolve-token.js";
import { getGasToken } from "./chain-utils.js";

let chainsCache: ChainInfo[] | null = null;
let cachedAt = 0;
const TTL = 5 * 60 * 1000;

async function getChainName(chainId: number): Promise<string | undefined> {
  const now = Date.now();
  if (!chainsCache || now - cachedAt > TTL) {
    chainsCache = await getChains();
    cachedAt = now;
  }
  return chainsCache.find((c) => c.id === chainId)?.name;
}

interface GetSwapUrlParams {
  srcChainId: number;
  dstChainId: number;
  srcTokenAddress?: string;
  dstTokenAddress?: string;
  amount?: string;
}

/**
 * Resolve a token to the correct URL representation:
 * - Native gas tokens (address="" or omitted) → symbol alias (BTC, HYPE, SOL, etc.)
 * - Non-EVM tokens → synthetic EVM address via resolve-token
 * - EVM tokens → address as-is
 */
async function resolveTokenForUrl(
  chainId: number,
  address: string | undefined
): Promise<string | undefined> {
  // No address or empty = native gas token → use symbol alias
  if (!address || address === "") {
    const gas = getGasToken(chainId);
    return gas?.symbol;
  }

  // Try to resolve non-EVM addresses to synthetic EVM addresses
  const resolved = await resolveToken(chainId, address);
  return resolved?.address ?? address;
}

export async function getSwapUrl(params: GetSwapUrlParams): Promise<string> {
  const { srcChainId, dstChainId, srcTokenAddress, dstTokenAddress, amount } = params;

  const srcChainName = await getChainName(srcChainId);
  const dstChainName = await getChainName(dstChainId);

  if (!srcChainName) throw new Error(`Unknown source chain ID: ${srcChainId}`);
  if (!dstChainName) throw new Error(`Unknown destination chain ID: ${dstChainId}`);

  const url = new URL("https://app.symbiosis.finance/swap");
  url.searchParams.set("chainIn", srcChainName);
  url.searchParams.set("chainOut", dstChainName);

  const srcToken = await resolveTokenForUrl(srcChainId, srcTokenAddress);
  const dstToken = await resolveTokenForUrl(dstChainId, dstTokenAddress);

  if (srcToken) url.searchParams.set("tokenIn", srcToken);
  if (dstToken) url.searchParams.set("tokenOut", dstToken);
  if (amount) url.searchParams.set("amountIn", amount);

  // UTM tracking for MCP referrals
  url.searchParams.set("utm_source", "mcp");
  url.searchParams.set("utm_medium", "agent");
  url.searchParams.set("utm_campaign", "swap");

  return url.toString();
}
