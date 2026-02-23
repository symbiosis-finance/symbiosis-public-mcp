import { Transaction } from "ethers";
import { getRpcUrls, penalizeRpc, rewardRpc } from "./rpc-service.js";

// --- Staggered RPC racing ---
//
// Instead of trying RPCs one-by-one (slow when one hangs), we use hedged requests:
// 1. Send request to the best (lowest-latency) RPC
// 2. If no response within a stagger delay, launch the next RPC in parallel
// 3. First successful response wins — all others are cancelled
// 4. Fast failures (RPC errors) immediately trigger the next attempt
// 5. RPCs that fail or timeout are penalized (pushed to end of list)
// 6. RPCs that respond are rewarded (latency updated via EMA)
//
// Stagger schedule (based on how many requests are already in-flight):
//   1-2 in-flight → wait 3s before next
//   3-4 in-flight → wait 5s before next
//   5+  in-flight → wait 10s before next
// Max concurrent: 6 requests
// Hard timeout per request: 15s
// Overall timeout: 30s (all pending cancelled, error returned)

const REQUEST_TIMEOUT = 15_000;
const OVERALL_TIMEOUT = 30_000;
const MAX_INFLIGHT = 6;

function staggerMs(inFlight: number): number {
  if (inFlight >= 5) return 10_000;
  if (inFlight >= 3) return 5_000;
  return 3_000;
}

// --- Low-level: single JSON-RPC call (for direct use with a known URL) ---

export async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
  timeoutMs: number = REQUEST_TIMEOUT,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await rpcCallRaw(rpcUrl, method, params, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

/** Raw JSON-RPC call with external abort signal */
async function rpcCallRaw(
  rpcUrl: string,
  method: string,
  params: unknown[],
  signal: AbortSignal,
): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`);
  }

  let data: { result?: unknown; error?: { message: string; code: number } };
  try {
    data = await res.json();
  } catch {
    throw new Error(`RPC returned non-JSON response`);
  }

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message} (code ${data.error.code})`);
  }
  if (data.result === undefined || data.result === null) {
    throw new Error(`RPC returned empty result for ${method}`);
  }
  return data.result;
}

// --- Staggered racing across multiple RPCs ---

interface RaceOptions {
  /** Return true for errors that should immediately abort all in-flight requests */
  isFatalError?: (err: Error) => boolean;
  /** Called when an RPC succeeds (for latency tracking) */
  onSuccess?: (url: string, latencyMs: number) => void;
  /** Called when an RPC fails or times out (for pessimization) */
  onFail?: (url: string) => void;
}

function rpcRace(
  urls: string[],
  method: string,
  params: unknown[],
  opts?: RaceOptions,
): Promise<{ result: unknown; rpcUrl: string }> {
  if (urls.length === 0) {
    return Promise.reject(new Error("No RPCs provided"));
  }

  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const startTimes = new Map<string, number>(); // url → start timestamp
    let nextIdx = 0;
    let inFlight = 0;
    let failures = 0;
    let settled = false;
    let lastError: Error | null = null;

    function cleanup() {
      settled = true;
      for (const c of controllers) c.abort();
      for (const t of timers) clearTimeout(t);
    }

    function checkAllDone() {
      if (inFlight === 0 && nextIdx >= urls.length) {
        cleanup();
        reject(
          new Error(
            `All ${failures} RPCs failed for ${method}. Last: ${lastError?.message}`,
          ),
        );
      }
    }

    // Overall timeout — hard cap, cancel everything
    const overallTimer = setTimeout(() => {
      if (!settled) {
        // Penalize all in-flight RPCs
        for (const [url] of startTimes) {
          opts?.onFail?.(url);
        }
        cleanup();
        reject(
          new Error(
            `Overall timeout (${OVERALL_TIMEOUT / 1000}s) exceeded for ${method}. ` +
            `Tried ${nextIdx} RPCs, ${failures} failed. Last: ${lastError?.message}`,
          ),
        );
      }
    }, OVERALL_TIMEOUT);
    timers.push(overallTimer);

    function launch() {
      if (settled || nextIdx >= urls.length || inFlight >= MAX_INFLIGHT) {
        return;
      }

      const url = urls[nextIdx++];
      const ctrl = new AbortController();
      controllers.push(ctrl);
      inFlight++;
      startTimes.set(url, Date.now());

      // Hard per-request timeout
      const reqTimer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
      timers.push(reqTimer);

      // Schedule next RPC with stagger delay
      if (nextIdx < urls.length && inFlight < MAX_INFLIGHT) {
        const delay = staggerMs(inFlight);
        const t = setTimeout(() => {
          if (!settled) launch();
        }, delay);
        timers.push(t);
      }

      rpcCallRaw(url, method, params, ctrl.signal)
        .then((result) => {
          clearTimeout(reqTimer);
          const latency = Date.now() - (startTimes.get(url) ?? Date.now());
          inFlight--;
          startTimes.delete(url);
          if (!settled) {
            opts?.onSuccess?.(url, latency);
            cleanup();
            resolve({ result, rpcUrl: url });
          }
        })
        .catch((err) => {
          clearTimeout(reqTimer);
          inFlight--;
          failures++;
          lastError = err as Error;
          startTimes.delete(url);

          if (settled) return;

          // Report failure for pessimization
          opts?.onFail?.(url);

          // Fatal error — abort everything immediately
          if (opts?.isFatalError?.(err as Error)) {
            cleanup();
            reject(err);
            return;
          }

          // Fast failure — try next immediately (don't wait for stagger)
          launch();
          checkAllDone();
        });
    }

    // Launch first request immediately
    launch();
  });
}

