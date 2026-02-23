import { getSwap as apiGetSwap, type SwapRequest } from "../api.js";
import { resolveToken } from "./resolve-token.js";
import {
  getAllowance,
  encodeApproveCalldata,
  MAX_UINT256,
  buildTxParams,
  type TxParams,
} from "../services/evm-utils.js";
import { getRpcUrls } from "../services/rpc-service.js";
import { getChainType, isNativeToken, resolveDecimals, parseUnits } from "./chain-utils.js";
import { getWalletAddress } from "../services/wallet.js";

// --- Types ---

export interface GetSwapCalldataParams {
  srcChainId: number;
  srcTokenAddress: string;
  srcTokenDecimals?: number;
  amount: string;             // human-readable (e.g. "1.5", "100")
  dstChainId: number;
  dstTokenAddress: string;
  dstTokenDecimals?: number;
  from?: string;              // optional if PRIVATE_KEY is set
  to?: string;                // optional if PRIVATE_KEY is set
  slippage?: number;
}

interface ApproveTx {
  to: string;           // token contract
  data: string;         // approve calldata
  value: "0x0";
  chainId: string;
  txParams: TxParams;
  _note: string;
}

interface SwapTx {
  to: string;
  data: string;
  value: string;
  chainId: string;
  txParams: TxParams;
}

export interface SwapCalldataResult {
  // Approve tx (if needed, null otherwise)
  approveTx: ApproveTx | null;
  // Swap tx
  swapTx: SwapTx;
  // Extra metadata
  approveTo: string | null;
  rpcs: string[];
  _instructions: string;
  // BTC-specific (v2)
  depositAddress?: string;
  depositAddressExpiry?: unknown;
  // All other fields from the API (fee, priceImpact, tokenAmountOut, etc.)
  [key: string]: unknown;
}

