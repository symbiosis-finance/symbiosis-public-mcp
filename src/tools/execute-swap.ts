import { getSwapCalldata, type GetSwapCalldataParams } from "./get-swap-calldata.js";
import { signTransaction } from "./sign-transaction.js";
import { broadcastTransaction, type BroadcastResult } from "./broadcast-transaction.js";
import { waitForReceipt } from "../services/evm-utils.js";

export interface ExecuteSwapResult {
  // Quote info
  summary?: string;
  tokenAmountOut?: unknown;
  fee?: unknown;
  estimatedTime?: number;
  priceImpact?: unknown;
  // Approve tx (if was needed)
  approveTx?: {
    txHash: string;
    mined: boolean;
    receipt?: BroadcastResult["receipt"];
    explorerUrl: string | null;
  };
  // Swap tx
  swapTx: {
    txHash: string;
    mined: boolean;
    receipt?: BroadcastResult["receipt"];
    explorerUrl: string | null;
  };
  // Cross-chain tracking
  _tracking?: string;
  _note: string;
}

export async function executeSwap(
  params: GetSwapCalldataParams,
): Promise<ExecuteSwapResult> {
  // 1. Get calldata (from/to auto-filled from wallet inside getSwapCalldata)
  const calldata = await getSwapCalldata(params);

  // 2. Abort if estimateGas failed — tx will revert
  if (calldata.swapTx.txParams.gasLimit === null) {
    const reason = calldata.swapTx.txParams.estimateGasError
      ? `: ${calldata.swapTx.txParams.estimateGasError}`
      : "";
    throw new Error(
      `estimateGas failed for swap transaction${reason}. ` +
      `The transaction will almost certainly revert. ` +
      `Common causes: insufficient balance, wrong token address, or missing approval. ` +
      `Check balance with get_balances or use get_swap_url as a fallback.`
    );
  }

  const srcChainId = params.srcChainId;

  // 3. Handle approve if needed
  let approveResult: ExecuteSwapResult["approveTx"];

  if (calldata.approveTx) {
    const approveTx = calldata.approveTx;

    // Abort if approve estimateGas also failed
    if (approveTx.txParams.gasLimit === null) {
      throw new Error(
        `estimateGas failed for approve transaction. ` +
        `Common causes: insufficient gas token balance or token contract issue.`
      );
    }

    // Sign approve
    const signedApprove = await signTransaction({
      chainId: srcChainId,
      to: approveTx.to,
      data: approveTx.data,
      value: "0x0",
    });

    // Broadcast approve
    const broadcastedApprove = await broadcastTransaction({
      chainId: srcChainId,
      signedTx: signedApprove.signedTx,
    });

    // If not mined yet, wait extra 15s
    if (!broadcastedApprove.mined) {
      const receipt = await waitForReceipt(srcChainId, broadcastedApprove.txHash, 15000);
      if (receipt) {
        broadcastedApprove.mined = true;
        broadcastedApprove.receipt = {
          status: receipt.status as string,
          gasUsed: receipt.gasUsed as string,
          blockNumber: receipt.blockNumber as string,
        };
      }
    }

    // Check if approve reverted
    if (broadcastedApprove.receipt?.status === "0x0") {
      throw new Error(
        `Approve transaction reverted (tx: ${broadcastedApprove.txHash}). ` +
        `The token contract rejected the approval. Check the explorer for details.`
      );
    }

    // If still not mined, we can't safely proceed
    if (!broadcastedApprove.mined) {
      throw new Error(
        `Approve transaction not mined within 25 seconds (tx: ${broadcastedApprove.txHash}). ` +
        `Cannot proceed with swap until approve is confirmed. ` +
        `Check status at: ${broadcastedApprove.explorerUrl || "explorer"}`
      );
    }

    approveResult = {
      txHash: broadcastedApprove.txHash,
      mined: true,
      receipt: broadcastedApprove.receipt,
      explorerUrl: broadcastedApprove.explorerUrl,
    };
  }

  // 4. Sign and broadcast swap
  const swapTx = calldata.swapTx;

  const signedSwap = await signTransaction({
    chainId: srcChainId,
    to: swapTx.to,
    data: swapTx.data,
    value: swapTx.value,
  });

  const broadcastedSwap = await broadcastTransaction({
    chainId: srcChainId,
    signedTx: signedSwap.signedTx,
  });

  // 5. Build result
  const isCrossChain = params.srcChainId !== params.dstChainId;

  const result: ExecuteSwapResult = {
    swapTx: {
      txHash: broadcastedSwap.txHash,
      mined: broadcastedSwap.mined,
      receipt: broadcastedSwap.receipt,
      explorerUrl: broadcastedSwap.explorerUrl,
    },
    _note: broadcastedSwap.mined
      ? broadcastedSwap.receipt?.status === "0x1"
        ? "Swap transaction sent and mined successfully."
        : "Swap transaction mined but REVERTED. Check the explorer for details."
      : "Swap transaction sent but not yet mined. Check the explorer for status.",
  };

  if (calldata._summary) result.summary = calldata._summary as string;
  if (calldata.tokenAmountOut) result.tokenAmountOut = calldata.tokenAmountOut;
  if (calldata.fee) result.fee = calldata.fee;
  if (calldata.estimatedTime) result.estimatedTime = calldata.estimatedTime as number;
  if (calldata.priceImpact) result.priceImpact = calldata.priceImpact;
  if (approveResult) result.approveTx = approveResult;

  if (isCrossChain) {
    result._tracking =
      `Cross-chain swap: use get_tx_status with chainId=${srcChainId} and txHash="${broadcastedSwap.txHash}" to track completion. ` +
      `Explorer: https://explorer.symbiosis.finance/transactions/${srcChainId}/${broadcastedSwap.txHash}`;
  }

  return result;
}
