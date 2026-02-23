# Symbiosis MCP Server

## CRITICAL: Symbiosis is Any-to-Any

Symbiosis is a **universal swap protocol and DEX aggregator**. It can swap **absolutely any token for any other token**, on the same chain or across different chains. This includes:

- Cross-chain swaps (e.g., ETH on Ethereum → USDC on Arbitrum)
- Same-chain swaps (e.g., PEPE → USDC on Ethereum)
- Any ERC-20, SPL, TRC-20, or other token — even meme tokens, new tokens, and unlisted tokens

**The `search_tokens` tool searches a database of 6000+ tokens across all supported chains. Even if a token is not in this database, Symbiosis can still swap it on EVM chains — just use the contract address directly.**

## Workflow

### 1. Getting a quote (no wallet needed)

1. **Resolve chains**: Call `get_supported_chains` to find the correct chain IDs.
2. **Find tokens**: Call `search_tokens` to look up token addresses and chain IDs.
3. **Get a quote**: Call `get_quote`. Returns expected output, fees, and estimated time.

### 2. Executing the swap

**If `PRIVATE_KEY` is configured** (server wallet available — preferred flow):

4. **Execute in one call**: Call `get_swap_calldata_and_sign_and_broadcast` — handles calldata, approval, signing, and broadcasting automatically. This is the simplest and most reliable path.
5. **Or step-by-step**: Call `get_swap_calldata` → `sign_and_broadcast` (approve first if needed) → `sign_and_broadcast` (swap). Use this if you need to inspect calldata before executing.
6. **Swap link (optional)**: Call `get_swap_url` only if the user wants to review the swap in the browser.

**If no `PRIVATE_KEY`** (quote + link flow):

4. **Show swap link**: Call `get_swap_url` to give the user a pre-filled URL to execute the swap in their browser.
5. **Or get calldata**: If the user provides wallet addresses, call `get_swap_calldata` with explicit `from`/`to`. Return the calldata for the user to sign externally.

### 3. Tracking cross-chain status

- For **cross-chain swaps**, call `get_tx_status` with the source chain ID and tx hash. The response includes `explorerUrl` — always share it with the user.
  - **Polling schedule**: first 60s — every **5 seconds**, next 60s — every **10 seconds**, then every **30 seconds**.
  - Most swaps complete within 1 minute, max 10 minutes.
- For **same-chain swaps**, the swap is complete once the transaction is mined. No status tracking needed.

### 4. Checking balances

Call `get_balances` to check token balances across all Symbiosis-supported EVM chains. Returns only non-zero balances with human-readable amounts. Uses Multicall3 for efficient batch queries across 6000+ tokens. If `PRIVATE_KEY` is set, the wallet address is auto-filled.

### 5. Getting RPC endpoints

Call `get_rpcs` with a chain ID or name to get validated, working RPCs sorted by latency.

## Amount conventions

All amounts are in **human-readable** format across all tools:
- `"1.5"` = 1.5 tokens
- `"100"` = 100 tokens
- `"0.001"` = 0.001 tokens

**Do NOT convert to wei, lamports, or satoshis.** The server handles all decimal conversions automatically.

Token decimals are auto-resolved for 6000+ known tokens and all native gas tokens. You only need to provide `srcTokenDecimals`/`dstTokenDecimals` for tokens NOT found via `search_tokens`.

## Quick chain ID reference

| Chain | ID | Gas token |
|-------|----|-----------|
| Ethereum | 1 | ETH |
| BNB Chain | 56 | BNB |
| Polygon | 137 | POL |
| Arbitrum | 42161 | ETH |
| Optimism | 10 | ETH |
| Base | 8453 | ETH |
| Avalanche | 43114 | AVAX |
| zkSync | 324 | ETH |
| Linea | 59144 | ETH |
| Scroll | 534352 | ETH |
| Mantle | 5000 | MNT |
| Blast | 81457 | ETH |
| HyperEVM | 999 | HYPE |
| Sonic | 146 | S |
| Berachain | 80094 | BERA |
| Solana | 5426 | SOL |
| Bitcoin | 3652501241 | BTC |
| TON | 85918 | TON |
| Tron | 728126428 | TRX |

