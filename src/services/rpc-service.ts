import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getSupportedChains } from "../tools/get-chains.js";

// --- Types ---

interface ChainlistEntry {
  id: number;
  name: string;
  short: string;
  sym: string;     // chain symbol (ETH, BSC, etc.)
  gas: string;     // native currency symbol
  rpcs: string[];
}

export interface ValidatedRpc {
  url: string;
  latencyMs: number;
}

interface ChainRpcData {
  chainId: number;
  name: string;
  shortName: string;
  chainSymbol: string;
  gasSymbol: string;
  rpcs: ValidatedRpc[];       // sorted by latency (best first)
  lastValidated: number;       // timestamp
}

// --- State ---

let chainRpcMap = new Map<number, ChainRpcData>();
let allChainlistEntries: ChainlistEntry[] = [];
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const REFRESH_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours
const BLOCK_STALENESS_LIMIT = 20 * 60;         // 20 minutes in seconds
const VALIDATION_BATCH_SIZE = 15;
const CHAIN_PARALLEL = 5;                        // validate 5 chains simultaneously
const MAX_RPCS_PER_CHAIN = 20;                   // don't validate more than 20 RPCs per chain
const RPC_TIMEOUT = 5000;                        // 5s per RPC check

// --- Load local fallback ---

function loadLocalRpcs(): ChainlistEntry[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const dbPath = join(__dirname, "..", "data", "rpcs.json");
  return JSON.parse(readFileSync(dbPath, "utf8"));
}

// --- Fetch from chainlist.org ---

async function fetchChainlistRpcs(): Promise<ChainlistEntry[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch("https://chainlist.org/rpcs.json", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const raw: Array<Record<string, unknown>> = await res.json() as Array<Record<string, unknown>>;

    const entries: ChainlistEntry[] = raw
      .filter((e) => (e as { isTestnet?: boolean }).isTestnet !== true)
      .map((e) => {
        const rpcs = ((e.rpc || []) as Array<string | { url: string }>)
          .map((r) => (typeof r === "object" ? r.url : r))
          .filter(
            (url): url is string =>
              typeof url === "string" &&
              url.startsWith("http") &&
              !url.includes("${") &&
              !url.includes("{") &&
              !url.includes("API_KEY") &&
              !url.includes("api_key") &&
              !url.includes("INFURA") &&
              !url.includes("ALCHEMY")
          );
        if (rpcs.length === 0) return null;
        return {
          id: (e as { chainId: number }).chainId,
          name: (e as { name: string }).name,
          short: (e as { shortName: string }).shortName || "",
          sym: (e as { chain: string }).chain || "",
          gas: ((e as { nativeCurrency?: { symbol: string } }).nativeCurrency?.symbol) || "",
          rpcs,
        };
      })
      .filter((e): e is ChainlistEntry => e !== null);

    return entries;
  } catch {
    console.error("[rpc-service] Failed to fetch from chainlist.org, using local fallback");
    return null;
  }
}

// --- Validate a single RPC ---

async function validateRpc(
  url: string,
): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: ["latest", false],
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs };

    const data = (await res.json()) as {
      result?: { timestamp?: string };
    };
    if (!data.result?.timestamp) return { ok: false, latencyMs };

    const blockTime = parseInt(data.result.timestamp, 16);
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - blockTime > BLOCK_STALENESS_LIMIT) {
      return { ok: false, latencyMs };
    }

    return { ok: true, latencyMs };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

// --- Validate RPCs for a chain in batches ---

async function validateChainRpcs(rpcs: string[]): Promise<ValidatedRpc[]> {
  const toCheck = rpcs.slice(0, MAX_RPCS_PER_CHAIN);
  const good: ValidatedRpc[] = [];

  for (let i = 0; i < toCheck.length; i += VALIDATION_BATCH_SIZE) {
    const batch = toCheck.slice(i, i + VALIDATION_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (url) => {
        const result = await validateRpc(url);
        return { url, ...result };
      })
    );
    for (const r of results) {
      if (r.ok) good.push({ url: r.url, latencyMs: r.latencyMs });
    }
  }

  good.sort((a, b) => a.latencyMs - b.latencyMs);
  return good;
}

// --- Refresh all RPCs ---

