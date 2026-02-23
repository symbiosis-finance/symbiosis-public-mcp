import { Interface } from "ethers";
import { rpcCallWithFallback } from "../services/evm-utils.js";
import { getRpcUrls } from "../services/rpc-service.js";
import { getAllTokens, type TokenEntry } from "./token-db.js";
import { getChainType, getGasToken, isNativeToken } from "./chain-utils.js";
import { getSupportedChains } from "./get-chains.js";

// --- Constants ---

const BATCH_SIZE = 300; // Same as web-app
const CHAIN_TIMEOUT = 15_000; // 15s per chain (web-app uses 5s but has dedicated RPCs)

// Multicall addresses from Symbiosis JS SDK (not all chains use the standard 0xcA11)
const MULTICALL_ADDRESSES: Record<number, string> = {
  1: "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696",
  56: "0xfF6FD90A470Aaa0c1B8A54681746b07AcdFedc9B",
  137: "0x275617327c958bD06b5D6b871E7f491D76113dd8",
  43114: "0x29b6603d17b9d8f021ecb8845b6fd06e1adf89de",
  40: "0x53dC7535028e2fcaCa0d847AD108b9240C0801b1",
  2222: "0x30A62aA52Fa099C4B227869EB6aeaDEda054d121",
  288: "0xaeD5b25BE1c3163c907a471082640450F928DDFE",
  324: "0x52192C3De01535a9Ad2743A5Fe4f774868103C20",
  42161: "0x80c7dd17b01855a6d2347444a0fcc36136a314de",
  5000: "0xb55cc6B5B402437b66c13c0CEd0EF367aa7c26da",
  5165: "0xa385B1436fD2A6a1c6865E22c522A1aA40CaDCC6",
  4200: "0x45CFd6FB7999328F189aaD2739Fba4Be6C45E5bf",
  1625: "0xd8db4fb1fEf63045A443202d506Bcf30ef404160",
  223: "0xd8db4fb1fEf63045A443202d506Bcf30ef404160",
  388: "0x4c398CB4b7D4d31a54D254d8Aed09B9e8353E80E",
  2818: "0xd8db4fb1fEf63045A443202d506Bcf30ef404160",
  2741: "0xBf63C7944B1635c79a0f0eE7e07b1702837AD1F9",
  80094: "0xd8db4fb1fEf63045A443202d506Bcf30ef404160",
  130: "0xd8db4fb1fEf63045A443202d506Bcf30ef404160",
  1868: "0xd8db4fb1fEf63045A443202d506Bcf30ef404160",
  2345: "0xd8db4fb1fEf63045A443202d506Bcf30ef404160",
  747474: "0x6AEb9b27590387b8Fd0560C52f6B968C59C10Fab",
  9745: "0xd8db4fb1fEf63045A443202d506Bcf30ef404160",
  1565: "0x7E06D0CD8D3fDDBB875345dF389d986f810A49F6",
  167000: "0x076f5925112b13a4D4c70fc83d9019f1854e4415",
  // Standard Multicall3 address for most other chains
};
const DEFAULT_MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";

function getMulticallAddress(chainId: number): string {
  return MULTICALL_ADDRESSES[chainId] ?? DEFAULT_MULTICALL;
}

// --- ABI ---

const multicallIface = new Interface([
  "function tryAggregate(bool, tuple(address, bytes)[]) returns (tuple(bool, bytes)[])",
]);

const BALANCE_OF_SELECTOR = "0x70a08231";

// --- Types ---

export interface GetBalancesParams {
  address: string;
  chainIds?: number[];
}

export interface TokenBalance {
  symbol: string;
  name: string;
  address: string;
  balance: string;
}

export interface ChainBalances {
  chainId: number;
  chainName: string;
  tokens: TokenBalance[];
}

export interface GetBalancesResult {
  address: string;
  balances: ChainBalances[];
  skippedChains?: string[];
  _summary: string;
}

// --- Helpers ---

