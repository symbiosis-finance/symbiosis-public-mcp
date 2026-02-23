import { getChains, type ChainInfo } from "../api.js";

let cached: ChainInfo[] | null = null;
let cachedAt = 0;
const TTL = 5 * 60 * 1000; // 5 minutes

export async function getSupportedChains(): Promise<ChainInfo[]> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL) return cached;
  cached = await getChains();
  cachedAt = now;
  return cached;
}