/** Try RPC call across multiple endpoints with staggered racing */
export async function rpcCallWithFallback(
  chainId: number,
  method: string,
  params: unknown[] = [],
  maxAttempts: number = 10,
): Promise<{ result: unknown; rpcUrl: string }> {
  const urls = getRpcUrls(chainId, maxAttempts);
  if (urls.length === 0) {
    throw new Error(`No RPCs available for chain ${chainId}`);
  }
  return rpcRace(urls, method, params, {
    onSuccess: (url, latencyMs) => rewardRpc(chainId, url, latencyMs),
    onFail: (url) => penalizeRpc(chainId, url),
  });
}

// --- High-level helpers ---

export async function getGasPrice(chainId: number): Promise<string> {
  const { result } = await rpcCallWithFallback(chainId, "eth_gasPrice");
  if (!result) throw new Error(`eth_gasPrice returned empty result for chain ${chainId}`);
  return result as string; // hex
}

export async function getMaxPriorityFeePerGas(chainId: number): Promise<string | null> {
  try {
    const { result } = await rpcCallWithFallback(chainId, "eth_maxPriorityFeePerGas");
    return result as string; // hex
  } catch {
    return null; // Not all chains support EIP-1559
  }
}

export async function getNonce(chainId: number, address: string): Promise<string> {
  const { result } = await rpcCallWithFallback(chainId, "eth_getTransactionCount", [address, "pending"]);
  if (!result) throw new Error(`eth_getTransactionCount returned empty result for chain ${chainId}`);
  return result as string; // hex
}

/** Normalize a value to hex: handles decimal strings, hex strings, and undefined */
function toHexValue(value?: string): string {
  if (!value || value === "0x0" || value === "0x" || value === "0") return "0x0";
  if (value.startsWith("0x")) return value;
  // Decimal string → hex
  try {
    return "0x" + BigInt(value).toString(16);
  } catch {
    return "0x0";
  }
}

export interface EstimateGasResult {
  gas: string | null;
  error?: string;
}

export async function estimateGas(
  chainId: number,
  tx: { from: string; to: string; data: string; value?: string },
): Promise<EstimateGasResult> {
  try {
    const rpcTx = { ...tx, value: toHexValue(tx.value) };
    const { result } = await rpcCallWithFallback(chainId, "eth_estimateGas", [rpcTx]);
    return { gas: result as string };
  } catch (err) {
    return { gas: null, error: (err as Error).message };
  }
}

export async function getChainId(rpcUrl: string): Promise<number> {
  const result = await rpcCall(rpcUrl, "eth_chainId");
  return parseInt(result as string, 16);
}

// --- Broadcast blasting ---
//
// For eth_sendRawTransaction we want maximum propagation:
// 1. Blast the first BROADCAST_BATCH RPCs simultaneously
// 2. Every 1s, if no success yet, blast the next batch
// 3. Return immediately on first success
// 4. Keep in-flight requests running in the background (don't abort them)
//    so more nodes accept the tx → better propagation
//
// "already known" from an RPC means the tx is already in the mempool — treat as success.

const BROADCAST_BATCH = parseInt(process.env.BROADCAST_BATCH_SIZE ?? "10", 10);

function isFatalBroadcastError(msg: string): boolean {
  return (
    msg.includes("nonce") ||
    msg.includes("insufficient funds") ||
    msg.includes("gas too low") ||
    msg.includes("underpriced")
  );
}

