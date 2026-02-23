import { findTokenByAddress } from "./token-db.js";

// Gas token info per chain: symbol and decimals
// Used for URL generation (symbol aliases) and quote mode (fake addresses)
const GAS_TOKENS: Record<number, { symbol: string; decimals: number }> = {
  // EVM chains (ETH gas)
  1: { symbol: "ETH", decimals: 18 },
  10: { symbol: "ETH", decimals: 18 },
  130: { symbol: "ETH", decimals: 18 },
  288: { symbol: "ETH", decimals: 18 },
  324: { symbol: "ETH", decimals: 18 },
  1868: { symbol: "ETH", decimals: 18 },
  8453: { symbol: "ETH", decimals: 18 },
  34443: { symbol: "ETH", decimals: 18 },
  42161: { symbol: "ETH", decimals: 18 },
  42170: { symbol: "ETH", decimals: 18 },
  59144: { symbol: "ETH", decimals: 18 },
  81457: { symbol: "ETH", decimals: 18 },
  167000: { symbol: "ETH", decimals: 18 },
  534352: { symbol: "ETH", decimals: 18 },
  810180: { symbol: "ETH", decimals: 18 },
  // BNB
  56: { symbol: "BNB", decimals: 18 },
  204: { symbol: "BNB", decimals: 18 },
  // Polygon
  137: { symbol: "POL", decimals: 18 },
  1101: { symbol: "ETH", decimals: 18 },
  // Avalanche
  43114: { symbol: "AVAX", decimals: 18 },
  // Cronos
  25: { symbol: "CRO", decimals: 18 },
  388: { symbol: "zkCRO", decimals: 18 },
  // Mantle
  5000: { symbol: "MNT", decimals: 18 },
  // KAVA
  2222: { symbol: "KAVA", decimals: 18 },
  // Telos
  40: { symbol: "TLOS", decimals: 18 },
  // Gnosis
  100: { symbol: "XDAI", decimals: 18 },
  // Metis
  1088: { symbol: "METIS", decimals: 18 },
  // CORE
  1116: { symbol: "CORE", decimals: 18 },
  // Sei
  1329: { symbol: "SEI", decimals: 18 },
  // Manta
  169: { symbol: "ETH", decimals: 18 },
  // Merlin
  4200: { symbol: "BTC", decimals: 18 },
  // ZetaChain
  7000: { symbol: "ZETA", decimals: 18 },
  // Blast
  // (81457 already listed above as ETH)
  // Sonic
  146: { symbol: "S", decimals: 18 },
  // Mode
  // (34443 already listed above as ETH)
  // Fraxtal
  252: { symbol: "frxETH", decimals: 18 },
  // Boba
  // (288 already listed above as ETH)
  // Gravity
  1625: { symbol: "G", decimals: 18 },
  // ApeChain
  33139: { symbol: "APE", decimals: 18 },
  // Morph
  2818: { symbol: "ETH", decimals: 18 },
  // Abstract
  2741: { symbol: "ETH", decimals: 18 },
  // Berachain
  80094: { symbol: "BERA", decimals: 18 },
  // Rootstock
  30: { symbol: "RBTC", decimals: 18 },
  // Bahamut
  5165: { symbol: "FTN", decimals: 18 },
  // B² Network
  223: { symbol: "BTC", decimals: 18 },
  // Katana
  747474: { symbol: "ETH", decimals: 18 },
  // Plasma
  9745: { symbol: "ETH", decimals: 18 },
  // Monad
  143: { symbol: "MON", decimals: 18 },
  // Goat
  2345: { symbol: "BTC", decimals: 18 },
  // Citrea
  4114: { symbol: "cBTC", decimals: 18 },
  // HyperEVM
  999: { symbol: "HYPE", decimals: 18 },
  // Quai
  9: { symbol: "QUAI", decimals: 18 },
  // Soneium (already listed as ETH)
  // Symbiosis
  13863860: { symbol: "SIS", decimals: 18 },
  // ZkLink (already listed as ETH)
  // Taiko (already listed as ETH)

  // Non-EVM
  5426: { symbol: "SOL", decimals: 9 },
  85918: { symbol: "TON", decimals: 9 },
  728126428: { symbol: "TRX", decimals: 6 },
  3652501241: { symbol: "BTC", decimals: 8 },
};

export function getGasToken(chainId: number): { symbol: string; decimals: number } | undefined {
  return GAS_TOKENS[chainId];
}

// --- Shared helpers ---

/** Check if an address represents a native gas token */
export function isNativeToken(address: string): boolean {
  return (
    address === "" ||
    address === "0x" ||
    address === "0x0000000000000000000000000000000000000000"
  );
}

/**
 * Resolve token decimals from chain gas tokens or token DB.
 * Returns null if token is not found (agent must provide decimals explicitly).
 */
export function resolveDecimals(chainId: number, address: string): number | null {
  if (isNativeToken(address)) {
    return GAS_TOKENS[chainId]?.decimals ?? null;
  }
  const token = findTokenByAddress(chainId, address);
  return token?.decimals ?? null;
}

/**
 * Convert human-readable amount to smallest units (wei/lamports/satoshis).
 * E.g. parseUnits("1.5", 18) → "1500000000000000000"
 */
export function parseUnits(value: string, decimals: number): string {
  const cleaned = value.replace(/,/g, "").replace(/\s/g, "").trim();

  if (!/^\d+\.?\d*$/.test(cleaned)) {
    throw new Error(
      `Invalid amount format: "${value}". Use a decimal number like "1.5" or "100".`
    );
  }

  const [intPart, fracPart = ""] = cleaned.split(".");

  if (fracPart.length > decimals) {
    throw new Error(
      `Amount "${value}" has ${fracPart.length} decimal places, but this token only supports ${decimals}.`
    );
  }

  const paddedFrac = fracPart.padEnd(decimals, "0");
  return (intPart + paddedFrac).replace(/^0+/, "") || "0";
}

// Chain type for selecting fake addresses and determining address format
export type ChainType = "evm" | "tron" | "ton" | "solana" | "btc" | "quai";

const CHAIN_TYPE_MAP: Record<number, ChainType> = {
  728126428: "tron",
  85918: "ton",
  5426: "solana",
  3652501241: "btc",
  9: "quai",
};

export function getChainType(chainId: number): ChainType {
  return CHAIN_TYPE_MAP[chainId] ?? "evm";
}

// Fake wallet addresses for quote-only mode (no real wallet needed)
// Copied exactly from the Symbiosis web app
const FAKE_ACCOUNTS: Record<ChainType, string> = {
  evm: "0x60f8948b075938aa1d4d23abfec8f2eb568c662e",
  tron: "TMMbCCfvH7kciqCqHNdq4vpDDPT1kRpDof",
  ton: "UQD35aoXN2UbZ1ZrjjjKsLNH-ISdp5Lj42d_0Q_pllYmRth0",
  solana: "EHCJTQgZqvFL1qeYPHUVDARfudVxjsyFjrPnPMJDwWc7",
  btc: "bc1qdshlmgwt9mvxwvnxvdmwxunnglndkjvvptruy7",
  quai: "0x005CAEEb3644c63f538432A7b6CBe99583F7a6e3",
};

export function getFakeAddress(chainId: number): string {
  return FAKE_ACCOUNTS[getChainType(chainId)];
}
