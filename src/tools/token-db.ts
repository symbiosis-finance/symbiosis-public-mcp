import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

interface CompactToken {
  c: number;   // chainId
  s: string;   // symbol
  n: string;   // name
  a: string;   // address (synthetic EVM for non-EVM chains)
  d: number;   // decimals
  t?: Record<string, string>;  // attributes (native addresses: solana, ton)
}

export interface TokenEntry {
  chainId: number;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  attributes?: Record<string, string>;
}

let db: TokenEntry[] | null = null;

function loadDb(): TokenEntry[] {
  if (db) return db;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const dbPath = join(__dirname, "..", "data", "tokens-db.json");

  const raw: CompactToken[] = JSON.parse(readFileSync(dbPath, "utf8"));
  db = raw.map((t) => ({
    chainId: t.c,
    symbol: t.s,
    name: t.n,
    address: t.a,
    decimals: t.d,
    ...(t.t && { attributes: t.t }),
  }));
  return db;
}

export function getAllTokens(): TokenEntry[] {
  return loadDb();
}

export function findTokenByAddress(chainId: number, address: string): TokenEntry | undefined {
  const tokens = loadDb();

  // Try matching by synthetic EVM address
  const byAddr = tokens.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === address.toLowerCase()
  );
  if (byAddr) return byAddr;

  // Try matching by native address in attributes (solana, ton)
  return tokens.find(
    (t) =>
      t.chainId === chainId &&
      t.attributes &&
      Object.values(t.attributes).some((v) => v.toLowerCase() === address.toLowerCase())
  );
}

export function searchTokensInDb(params: {
  query: string;
  chainId?: number;
  limit?: number;
}): TokenEntry[] {
  const { query, chainId, limit = 10 } = params;
  const tokens = loadDb();
  const q = query.toLowerCase().trim();

  let filtered = chainId ? tokens.filter((t) => t.chainId === chainId) : tokens;

  // Address search (exact match)
  if (q.startsWith("0x") || q.length > 30) {
    // By synthetic address
    const byAddr = filtered.filter((t) => t.address.toLowerCase() === q);
    if (byAddr.length > 0) return byAddr.slice(0, limit);
    // By native address in attributes
    const byAttr = filtered.filter(
      (t) => t.attributes && Object.values(t.attributes).some((v) => v.toLowerCase() === q)
    );
    if (byAttr.length > 0) return byAttr.slice(0, limit);
  }

  // Priority-based text search
  const exactSymbol: TokenEntry[] = [];
  const exactName: TokenEntry[] = [];
  const prefixSymbol: TokenEntry[] = [];
  const substringName: TokenEntry[] = [];

  for (const t of filtered) {
    const sym = t.symbol.toLowerCase();
    const name = t.name.toLowerCase();
    if (sym === q) {
      exactSymbol.push(t);
    } else if (name === q) {
      exactName.push(t);
    } else if (sym.startsWith(q)) {
      prefixSymbol.push(t);
    } else if (name.includes(q)) {
      substringName.push(t);
    }
  }

  return [...exactSymbol, ...exactName, ...prefixSymbol, ...substringName].slice(0, limit);
}
