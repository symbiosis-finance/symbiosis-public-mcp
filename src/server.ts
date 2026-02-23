import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getInstructions } from "./tools/get-instructions.js";
import { getSupportedChains } from "./tools/get-chains.js";
import { searchTokens } from "./tools/search-tokens.js";
import { getQuote } from "./tools/get-quote.js";
import { getSwapCalldata } from "./tools/get-swap-calldata.js";
import { getSwapUrl } from "./tools/get-swap-url.js";
import { getTxStatus } from "./tools/get-tx-status.js";
import { getRpcs } from "./services/rpc-service.js";
import { hasWallet, getWalletAddress } from "./services/wallet.js";
import { signTransaction } from "./tools/sign-transaction.js";
import { broadcastTransaction } from "./tools/broadcast-transaction.js";
import { executeSwap } from "./tools/execute-swap.js";
import { getBalances } from "./tools/get-balances.js";

export function createServer(): McpServer {
  const addr = getWalletAddress();
  const HAS_KEY = hasWallet();

  const server = new McpServer({
    name: "symbiosis-mcp",
    version: "1.0.0",
  });

  // --- get_instructions ---
  server.tool(
    "get_instructions",
    "RECOMMENDED: Call this first to get the full usage guide — workflow, chain IDs, common mistakes, and tips for Symbiosis swaps.",
    {},
    async () => ({
      content: [{ type: "text", text: getInstructions() }],
    })
  );

  // --- get_supported_chains ---
  server.tool(
    "get_supported_chains",
    "List all blockchain networks supported by Symbiosis. Common chain IDs: Ethereum=1, BNB=56, Polygon=137, Arbitrum=42161, Base=8453, Optimism=10, Avalanche=43114, Solana=5426, Bitcoin=3652501241, TON=85918, Tron=728126428, HyperEVM=999.",
    {},
    async () => {
      const chains = await getSupportedChains();
      return {
        content: [{ type: "text", text: JSON.stringify(chains, null, 2) }],
      };
    }
  );

  // --- search_tokens ---
  server.tool(
    "search_tokens",
    "Search tokens by name, symbol, or address across 6000+ known tokens on 50+ chains. Returns chainId, symbol, name, and address. Searching by gas token symbol (ETH, BTC, SOL, BNB, etc.) returns the native token first with address '' (empty string). You do NOT need token decimals — the server resolves them automatically in get_quote and get_swap_calldata. Symbiosis can swap ANY token — if not found here, use the contract address directly.",
    {
      query: z.string().describe("Token name, symbol, or contract address (e.g. 'USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')"),
      chainId: z.number().optional().describe("Filter by chain ID (e.g. 1 for Ethereum, 56 for BNB, 5426 for Solana)"),
      limit: z.number().optional().default(10).describe("Max results to return (default: 10)"),
    },
    async ({ query, chainId, limit }) => {
      const q = query.trim();
      if (q.length === 0) {
        return {
          content: [{ type: "text", text: "Please provide a token name, symbol, or contract address to search for. Examples: 'USDC', 'ETH', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'" }],
          isError: true,
        };
      }
      if (q.length === 1 && !q.startsWith("0x")) {
        return {
          content: [{ type: "text", text: "Search query too short — please use at least 2 characters, or a full contract address." }],
          isError: true,
        };
      }
      const results = await searchTokens({ query: q, chainId, limit });
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No tokens found for "${q}"${chainId ? ` on chain ${chainId}` : ""}. Symbiosis can swap ANY token — use the contract address directly in get_swap_calldata.` }],
        };
      }
      // Strip decimals — server handles them automatically, agents don't need them
      const cleaned = results.map(({ decimals: _, ...rest }) => rest);
      return {
        content: [{ type: "text", text: JSON.stringify(cleaned, null, 2) }],
      };
    }
  );

  // --- get_quote ---
  server.tool(
    "get_quote",
    HAS_KEY
      ? `Get a swap quote for ANY token pair via Symbiosis. Returns expected output, fees, time, and a human-readable _summary. After showing the quote, proceed with get_swap_calldata_and_sign_and_broadcast to execute the swap in one call. The server wallet ${addr} handles signing automatically.`
      : "Get a swap quote (expected output, fees, estimated time) for ANY token pair via Symbiosis. No wallet needed. The response includes a human-readable _summary field (e.g. '1 USDC → 0.99 USDC, fee: ~$0.25, ~36s'). After a quote, call get_swap_url to give the user a link to execute the swap.",
    {
      srcChainId: z.number().describe("Source chain ID (e.g. 1 for Ethereum, 56 for BNB)"),
      srcTokenAddress: z.string().describe("Source token address. Use '' for native gas tokens (ETH, BNB, etc.)"),
      srcTokenDecimals: z.number().optional().describe("Source token decimals. Auto-resolved for known tokens — only provide for tokens NOT found via search_tokens."),
      amount: z.string().describe("Amount in human-readable format. Examples: '1.5' for 1.5 tokens, '100' for 100 tokens, '0.001' for 0.001 tokens. Do NOT convert to wei/smallest units — the server handles conversion automatically."),
      dstChainId: z.number().describe("Destination chain ID"),
      dstTokenAddress: z.string().describe("Destination token address. Use '' for native gas tokens"),
      dstTokenDecimals: z.number().optional().describe("Destination token decimals. Auto-resolved for known tokens — only provide for tokens NOT found via search_tokens."),
      slippage: z.number().optional().default(200).describe("Slippage in basis points (default: 200 = 2%). Min 10, max 5000."),
    },
    async (params) => {
      try {
        const result = await getQuote(params);
        // Override _note based on whether PRIVATE_KEY is configured
        if (HAS_KEY) {
          result._note = `Server wallet ${addr} is ready. Call get_swap_calldata_and_sign_and_broadcast to execute this swap in one call (handles approve + sign + broadcast automatically).`;
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Quote failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- get_swap_calldata ---
  server.tool(
    "get_swap_calldata",
    HAS_KEY
      ? `Build transaction calldata for a swap via Symbiosis. The server wallet ${addr} is used as default sender and recipient — you do NOT need to ask the user for addresses. Override 'from'/'to' only if the user explicitly provides different addresses. Returns: swapTx (to, data, value, gasPrice, gasLimit, nonce), approveTx if ERC-20 allowance is insufficient, and working RPCs. IMPORTANT: If approveTx is present, it MUST be sent first and mined before swapTx.`
      : "Build transaction calldata for a swap via Symbiosis. Requires 'from' and 'to' wallet addresses. Returns swapTx (to, data, value, gasPrice, gasLimit, nonce), approveTx if ERC-20 allowance is insufficient, and working RPCs. IMPORTANT: If approveTx is present, send it FIRST and wait for mining before sending swapTx.",
    {
      srcChainId: z.number().describe("Source chain ID"),
      srcTokenAddress: z.string().describe("Source token address. Use '' for native gas tokens"),
      srcTokenDecimals: z.number().optional().describe("Source token decimals. Auto-resolved for known tokens — only provide for unknown tokens."),
      amount: z.string().describe("Amount in human-readable format (e.g. '1.5', '100', '0.001'). Do NOT convert to wei — the server handles it."),
      dstChainId: z.number().describe("Destination chain ID"),
      dstTokenAddress: z.string().describe("Destination token address. Use '' for native gas tokens"),
      dstTokenDecimals: z.number().optional().describe("Destination token decimals. Auto-resolved for known tokens."),
      from: z.string().optional().describe(
        HAS_KEY
          ? `Sender address (default: ${addr}). Omit to use the server wallet.`
          : "Sender wallet address on the source chain (required)"
      ),
      to: z.string().optional().describe(
        HAS_KEY
          ? `Recipient address (default: ${addr}). Omit to send to the server wallet.`
          : "Recipient wallet address on the destination chain (required)"
      ),
      slippage: z.number().optional().default(200).describe("Slippage in basis points (default: 200 = 2%)"),
    },
    async (params) => {
      try {
        const result = await getSwapCalldata(params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Swap calldata failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- get_swap_url ---
  server.tool(
    "get_swap_url",
    HAS_KEY
      ? "Generate a pre-filled Symbiosis app URL. Use as a fallback option — the primary flow is get_swap_calldata → sign_and_broadcast. Share the URL only if the user wants to review the swap in the browser first."
      : "Generate a pre-filled Symbiosis app URL for the user to execute a swap in their browser. Always share a swap URL proactively after showing a quote.",
    {
      srcChainId: z.number().describe("Source chain ID"),
      dstChainId: z.number().describe("Destination chain ID"),
      srcTokenAddress: z.string().optional().describe("Source token address (omit for native gas token)"),
      dstTokenAddress: z.string().optional().describe("Destination token address (omit for native gas token)"),
      amount: z.string().optional().describe("Human-readable amount (e.g. '1.5', '100')"),
    },
    async (params) => {
      try {
        return { content: [{ type: "text", text: await getSwapUrl(params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- get_rpcs ---
  server.tool(
    "get_rpcs",
    "Get validated, working RPC endpoints for a blockchain, sorted by latency. Search by chain ID or name/symbol (e.g. 'ethereum', 'BSC').",
    {
      chain: z.union([z.string(), z.number()]).describe("Chain ID (number) or chain name/symbol (string)"),
      count: z.number().optional().default(3).describe("Number of RPCs to return (default: 3)"),
    },
    async ({ chain, count }) => {
      const result = getRpcs(chain, count);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        ...("error" in result && { isError: true }),
      };
    }
  );

  // --- get_tx_status ---
  server.tool(
    "get_tx_status",
    "Check the status of a cross-chain swap. Provide the source chain ID and tx hash. Only use for CROSS-CHAIN swaps. The response includes an explorerUrl — share it with the user. Polling schedule: first 60s — every 5s, next 60s — every 10s, then every 30s. Most swaps complete within 1 minute.",
    {
      chainId: z.number().describe("Source chain ID"),
      txHash: z.string().describe("Transaction hash on the source chain"),
    },
    async ({ chainId, txHash }) => {
      try {
        const status = await getTxStatus(chainId, txHash);
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Status check failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- broadcast_transaction (always available) ---
  server.tool(
    "broadcast_transaction",
    "Broadcast a signed transaction to the blockchain via validated RPCs. Retries across multiple endpoints on failure. Waits up to 10 seconds for the transaction to be mined and returns the receipt.",
    {
      chainId: z.number().describe("Chain ID to broadcast on"),
      signedTx: z.string().describe("Raw signed transaction hex (e.g. '0x02f8...')"),
    },
    async ({ chainId, signedTx }) => {
      try {
        const result = await broadcastTransaction({ chainId, signedTx });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Broadcast failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- get_balances ---
  server.tool(
    "get_balances",
    HAS_KEY
      ? `Check token balances for the server wallet (${addr}) across all Symbiosis-supported EVM chains. Returns only non-zero balances. Uses Multicall3 for efficient batch queries across 6000+ known tokens. Covers native gas tokens and ERC-20s.`
      : "Check token balances for a wallet across all Symbiosis-supported EVM chains. Requires an EVM wallet address. Returns only non-zero balances. Uses Multicall3 for efficient batch queries across 6000+ known tokens.",
    {
      address: z.string().optional().describe(
        HAS_KEY
          ? `EVM wallet address (default: ${addr}). Omit to check the server wallet.`
          : "EVM wallet address to check (required)"
      ),
      chainIds: z.array(z.number()).optional().describe(
        "Filter to specific chain IDs (e.g. [1, 42161, 8453]). Default: all Symbiosis-supported EVM chains."
      ),
    },
    async (params) => {
      try {
        const walletAddr = params.address || (HAS_KEY ? addr! : undefined);
        if (!walletAddr) {
          return {
            content: [{ type: "text", text: "Wallet address is required. Provide an EVM address or configure PRIVATE_KEY." }],
            isError: true,
          };
        }
        const result = await getBalances({ address: walletAddr, chainIds: params.chainIds });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Balance check failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- sign_transaction & sign_and_broadcast (only if PRIVATE_KEY is set) ---
  if (HAS_KEY) {
    server.tool(
      "sign_transaction",
      `Sign a transaction with the server wallet (${addr}). Pass chainId, to, data, and optionally value. All gas parameters are auto-fetched from the network but can be overridden. Returns signed tx hex ready for broadcast_transaction.`,
      {
        chainId: z.number().describe("Chain ID"),
        to: z.string().describe("Destination contract/address"),
        data: z.string().describe("Transaction calldata hex"),
        value: z.string().optional().describe("Value in wei hex (default: '0x0')"),
        nonce: z.number().optional().describe("Override nonce (auto-fetched if omitted)"),
        gasPrice: z.string().optional().describe("Override gas price hex — forces legacy tx"),
        gasLimit: z.string().optional().describe("Override gas limit hex (auto: estimateGas * 2)"),
        maxFeePerGas: z.string().optional().describe("Override max fee per gas hex — forces EIP-1559"),
        maxPriorityFeePerGas: z.string().optional().describe("Override max priority fee hex"),
        type: z.number().optional().describe("Force tx type: 0 = legacy, 2 = EIP-1559 (auto-detected)"),
      },
      async (params) => {
        try {
          const result = await signTransaction(params);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Sign failed: ${(err as Error).message}` }], isError: true };
        }
      }
    );

    server.tool(
      "sign_and_broadcast",
      `Sign and broadcast a transaction in one step using the server wallet (${addr}). Combines sign_transaction + broadcast_transaction. Returns tx hash, explorer URL, and receipt.`,
      {
        chainId: z.number().describe("Chain ID"),
        to: z.string().describe("Destination contract/address"),
        data: z.string().describe("Transaction calldata hex"),
        value: z.string().optional().describe("Value in wei hex (default: '0x0')"),
        nonce: z.number().optional().describe("Override nonce"),
        gasPrice: z.string().optional().describe("Override gas price hex — forces legacy tx"),
        gasLimit: z.string().optional().describe("Override gas limit hex"),
        maxFeePerGas: z.string().optional().describe("Override max fee per gas hex — forces EIP-1559"),
        maxPriorityFeePerGas: z.string().optional().describe("Override max priority fee hex"),
        type: z.number().optional().describe("Force tx type: 0 = legacy, 2 = EIP-1559"),
      },
      async (params) => {
        try {
          const signed = await signTransaction(params);
          const result = await broadcastTransaction({ chainId: params.chainId, signedTx: signed.signedTx });
          return {
            content: [{ type: "text", text: JSON.stringify({ ...result, from: signed.from, nonce: signed.nonce }, null, 2) }],
          };
        } catch (err) {
          return { content: [{ type: "text", text: `Sign & broadcast failed: ${(err as Error).message}` }], isError: true };
        }
      }
    );

    server.tool(
      "get_swap_calldata_and_sign_and_broadcast",
      `All-in-one swap execution using the server wallet (${addr}). Builds calldata, approves token if needed, signs, and broadcasts — all in one call. Returns tx hashes, receipts, and cross-chain tracking info. Simplest way to execute a swap when PRIVATE_KEY is set.`,
      {
        srcChainId: z.number().describe("Source chain ID"),
        srcTokenAddress: z.string().describe("Source token address. Use '' for native gas tokens"),
        srcTokenDecimals: z.number().optional().describe("Source token decimals. Auto-resolved for known tokens."),
        amount: z.string().describe("Amount in human-readable format (e.g. '1.5', '100'). Do NOT convert to wei."),
        dstChainId: z.number().describe("Destination chain ID"),
        dstTokenAddress: z.string().describe("Destination token address. Use '' for native gas tokens"),
        dstTokenDecimals: z.number().optional().describe("Destination token decimals. Auto-resolved for known tokens."),
        slippage: z.number().optional().default(200).describe("Slippage in basis points (default: 200 = 2%)"),
      },
      async (params) => {
        try {
          const result = await executeSwap(params);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Swap execution failed: ${(err as Error).message}` }], isError: true };
        }
      }
    );
  }

  return server;
}