async function validateEntries(entries: ChainlistEntry[]): Promise<void> {
  // Validate chains in parallel (CHAIN_PARALLEL at a time)
  for (let i = 0; i < entries.length; i += CHAIN_PARALLEL) {
    const batch = entries.slice(i, i + CHAIN_PARALLEL);
    await Promise.all(
      batch.map(async (entry) => {
        const validated = await validateChainRpcs(entry.rpcs);
        if (validated.length > 0 || !chainRpcMap.has(entry.id)) {
          chainRpcMap.set(entry.id, {
            chainId: entry.id,
            name: entry.name,
            shortName: entry.short,
            chainSymbol: entry.sym,
            gasSymbol: entry.gas,
            rpcs: validated.length > 0 ? validated : chainRpcMap.get(entry.id)?.rpcs ?? [],
            lastValidated: Date.now(),
          });
        }
      })
    );
  }
}

async function refreshAll(): Promise<void> {
  console.error("[rpc-service] Starting RPC refresh...");

  // Get Symbiosis-supported chain IDs
  let symbiosisChainIds: Set<number>;
  try {
    const chains = await getSupportedChains();
    symbiosisChainIds = new Set(chains.map((c) => c.id));
  } catch {
    symbiosisChainIds = new Set(chainRpcMap.keys());
  }

  // 1. Validate local entries first (fast, no network wait for chainlist)
  const localToValidate = allChainlistEntries.filter((e) =>
    symbiosisChainIds.has(e.id)
  );
  console.error(`[rpc-service] Validating RPCs for ${localToValidate.length} Symbiosis chains...`);
  await validateEntries(localToValidate);

  const totalGoodLocal = Array.from(chainRpcMap.values()).reduce(
    (s, c) => s + c.rpcs.filter((r) => r.latencyMs > 0).length,
    0
  );
  console.error(`[rpc-service] Local validation done: ${totalGoodLocal} working RPCs`);

  // 2. Try to fetch fresh data from chainlist.org (don't block on failure)
  const fresh = await fetchChainlistRpcs();
  if (fresh) {
    allChainlistEntries = fresh;
    const freshToValidate = fresh.filter((e) => symbiosisChainIds.has(e.id));
    console.error(`[rpc-service] Fetched ${fresh.length} chains from chainlist.org, validating ${freshToValidate.length}...`);
    await validateEntries(freshToValidate);
  }

  const totalGood = Array.from(chainRpcMap.values()).reduce(
    (s, c) => s + c.rpcs.filter((r) => r.latencyMs > 0).length,
    0
  );
  console.error(
    `[rpc-service] Refresh complete: ${chainRpcMap.size} chains, ${totalGood} working RPCs`
  );
}

// --- Public API ---

/** Initialize the RPC service: load data, start background validation */
export function initRpcService(): void {
  // Load local fallback immediately (sync, for instant availability)
  try {
    allChainlistEntries = loadLocalRpcs();
    // Populate map with unvalidated RPCs so get_rpcs works even before validation
    for (const entry of allChainlistEntries) {
      chainRpcMap.set(entry.id, {
        chainId: entry.id,
        name: entry.name,
        shortName: entry.short,
        chainSymbol: entry.sym,
        gasSymbol: entry.gas,
        rpcs: entry.rpcs.map((url) => ({ url, latencyMs: -1 })), // -1 = not validated
        lastValidated: 0,
      });
    }
    console.error(`[rpc-service] Loaded ${allChainlistEntries.length} chains from local DB`);
  } catch (err) {
    console.error("[rpc-service] Failed to load local RPCs:", err);
  }

  // Start background validation
  refreshAll().catch((err) =>
    console.error("[rpc-service] Initial refresh failed:", err)
  );

  // Schedule periodic refresh
  refreshTimer = setInterval(() => {
    refreshAll().catch((err) =>
      console.error("[rpc-service] Periodic refresh failed:", err)
    );
  }, REFRESH_INTERVAL);

  // Don't hold the process open
  if (refreshTimer.unref) refreshTimer.unref();
}