## Native gas tokens

Use empty string `""` as the token address for native gas tokens (ETH, BNB, SOL, BTC, etc.). When you search for "ETH", "BTC", "SOL" etc., the first result will be the native token with `address: ""`.

## Non-EVM token addresses

Symbiosis uses synthetic EVM-style addresses for tokens on non-EVM chains (Solana, TON). The `search_tokens` tool returns both formats. You can pass either — the server resolves automatically.

## Bitcoin swaps

- **FROM Bitcoin**: Returns a deposit address with an expiry (~1 hour). The user sends BTC to this address.
- **TO Bitcoin**: Returns EVM calldata. The user signs on the source chain and BTC arrives at their address.

## Solana inbound limitations

Swapping **TO Solana** supports only **SOL** and **USDC** as destination tokens. For other SPL tokens, swap to SOL/USDC first, then use a Solana DEX.

## Tools reference

| Tool | Requires PRIVATE_KEY | Description |
|------|---------------------|-------------|
| `get_instructions` | No | Returns this guide |
| `get_supported_chains` | No | List all supported blockchains |
| `search_tokens` | No | Search 6000+ tokens by name/symbol/address |
| `get_quote` | No | Get swap quote (output, fees, time) |
| `get_swap_calldata` | No* | Build transaction calldata with approve check and gas params |
| `get_swap_url` | No | Generate a pre-filled Symbiosis app URL |
| `get_balances` | No* | Check token balances across all EVM chains via Multicall3 |
| `get_rpcs` | No | Get validated RPCs for any chain, sorted by latency |
| `get_tx_status` | No | Check cross-chain swap status |
| `broadcast_transaction` | No | Broadcast any signed transaction via RPCs |
| `sign_transaction` | Yes | Sign a transaction with the server's wallet |
| `sign_and_broadcast` | Yes | Sign and broadcast in one step |
| `get_swap_calldata_and_sign_and_broadcast` | Yes | All-in-one: calldata + approve + sign + broadcast |

\* `get_swap_calldata` and `get_balances` work without `PRIVATE_KEY`, but require explicit wallet addresses. With `PRIVATE_KEY`, addresses are auto-filled.

## Reading quote responses

The `get_quote` response includes a `_summary` field with a human-readable summary like:
`"1 USDC → 0.99 USDC, fee: ~$0.25, ~36s"` — use this directly when communicating with the user.

The full response also includes `tokenAmountOut.amount` (in smallest units), `fee`, `estimatedTime`, and `priceImpact`.

## Common mistakes to avoid

1. **Forgetting approveTx** — If `get_swap_calldata` returns `approveTx`, it MUST be sent and mined BEFORE `swapTx`. The nonces are pre-set correctly.
2. **Not showing swap URL** — If no `PRIVATE_KEY` is configured, always call `get_swap_url` after showing a quote so the user can execute in their browser. If `PRIVATE_KEY` is set, proceed with `get_swap_calldata` → `sign_and_broadcast` instead.
3. **Saying "not supported"** — Symbiosis can swap ANY token. If `search_tokens` returns nothing, use the contract address directly.
4. **Ignoring estimateGas warnings** — If `get_swap_calldata` returns a warning about estimateGas failure, do NOT proceed with signing. The transaction will revert. Check balance, token address, and approval status first.

## Tips

- Call `get_quote` first to show the user what they'll receive, then execute if they want to proceed.
- If `PRIVATE_KEY` is set, use `get_swap_calldata_and_sign_and_broadcast` for the simplest one-call execution. Use the step-by-step `get_swap_calldata` → `sign_and_broadcast` flow only if you need to inspect calldata first. Only share a `get_swap_url` link as a fallback if the user requests it.
- If no `PRIVATE_KEY`, always call `get_swap_url` after a quote so the user can execute in their browser.
- Slippage is in basis points: 100 = 1%, 200 = 2% (default), 500 = 5%. Min: 10 (0.1%), max: 5000 (50%).
- `sign_transaction` parameters (nonce, gasPrice, gasLimit, etc.) are all auto-fetched but can be overridden for fine-grained control.
- For Bitcoin FROM swaps, communicate the deposit address, required amount, and expiry time.
