import { Transaction } from "ethers";
import { getWallet } from "../services/wallet.js";
import {
  getNonce,
  getGasPrice,
  getMaxPriorityFeePerGas,
  estimateGas,
  rpcCallWithFallback,
} from "../services/evm-utils.js";

export interface SignTransactionParams {
  chainId: number;
  to: string;
  data: string;
  value?: string;            // hex or decimal string, default "0x0"
  // Optional overrides — if omitted, fetched from RPC
  nonce?: number;
  gasPrice?: string;          // hex
  gasLimit?: string;          // hex
  maxFeePerGas?: string;      // hex
  maxPriorityFeePerGas?: string; // hex
  type?: number;              // 0 = legacy, 2 = EIP-1559. Auto-detected if omitted.
}

export interface SignedTransactionResult {
  signedTx: string;           // raw signed tx hex, ready for broadcast
  txHash: string;             // pre-computed tx hash
  from: string;               // signer address
  chainId: number;
  nonce: number;
  gasPrice?: string;
  gasLimit: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  type: number;
}

export async function signTransaction(
  params: SignTransactionParams,
): Promise<SignedTransactionResult> {
  const wallet = getWallet();
  if (!wallet) throw new Error("PRIVATE_KEY not configured");

  const { chainId, to, data } = params;
  const rawValue = params.value ?? "0x0";
  // Normalize value to hex (API may return decimal strings like "5000000000000000")
  const value = rawValue.startsWith("0x") ? rawValue : "0x" + (BigInt(rawValue || "0").toString(16) || "0");

  // --- Resolve nonce ---
  let nonce: number;
  if (params.nonce !== undefined) {
    nonce = params.nonce;
  } else {
    const nonceHex = await getNonce(chainId, wallet.address);
    nonce = Number(BigInt(nonceHex));
  }

  // --- Resolve gas ---
  // Determine tx type
  let txType = params.type;
  if (txType === undefined) {
    // Auto-detect: if user provided EIP-1559 fields, use type 2
    if (params.maxFeePerGas || params.maxPriorityFeePerGas) {
      txType = 2;
    } else if (params.gasPrice) {
      txType = 0;
    } else {
      // Check if chain supports EIP-1559
      const priorityFee = await getMaxPriorityFeePerGas(chainId);
      txType = priorityFee ? 2 : 0;
    }
  }

  // Resolve gasLimit
  let gasLimit: bigint;
  if (params.gasLimit) {
    gasLimit = BigInt(params.gasLimit);
  } else {
    const gasResult = await estimateGas(chainId, {
      from: wallet.address,
      to,
      data,
      value,
    });
    if (gasResult.gas) {
      gasLimit = BigInt(gasResult.gas) * 2n;
    } else {
      throw new Error(
        `estimateGas failed — transaction will likely revert on-chain. ` +
        `Reason: ${gasResult.error ?? "unknown"}. ` +
        `Common causes: insufficient balance, wrong token address, or insufficient allowance. ` +
        `Override gasLimit manually to force-send.`
      );
    }
  }

  // Build tx
  let rawTx: Transaction;

  if (txType === 2) {
    // EIP-1559
    let maxPriorityFeePerGas: bigint;
    let maxFeePerGas: bigint;

    if (params.maxPriorityFeePerGas) {
      maxPriorityFeePerGas = BigInt(params.maxPriorityFeePerGas);
    } else {
      const pfHex = await getMaxPriorityFeePerGas(chainId);
      const pf = pfHex ? BigInt(pfHex) : 1000000000n; // 1 gwei fallback
      maxPriorityFeePerGas = (pf * 6n) / 5n; // 1.2x
      const minPriority = 100000000n; // 0.1 gwei floor
      if (maxPriorityFeePerGas < minPriority) maxPriorityFeePerGas = minPriority;
    }

    if (params.maxFeePerGas) {
      maxFeePerGas = BigInt(params.maxFeePerGas);
    } else {
      // baseFee * 2 + priority
      let baseFee: bigint;
      try {
        const { result: block } = await rpcCallWithFallback(chainId, "eth_getBlockByNumber", ["latest", false], 3);
        const blockData = block as { baseFeePerGas?: string };
        baseFee = blockData?.baseFeePerGas ? BigInt(blockData.baseFeePerGas) : BigInt(await getGasPrice(chainId));
      } catch {
        baseFee = BigInt(await getGasPrice(chainId));
      }
      maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
    }

    rawTx = Transaction.from({
      type: 2,
      to,
      data,
      value: BigInt(value),
      nonce,
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit,
      chainId,
    });
  } else {
    // Legacy (type 0)
    let gasPrice: bigint;
    if (params.gasPrice) {
      gasPrice = BigInt(params.gasPrice);
    } else {
      const gpHex = await getGasPrice(chainId);
      gasPrice = (BigInt(gpHex) * 6n) / 5n; // 1.2x
    }

    rawTx = Transaction.from({
      type: 0,
      to,
      data,
      value: BigInt(value),
      nonce,
      gasPrice,
      gasLimit,
      chainId,
    });
  }

  // Sign
  const signed = wallet.signingKey.sign(rawTx.unsignedHash);
  rawTx.signature = signed;

  const result: SignedTransactionResult = {
    signedTx: rawTx.serialized,
    txHash: rawTx.hash!,
    from: wallet.address,
    chainId,
    nonce,
    gasLimit: "0x" + gasLimit.toString(16),
    type: txType,
  };

  if (txType === 2) {
    result.maxFeePerGas = "0x" + rawTx.maxFeePerGas!.toString(16);
    result.maxPriorityFeePerGas = "0x" + rawTx.maxPriorityFeePerGas!.toString(16);
  } else {
    result.gasPrice = "0x" + rawTx.gasPrice!.toString(16);
  }

  return result;
}