/** Get validated RPCs for a chain. Search by chainId, name, shortName, or gas symbol. */
export function getRpcs(
  query: string | number,
  count: number = 3,
): { chainId: number; chainName: string; rpcs: ValidatedRpc[] } | { error: string; candidates?: Array<{ chainId: number; name: string }> } {
  // Search by chain ID
  if (typeof query === "number") {
    const data = chainRpcMap.get(query);
    if (!data) return { error: `No RPCs found for chain ID ${query}` };
    return {
      chainId: data.chainId,
      chainName: data.name,
      rpcs: data.rpcs.slice(0, count),
    };
  }

  // Search by name/symbol (case-insensitive, strip stray quotes)
  const q = query.toLowerCase().trim().replace(/^["']+|["']+$/g, "");
  const matches: ChainRpcData[] = [];

  for (const data of chainRpcMap.values()) {
    if (
      data.chainId.toString() === q ||
      data.name.toLowerCase() === q ||
      data.shortName.toLowerCase() === q ||
      data.chainSymbol.toLowerCase() === q ||
      data.gasSymbol.toLowerCase() === q
    ) {
      matches.push(data);
    }
  }

  // Fuzzy: also match partial name
  if (matches.length === 0) {
    for (const data of chainRpcMap.values()) {
      if (data.name.toLowerCase().includes(q)) {
        matches.push(data);
      }
    }
  }

  if (matches.length === 0) {
    return { error: `No chain found matching "${query}"` };
  }

  if (matches.length > 1) {
    // Prefer Symbiosis-supported chains (common chain IDs that Symbiosis supports)
    const symbiosisChainIds = new Set([
      1, 10, 25, 30, 40, 56, 100, 130, 137, 143, 146, 169, 204, 223, 252, 288,
      324, 388, 999, 1088, 1101, 1116, 1329, 1625, 1868, 2222, 2345, 2741, 2818,
      4114, 4200, 5000, 5165, 5426, 7000, 8453, 9, 9745, 33139, 34443, 42161,
      42170, 43114, 59144, 80094, 81457, 85918, 167000, 534352, 728126428,
      747474, 810180, 3652501241, 13863860,
    ]);

    const symbiosisMatches = matches.filter((m) => symbiosisChainIds.has(m.chainId));

    // If exactly one Symbiosis-supported chain matches, use it
    if (symbiosisMatches.length === 1) {
      const data = symbiosisMatches[0];
      return {
        chainId: data.chainId,
        chainName: data.name,
        rpcs: data.rpcs.slice(0, count),
      };
    }

    // If multiple Symbiosis chains match, narrow to those
    const candidates = symbiosisMatches.length > 1 ? symbiosisMatches : matches;
    return {
      error: `Ambiguous query "${query}" matches ${candidates.length} chains. Please specify the chain ID.`,
      candidates: candidates.map((m) => ({ chainId: m.chainId, name: m.name })),
    };
  }

  const data = matches[0];
  return {
    chainId: data.chainId,
    chainName: data.name,
    rpcs: data.rpcs.slice(0, count),
  };
}

/** Get RPCs for a chain by ID (internal use — returns just URLs, best first) */
export function getRpcUrls(chainId: number, count: number = 5): string[] {
  const data = chainRpcMap.get(chainId);
  if (!data) return [];
  return data.rpcs.slice(0, count).map((r) => r.url);
}

// --- Runtime latency tracking ---
// These functions dynamically reorder RPCs based on actual request performance,
// so slow/broken RPCs get pushed to the end between validation cycles.

/** Sort RPCs: validated (low latency) → unvalidated → penalized (high latency) */
function sortRpcs(rpcs: ValidatedRpc[]): void {
  rpcs.sort((a, b) => {
    const ak = a.latencyMs < 0 ? 4999 : a.latencyMs; // unvalidated between good and bad
    const bk = b.latencyMs < 0 ? 4999 : b.latencyMs;
    return ak - bk;
  });
}

/** Penalize a slow or failed RPC — push it down the priority list */
export function penalizeRpc(chainId: number, url: string): void {
  const data = chainRpcMap.get(chainId);
  if (!data) return;
  const rpc = data.rpcs.find((r) => r.url === url);
  if (!rpc) return;
  // Set latency to at least 10s, cap at 30s
  rpc.latencyMs = Math.min(30_000, Math.max(10_000, (rpc.latencyMs > 0 ? rpc.latencyMs : 5000) * 2));
  sortRpcs(data.rpcs);
}

/** Update RPC latency based on actual successful response (exponential moving average) */
export function rewardRpc(chainId: number, url: string, latencyMs: number): void {
  const data = chainRpcMap.get(chainId);
  if (!data) return;
  const rpc = data.rpcs.find((r) => r.url === url);
  if (!rpc) return;
  // EMA: 70% new measurement, 30% old — fast convergence to actual performance
  rpc.latencyMs = rpc.latencyMs <= 0
    ? latencyMs
    : Math.round(rpc.latencyMs * 0.3 + latencyMs * 0.7);
  sortRpcs(data.rpcs);
}

/** Get all chain entries (for search) */
export function getAllRpcChains(): Array<{ chainId: number; name: string; rpcCount: number }> {
  return Array.from(chainRpcMap.values()).map((d) => ({
    chainId: d.chainId,
    name: d.name,
    rpcCount: d.rpcs.length,
  }));
}