export async function getSwapCalldata(params: GetSwapCalldataParams): Promise<SwapCalldataResult> {
  const {
    srcChainId,
    srcTokenAddress,
    amount,
    dstChainId,
    dstTokenAddress,
    slippage = 200,
  } = params;

  // Client-side validation
  if (slippage < 10) {
    throw new Error(`Slippage ${slippage} bps (${slippage / 100}%) is too low. Minimum is 10 bps (0.1%). Recommended: 200 bps (2%).`);
  }
  if (slippage > 5000) {
    throw new Error(`Slippage ${slippage} bps (${slippage / 100}%) is too high. Maximum is 5000 bps (50%). Recommended: 200 bps (2%).`);
  }

  // Resolve decimals
  const srcTokenDecimals = params.srcTokenDecimals ?? resolveDecimals(srcChainId, srcTokenAddress);
  const dstTokenDecimals = params.dstTokenDecimals ?? resolveDecimals(dstChainId, dstTokenAddress);
  if (srcTokenDecimals === null) {
    throw new Error(`Cannot determine decimals for source token ${srcTokenAddress} on chain ${srcChainId}. Provide srcTokenDecimals explicitly.`);
  }
  if (dstTokenDecimals === null) {
    throw new Error(`Cannot determine decimals for destination token ${dstTokenAddress} on chain ${dstChainId}. Provide dstTokenDecimals explicitly.`);
  }

  // Convert human-readable amount to smallest units
  const amountSmallestUnits = parseUnits(amount, srcTokenDecimals);
  if (amountSmallestUnits === "0") {
    throw new Error("Amount must be greater than 0.");
  }

  // Auto-fill from/to from PRIVATE_KEY if not provided
  const walletAddr = getWalletAddress();
  const from = params.from || walletAddr;
  const to = params.to || walletAddr;
  if (!from || !to) {
    throw new Error("'from' and 'to' are required. Either provide them explicitly or set PRIVATE_KEY in environment.");
  }

  const srcResolved = await resolveToken(srcChainId, srcTokenAddress);
  const dstResolved = await resolveToken(dstChainId, dstTokenAddress);

  const req: SwapRequest = {
    tokenAmountIn: {
      chainId: srcChainId,
      address: srcResolved?.address ?? srcTokenAddress,
      decimals: srcTokenDecimals,
      amount: amountSmallestUnits,
      ...(srcResolved?.attributes && { attributes: srcResolved.attributes }),
    },
    tokenOut: {
      chainId: dstChainId,
      address: dstResolved?.address ?? dstTokenAddress,
      decimals: dstTokenDecimals,
      ...(dstResolved?.attributes && { attributes: dstResolved.attributes }),
    },
    from,
    to,
    slippage,
  };

  let result: Record<string, unknown>;
  try {
    result = await apiGetSwap(req);
  } catch (err) {
    throw new Error(enrichSwapError((err as Error).message, { srcChainId, dstChainId, humanAmount: amount }));
  }

  const tx = result.tx as { to: string; data: string; value: string; chainId?: number } | undefined;
  const approveTo = (result.approveTo as string) || null;
  const isCrossChain = srcChainId !== dstChainId;

  // Get RPCs for source chain
  const rpcs = getRpcUrls(srcChainId, 3);

  // --- Check approve (only for EVM, non-native tokens) ---
  let approveTx: ApproveTx | null = null;
  const srcChainType = getChainType(srcChainId);
  const tokenAddr = srcResolved?.address ?? srcTokenAddress;

  if (
    approveTo &&
    srcChainType === "evm" &&
    !isNativeToken(tokenAddr)
  ) {
    try {
      const allowance = await getAllowance(srcChainId, tokenAddr, from, approveTo);
      const amountBn = BigInt(amountSmallestUnits);

      if (allowance < amountBn) {
        // Need approve — use max uint256 for one-time unlimited approval
        const approveData = encodeApproveCalldata(approveTo, MAX_UINT256);

        let approveTxParams: TxParams;
        try {
          approveTxParams = await buildTxParams(srcChainId, from, tokenAddr, approveData, "0x0");
        } catch {
          approveTxParams = {
            chainId: "0x" + srcChainId.toString(16),
            nonce: "0x0",
            gasPrice: "0x0",
            gasLimit: null,
          };
        }

        approveTx = {
          to: tokenAddr,
          data: approveData,
          value: "0x0",
          chainId: "0x" + srcChainId.toString(16),
          txParams: approveTxParams,
          _note: "APPROVE REQUIRED: Sign and send this transaction FIRST. Wait until it is mined before sending the swap transaction.",
        };
      }
    } catch (err) {
      // If allowance check fails, inform the agent but don't block
      approveTx = {
        to: tokenAddr,
        data: encodeApproveCalldata(approveTo, MAX_UINT256),
        value: "0x0",
        chainId: "0x" + srcChainId.toString(16),
        txParams: {
          chainId: "0x" + srcChainId.toString(16),
          nonce: "0x0",
          gasPrice: "0x0",
          gasLimit: null,
        },
        _note: `Could not verify allowance (${(err as Error).message}). You may need to approve first. Use the approve data above if the swap transaction fails with an allowance error.`,
      };
    }
  }

  // --- Build swap tx params ---
  let swapTxParams: TxParams;
  if (tx && srcChainType === "evm") {
    try {
      swapTxParams = await buildTxParams(
        srcChainId,
        from,
        tx.to,
        tx.data,
        tx.value,
      );
      // If approve is needed, the nonce for swap = approve nonce + 1
      if (approveTx && approveTx.txParams.nonce !== "0x0") {
        const approveNonce = BigInt(approveTx.txParams.nonce);
        swapTxParams.nonce = "0x" + (approveNonce + 1n).toString(16);
      }
    } catch {
      swapTxParams = {
        chainId: "0x" + srcChainId.toString(16),
        nonce: "0x0",
        gasPrice: "0x0",
        gasLimit: null,
      };
    }
  } else {
    swapTxParams = {
      chainId: "0x" + srcChainId.toString(16),
      nonce: "0x0",
      gasPrice: "0x0",
      gasLimit: null,
    };
  }

  // --- Build instructions ---
  const parts: string[] = [];
  if (approveTx) {
    parts.push("1) Sign and send the approveTx FIRST. Wait for it to be mined.");
    parts.push("2) Then sign and send the swapTx.");
  } else {
    parts.push("Sign and send the swapTx to execute the swap.");
  }
  if (isCrossChain) {
    parts.push(`This is a CROSS-CHAIN swap. After the source tx is mined, use get_tx_status with chainId=${srcChainId} and the tx hash to track completion. Swaps typically complete within 1 minute, max 10 minutes. The user can also track status at https://explorer.symbiosis.finance/transactions/${srcChainId}/{txHash} (replace {txHash} with the actual hash after sending).`);
  } else {
    parts.push("This is a SAME-CHAIN swap. Once the tx is mined, the swap is complete. No need to track cross-chain status.");
  }
  if (swapTxParams.gasLimit === null) {
    const reason = swapTxParams.estimateGasError
      ? ` Reason: ${swapTxParams.estimateGasError}.`
      : "";
    parts.push(`CRITICAL WARNING: estimateGas failed — the transaction will almost certainly REVERT if sent.${reason} Common causes: insufficient balance, wrong token address, or missing token approval. Do NOT proceed with signing unless you understand and fix the cause. Suggest the user to check their balance or use get_swap_url as a fallback.`);
  }

  // --- Extract BTC v2 fields ---
  const depositAddress = (result.depositAddress as string) || undefined;
  const depositAddressExpiry = result.depositAddressExpiry || undefined;

  // --- Build clean result ---
  const {
    tx: _tx,
    approveTo: _at,
    depositAddress: _da,
    depositAddressExpiry: _dae,
    ...quoteFields
  } = result;

  return {
    ...quoteFields,
    approveTx,
    swapTx: tx
      ? {
          to: tx.to,
          data: tx.data,
          value: tx.value || "0x0",
          chainId: "0x" + srcChainId.toString(16),
          txParams: swapTxParams,
        }
      : {
          to: "",
          data: "",
          value: "0x0",
          chainId: "0x" + srcChainId.toString(16),
          txParams: swapTxParams,
        },
    approveTo,
    rpcs,
    _instructions: parts.join(" "),
    ...(depositAddress && { depositAddress }),
    ...(depositAddressExpiry && { depositAddressExpiry }),
  };
}

function enrichSwapError(
  msg: string,
  ctx: { srcChainId: number; dstChainId: number; humanAmount: string },
): string {
  const lower = msg.toLowerCase();

  if (lower.includes("swap amount less than fee") || lower.includes("amount less than fee")) {
    return `${msg}. The amount ${ctx.humanAmount} is too small to cover cross-chain fees. Try a larger amount.`;
  }

  if (lower.includes("no route")) {
    return `${msg}. No swap route found. Check chain IDs and token addresses are correct.`;
  }

  if (lower.includes("oops") || lower.includes("try again")) {
    return `${msg}. Common causes: wrong token decimals, unsupported chain pair, invalid token address, or amount too large for liquidity. Verify token address and decimals.`;
  }

  return msg;
}
