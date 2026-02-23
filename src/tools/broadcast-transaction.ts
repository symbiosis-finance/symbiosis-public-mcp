import { sendRawTransaction, waitForReceipt } from "../services/evm-utils.js";
import { getSupportedChains } from "./get-chains.js";

export interface BroadcastParams {
  chainId: number;
  signedTx: string;           // raw signed tx hex (from sign_transaction)
}

export interface BroadcastResult {
  txHash: string;
  chainId: number;
  rpcUsed: string;
  mined: boolean;
  explorerUrl: string | null;
  receipt?: {
    status: string;           // "0x1" = success, "0x0" = reverted
    gasUsed: string;
    blockNumber: string;
  };
  _note: string;
}

async function getExplorerUrl(chainId: number, txHash: string): Promise<string | null> {
  try {
    const chains = await getSupportedChains();
    const chain = chains.find((c) => c.id === chainId);
    if (!chain?.explorer) return null;
    const base = chain.explorer.endsWith("/") ? chain.explorer : chain.explorer + "/";
    return `${base}tx/${txHash}`;
  } catch {
    return null;
  }
}

export async function broadcastTransaction(
  params: BroadcastParams,
): Promise<BroadcastResult> {
  const { chainId, signedTx } = params;

  // Send via RPCs with fallback
  const { txHash, rpcUrl } = await sendRawTransaction(chainId, signedTx);
  const explorerUrl = await getExplorerUrl(chainId, txHash);

  // Wait up to 10s for mining
  const receipt = await waitForReceipt(chainId, txHash, 10000);

  if (!receipt) {
    return {
      txHash,
      chainId,
      rpcUsed: rpcUrl,
      mined: false,
      explorerUrl,
      _note: "Transaction sent but not mined within 10 seconds. It should appear soon at the explorer URL.",
    };
  }

  const status = receipt.status as string;
  return {
    txHash,
    chainId,
    rpcUsed: rpcUrl,
    mined: true,
    explorerUrl,
    receipt: {
      status,
      gasUsed: receipt.gasUsed as string,
      blockNumber: receipt.blockNumber as string,
    },
    _note: status === "0x1"
      ? "Transaction mined successfully."
      : "Transaction mined but REVERTED. Check the explorer for details.",
  };
}
