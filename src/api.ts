const API_BASE = "https://api.symbiosis.finance/crosschain";
const PARTNER_ID = "mcp";

export interface TokenInfo {
  symbol: string;
  name: string;
  icon: string;
  address: string;
  chainId: number;
  decimals: number;
  priceUsd: number;
  attributes?: Record<string, string>;
}

export interface ChainInfo {
  id: number;
  name: string;
  explorer: string;
  icon: string;
}

export interface SwapTokenBase {
  chainId: number;
  address: string;
  decimals: number;
  attributes?: Record<string, string>;
}

export interface SwapRequest {
  tokenAmountIn: SwapTokenBase & { amount: string };
  tokenOut: SwapTokenBase;
  from: string;
  to: string;
  slippage: number;
  partnerId?: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as { message?: string }).message ?? res.statusText;
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return body as T;
}

export async function getChains(): Promise<ChainInfo[]> {
  return fetchJson<ChainInfo[]>(`${API_BASE}/v1/chains`);
}

export async function getTokens(): Promise<TokenInfo[]> {
  return fetchJson<TokenInfo[]>(`${API_BASE}/v1/tokens`);
}

export async function getSwapLimits(): Promise<
  Array<{ chainId: number; address: string; min: string; max: string; decimals: number }>
> {
  return fetchJson(`${API_BASE}/v1/swap-limits`);
}

// Bitcoin chain ID for detecting v2 API usage
const BTC_CHAIN_ID = 3652501241;

function needsV2(srcChainId: number, dstChainId: number): boolean {
  return srcChainId === BTC_CHAIN_ID || dstChainId === BTC_CHAIN_ID;
}

export async function getSwap(req: SwapRequest): Promise<Record<string, unknown>> {
  const body = { ...req, partnerId: req.partnerId ?? PARTNER_ID };

  if (needsV2(req.tokenAmountIn.chainId, req.tokenOut.chainId)) {
    return fetchJson(`${API_BASE}/v2/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  return fetchJson(`${API_BASE}/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getQuoteV2(req: SwapRequest): Promise<Record<string, unknown>> {
  const body = { ...req, partnerId: req.partnerId ?? PARTNER_ID };
  return fetchJson(`${API_BASE}/v2/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