function formatUnits(value: bigint, decimals: number): string {
  if (value === 0n) return "0";
  if (decimals === 0) return value.toString();

  const str = value.toString();
  if (str.length <= decimals) {
    const fracPart = str.padStart(decimals, "0").replace(/0+$/, "");
    return fracPart ? `0.${fracPart}` : "0";
  }

  const intPart = str.slice(0, str.length - decimals);
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function encodeBalanceOf(address: string): string {
  return (
    BALANCE_OF_SELECTOR + address.slice(2).toLowerCase().padStart(64, "0")
  );
}

// Group tokens by chainId, excluding native tokens
function buildTokenIndex(): Map<number, TokenEntry[]> {
  const all = getAllTokens();
  const map = new Map<number, TokenEntry[]>();
  for (const t of all) {
    if (!t.address || isNativeToken(t.address)) continue;
    let list = map.get(t.chainId);
    if (!list) {
      list = [];
      map.set(t.chainId, list);
    }
    list.push(t);
  }
  return map;
}

// --- EVM chain balance fetching ---

async function fetchEvmChainBalances(
  chainId: number,
  address: string,
  tokens: TokenEntry[],
  chainName: string,
): Promise<ChainBalances | null> {
  const urls = getRpcUrls(chainId, 1);
  if (urls.length === 0) return null;

  const balances: TokenBalance[] = [];

  // 1. Native balance
  try {
    const { result } = await rpcCallWithFallback(
      chainId,
      "eth_getBalance",
      [address, "latest"],
      3,
    );
    const balance = BigInt((result as string) || "0x0");
    if (balance > 0n) {
      const gasToken = getGasToken(chainId);
      if (gasToken) {
        balances.push({
          symbol: gasToken.symbol,
          name: gasToken.symbol,
          address: "",
          balance: formatUnits(balance, gasToken.decimals),
        });
      }
    }
  } catch {
    // Chain might be down — skip
  }

  if (tokens.length === 0) {
    return balances.length > 0
      ? { chainId, chainName, tokens: balances }
      : null;
  }

  // 2. ERC-20 balances via Multicall — all batches in parallel
  const balanceOfData = encodeBalanceOf(address);
  const multicallAddr = getMulticallAddress(chainId);
  const batches: TokenEntry[][] = [];
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    batches.push(tokens.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      try {
        const calls = batch.map((t) => [t.address, balanceOfData]);
        const calldata = multicallIface.encodeFunctionData("tryAggregate", [
          false,
          calls,
        ]);

        const { result } = await rpcCallWithFallback(
          chainId,
          "eth_call",
          [{ to: multicallAddr, data: calldata }, "latest"],
          3,
        );

        const decoded = multicallIface.decodeFunctionResult(
          "tryAggregate",
          result as string,
        );
        const returnValues = decoded[0];
        const found: TokenBalance[] = [];

        for (let j = 0; j < returnValues.length; j++) {
          const success = returnValues[j][0] as boolean;
          const returnData = returnValues[j][1] as string;
          if (
            success &&
            returnData &&
            returnData !== "0x" &&
            returnData.length >= 66
          ) {
            try {
              const balance = BigInt(returnData);
              if (balance > 0n) {
                const token = batch[j];
                found.push({
                  symbol: token.symbol,
                  name: token.name,
                  address: token.address,
                  balance: formatUnits(balance, token.decimals),
                });
              }
            } catch {
              // malformed return data
            }
          }
        }
        return found;
      } catch {
        return [];
      }
    }),
  );

  for (const found of batchResults) {
    balances.push(...found);
  }

  return balances.length > 0 ? { chainId, chainName, tokens: balances } : null;
}

// --- Main entry point ---

export async function getBalances(
  params: GetBalancesParams,
): Promise<GetBalancesResult> {
  const { address } = params;

  // Get supported chains
  const chains = await getSupportedChains();
  const chainMap = new Map(chains.map((c) => [c.id, c.name]));

  // Filter chains
  let chainIds: number[];
  if (params.chainIds && params.chainIds.length > 0) {
    chainIds = params.chainIds;
  } else {
    chainIds = chains.map((c) => c.id);
  }

  // Separate EVM from non-EVM
  const evmChainIds: number[] = [];
  const skippedChains: string[] = [];
  for (const id of chainIds) {
    const type = getChainType(id);
    if (type === "evm" || type === "quai") {
      evmChainIds.push(id);
    } else {
      const name = chainMap.get(id) || `Chain ${id}`;
      skippedChains.push(`${name} (${type})`);
    }
  }

  // Build token index
  const tokenIndex = buildTokenIndex();

  // Fetch ALL chains in parallel (same as web-app), each with a 5s timeout
  const results = await Promise.all(
    evmChainIds.map((id) => {
      const name = chainMap.get(id) || `Chain ${id}`;
      const tokens = tokenIndex.get(id) || [];
      return Promise.race([
        fetchEvmChainBalances(id, address, tokens, name),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), CHAIN_TIMEOUT),
        ),
      ]).catch(() => null);
    }),
  );

  const allBalances: ChainBalances[] = [];
  for (const r of results) {
    if (r) allBalances.push(r);
  }

  // Sort: chains with more tokens first
  allBalances.sort((a, b) => b.tokens.length - a.tokens.length);

  // Build summary
  const totalTokens = allBalances.reduce((s, c) => s + c.tokens.length, 0);
  const chainCount = allBalances.length;
  let summary = `Found ${totalTokens} token${totalTokens !== 1 ? "s" : ""} with non-zero balance across ${chainCount} chain${chainCount !== 1 ? "s" : ""}`;
  if (skippedChains.length > 0) {
    summary += `. Skipped non-EVM: ${skippedChains.join(", ")}`;
  }

  return {
    address,
    balances: allBalances,
    ...(skippedChains.length > 0 && { skippedChains }),
    _summary: summary,
  };
}
