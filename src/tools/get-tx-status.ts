const API_BASE = "https://api.symbiosis.finance/crosschain";
const EXPLORER_BASE = "https://explorer.symbiosis.finance/transactions";

export interface TxStatus {
  status: unknown;
  explorerUrl: string;
  [key: string]: unknown;
}

export function getSymbiosisExplorerUrl(chainId: number, txHash: string): string {
  return `${EXPLORER_BASE}/${chainId}/${txHash}`;
}

export async function getTxStatus(
  chainId: number,
  transactionHash: string,
): Promise<TxStatus> {
  const explorerUrl = getSymbiosisExplorerUrl(chainId, transactionHash);
  const res = await fetch(`${API_BASE}/v1/tx/${chainId}/${transactionHash}`);

  // 404 = not indexed yet, normal during first 1-2 minutes
  if (res.status === 404) {
    return {
      status: { code: -1, text: "Not indexed yet" },
      explorerUrl,
      _note: "The transaction has not been indexed yet. This is normal within the first 1-2 minutes after sending. Keep polling.",
    };
  }

  const body = await res.json();

  if (!res.ok) {
    const msg = (body as { message?: string }).message ?? res.statusText;
    throw new Error(`API ${res.status}: ${msg}`);
  }

  return {
    ...(body as TxStatus),
    explorerUrl,
  };
}
