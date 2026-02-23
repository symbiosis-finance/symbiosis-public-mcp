import { getSwap as apiGetSwap, type SwapRequest } from "../api.js";
import { resolveToken } from "./resolve-token.js";
import { getFakeAddress, getGasToken, resolveDecimals, parseUnits } from "./chain-utils.js";
import { findTokenByAddress } from "./token-db.js";

interface GetQuoteParams {
  srcChainId: number;
  srcTokenAddress: string;
  srcTokenDecimals?: number;
  amount: string;           // human-readable (e.g. "1.5", "100")
  dstChainId: number;
  dstTokenAddress: string;
  dstTokenDecimals?: number;
  slippage?: number;
}

export async function getQuote(params: GetQuoteParams): Promise<Record<string, unknown>> {
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
  if (srcChainId === dstChainId && srcTokenAddress === dstTokenAddress) {
    throw new Error("Source and destination tokens are the same. Use different tokens or different chains.");
  }

  // Resolve decimals (auto from DB, or use provided override)
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

  const from = getFakeAddress(srcChainId);
  const to = getFakeAddress(dstChainId);

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
    throw new Error(enrichApiError((err as Error).message, { srcChainId, dstChainId, humanAmount: amount }));
  }

  // Strip calldata — this is quote-only
  const {
    tx: _tx,
    approveTo: _approveTo,
    ...quoteData
  } = result;

  // Resolve token symbols for summary (API returns "tokenOut" placeholder in quote-only mode)
  const srcSymbol = resolveSymbol(srcChainId, srcTokenAddress);
  const dstSymbol = resolveSymbol(dstChainId, dstTokenAddress);

  // Build human-readable summary for the agent
  const summary = buildSummary(result, srcTokenDecimals, dstTokenDecimals, amount, srcSymbol, dstSymbol, true);

  return {
    ...quoteData,
    ...(summary && { _summary: summary }),
    _note: "Quote only — no wallet addresses provided. Use get_swap_calldata with 'from' and 'to' to get executable transaction data.",
  };
}

function resolveSymbol(chainId: number, address: string): string {
  // Native gas token
  if (address === "" || address === "0x" || address === "0x0000000000000000000000000000000000000000") {
    return getGasToken(chainId)?.symbol ?? "tokens";
  }
  // Look up in DB
  const token = findTokenByAddress(chainId, address);
  return token?.symbol ?? "tokens";
}

function buildSummary(
  result: Record<string, unknown>,
  srcDecimals: number,
  dstDecimals: number,
  inputAmount: string,
  srcSymbol: string,
  dstSymbol: string,
  inputIsHumanReadable: boolean = false,
): string | null {
  try {
    const tokenAmountOut = result.tokenAmountOut as { amount?: string; symbol?: string; decimals?: number } | undefined;
    if (!tokenAmountOut?.amount) return null;

    const outDecimals = tokenAmountOut.decimals ?? dstDecimals;
    const rawOutAmount = formatUnits(tokenAmountOut.amount, outDecimals);
    // Trim to reasonable precision (max 8 decimal places)
    const outAmount = trimDecimals(rawOutAmount, 8);
    // API returns "tokenOut" placeholder in quote-only mode — use resolved symbol
    const apiOutSymbol = tokenAmountOut.symbol;
    const outSymbol = (apiOutSymbol && apiOutSymbol !== "tokenOut" && apiOutSymbol !== "tokenIn")
      ? apiOutSymbol
      : dstSymbol;

    const tokenAmountIn = result.tokenAmountIn as { symbol?: string } | undefined;
    const apiInSymbol = tokenAmountIn?.symbol;
    const inSymbol = (apiInSymbol && apiInSymbol !== "tokenIn" && apiInSymbol !== "tokenOut")
      ? apiInSymbol
      : srcSymbol;
    const inAmount = inputIsHumanReadable
      ? trimDecimals(inputAmount, 8)
      : trimDecimals(formatUnits(inputAmount, srcDecimals), 8);

    // Fee info
    const fee = result.fee as { amount?: string; symbol?: string; decimals?: number; priceUsd?: number } | undefined;
    let feeStr = "";
    if (fee?.amount && fee.decimals) {
      const feeAmount = formatUnits(fee.amount, fee.decimals);
      feeStr = `, fee: ${feeAmount} ${fee.symbol ?? ""}`;
      if (fee.priceUsd && fee.priceUsd > 0) {
        const feeUsd = (parseFloat(feeAmount) * fee.priceUsd).toFixed(2);
        feeStr = `, fee: ~$${feeUsd}`;
      }
    }

    // Estimated time
    const estimatedTime = result.estimatedTime as number | undefined;
    const timeStr = estimatedTime ? `, ~${estimatedTime < 60 ? estimatedTime + "s" : Math.round(estimatedTime / 60) + "min"}` : "";

    return `${inAmount} ${inSymbol} → ${outAmount} ${outSymbol}${feeStr}${timeStr}`;
  } catch {
    return null;
  }
}

/** Enrich vague API errors with actionable context */
function enrichApiError(
  msg: string,
  ctx: { srcChainId: number; dstChainId: number; humanAmount: string },
): string {
  const lower = msg.toLowerCase();

  if (lower.includes("swap amount less than fee") || lower.includes("amount less than fee")) {
    return `${msg}. The amount ${ctx.humanAmount} is too small to cover cross-chain fees. Try a larger amount (e.g. 10x more).`;
  }

  if (lower.includes("slippage too low")) {
    return `${msg}. Use 200 (2%) for most swaps, or 500 (5%) for volatile tokens.`;
  }

  if (lower.includes("no route available") || lower.includes("no route")) {
    return `${msg}. No swap route found for this token pair. Check that the chain IDs are correct and the tokens exist on those chains. For non-EVM chains (Solana, TON), only certain token pairs are supported.`;
  }

  if (lower.includes("oops") || lower.includes("try again")) {
    return `${msg}. Common causes: wrong token decimals, unsupported chain pair, invalid token address, or amount too large for available liquidity. Verify the token address and decimals match the actual on-chain token.`;
  }

  return msg;
}

function trimDecimals(value: string, maxDecimals: number): string {
  const dot = value.indexOf(".");
  if (dot === -1) return value;
  const trimmed = value.slice(0, dot + maxDecimals + 1).replace(/0+$/, "").replace(/\.$/, "");
  return trimmed || "0";
}

function formatUnits(amount: string, decimals: number): string {
  try {
    const str = amount.padStart(decimals + 1, "0");
    const intPart = str.slice(0, str.length - decimals) || "0";
    const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  } catch {
    return amount;
  }
}