export async function sendRawTransaction(
  chainId: number,
  signedTx: string,
): Promise<{ txHash: string; rpcUrl: string }> {
  const urls = getRpcUrls(chainId, BROADCAST_BATCH * 5);
  if (urls.length === 0) throw new Error(`No RPCs available for chain ${chainId}`);

  // Pre-compute txHash for "already known" handling
  const precomputedHash = Transaction.from(signedTx).hash!;

  return new Promise((resolve, reject) => {
    let resolved = false;
    let rejected = false;
    let nextIdx = 0;
    let inFlight = 0;
    let failures = 0;
    let lastError: Error | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function stopLaunching() {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    }

    function sendOne(url: string) {
      const ctrl = new AbortController();
      const reqTimer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
      inFlight++;
      const start = Date.now();

      rpcCallRaw(url, "eth_sendRawTransaction", [signedTx], ctrl.signal)
        .then((result) => {
          clearTimeout(reqTimer);
          inFlight--;
          rewardRpc(chainId, url, Date.now() - start);

          if (!resolved && !rejected) {
            resolved = true;
            stopLaunching();
            resolve({ txHash: result as string, rpcUrl: url });
          }
        })
        .catch((err: Error) => {
          clearTimeout(reqTimer);
          inFlight--;
          failures++;
          lastError = err;
          penalizeRpc(chainId, url);

          if (resolved || rejected) return;

          // "already known" = tx is in the mempool = success
          if (err.message.includes("already known")) {
            resolved = true;
            stopLaunching();
            resolve({ txHash: precomputedHash, rpcUrl: url });
            return;
          }

          // Fatal tx-level error — stop everything
          if (isFatalBroadcastError(err.message)) {
            rejected = true;
            stopLaunching();
            reject(err);
            return;
          }

          checkDone();
        });
    }

    function sendBatch() {
      if (resolved || rejected || nextIdx >= urls.length) return;
      const end = Math.min(nextIdx + BROADCAST_BATCH, urls.length);
      for (let i = nextIdx; i < end; i++) {
        sendOne(urls[i]);
      }
      nextIdx = end;
    }

    function scheduleNextBatch() {
      if (resolved || rejected || nextIdx >= urls.length) return;
      const t = setTimeout(() => {
        sendBatch();
        scheduleNextBatch();
      }, 1000);
      timers.push(t);
    }

    function checkDone() {
      if (!resolved && !rejected && inFlight === 0 && nextIdx >= urls.length) {
        rejected = true;
        stopLaunching();
        reject(
          new Error(
            `All ${failures} RPCs failed for eth_sendRawTransaction. Last: ${lastError?.message}`,
          ),
        );
      }
    }

    // First batch immediately
    sendBatch();

    // Schedule next batches every 1s
    scheduleNextBatch();

    // Overall timeout safety net
    const overall = setTimeout(() => {
      if (!resolved && !rejected) {
        rejected = true;
        stopLaunching();
        reject(
          new Error(
            `Broadcast timeout (${OVERALL_TIMEOUT / 1000}s). Tried ${nextIdx} RPCs, ${failures} failed. Last: ${lastError?.message}`,
          ),
        );
      }
    }, OVERALL_TIMEOUT);
    timers.push(overall);
  });
}

export async function waitForReceipt(
  chainId: number,
  txHash: string,
  timeoutMs: number = 10000,
  pollIntervalMs: number = 1000,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { result } = await rpcCallWithFallback(
        chainId,
        "eth_getTransactionReceipt",
        [txHash],
        3,
      );
      if (result) return result as Record<string, unknown>;
    } catch {
      // ignore, retry
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return null; // not mined within timeout
}

// --- ERC-20 helpers ---

// ERC-20 allowance(owner, spender) selector: 0xdd62ed3e
export async function getAllowance(
  chainId: number,
  tokenAddress: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const data =
    "0xdd62ed3e" +
    owner.slice(2).padStart(64, "0") +
    spender.slice(2).padStart(64, "0");

  const { result } = await rpcCallWithFallback(chainId, "eth_call", [
    { to: tokenAddress, data },
    "latest",
  ]);
  return BigInt((result as string) || "0x0");
}

// ERC-20 approve(spender, amount) selector: 0x095ea7b3
export function encodeApproveCalldata(
  spender: string,
  amount: bigint,
): string {
  return (
    "0x095ea7b3" +
    spender.slice(2).padStart(64, "0") +
    amount.toString(16).padStart(64, "0")
  );
}

// Max uint256 for unlimited approval
export const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

// --- Tx params builder ---

export interface TxParams {
  chainId: string;        // hex
  nonce: string;          // hex
  gasPrice: string;       // hex (multiplied by 1.2)
  gasLimit: string | null; // hex (estimate * 2, null if estimateGas failed)
  maxPriorityFeePerGas?: string; // hex, if EIP-1559 supported
  estimateGasError?: string; // populated when estimateGas fails — tx will likely revert
}

export async function buildTxParams(
  chainId: number,
  from: string,
  to: string,
  data: string,
  value?: string,
): Promise<TxParams> {
  // Run all RPC calls in parallel
  const [gasPriceHex, priorityFee, nonceHex, gasResult] = await Promise.all([
    getGasPrice(chainId),
    getMaxPriorityFeePerGas(chainId),
    getNonce(chainId, from),
    estimateGas(chainId, { from, to, data, value: toHexValue(value) }),
  ]);

  // Multiply gas price by 1.2x for faster mining
  const gasPrice = BigInt(gasPriceHex);
  const boostedGasPrice = (gasPrice * 6n) / 5n;

  // Multiply gas estimate by 2x for safety margin
  let gasLimit: string | null = null;
  if (gasResult.gas) {
    const estimate = BigInt(gasResult.gas);
    gasLimit = "0x" + (estimate * 2n).toString(16);
  }

  const result: TxParams = {
    chainId: "0x" + chainId.toString(16),
    nonce: nonceHex,
    gasPrice: "0x" + boostedGasPrice.toString(16),
    gasLimit,
    ...(gasResult.error && { estimateGasError: gasResult.error }),
  };

  if (priorityFee) {
    result.maxPriorityFeePerGas = priorityFee;
  }

  return result;
}
