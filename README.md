# Symbiosis MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-8A2BE2)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-22.23.4%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-Hub-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/symbiosisfinance/symbiosis-public-mcp)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Symbiosis](https://symbiosis.finance) — enabling AI agents to perform **any-to-any token swaps** across 50+ blockchains, sign and broadcast transactions, track cross-chain status, and access validated RPC endpoints.

Symbiosis is a universal cross-chain swap protocol and DEX aggregator. It can swap **any token for any other token**, on the same chain or across different chains — including ERC-20, SPL, TRC-20 tokens, meme tokens, and more.

## Installation

Pick **one** of the two options below — you don't need both.

### Option A: Node.js

> Requires [Node.js v22.23.4+, v24.22.1+, or v26.12.1+](https://nodejs.org/) — download the LTS installer for your OS, run it, done.
> Verify: `node --version` (use a patched release: v22.23.4+, v24.22.1+, or v26.12.1+).

```bash
git clone https://github.com/symbiosis-finance/symbiosis-public-mcp.git
cd symbiosis-public-mcp
npm install
npm run build
```

After the build finishes, it prints ready-to-use connection commands with the correct path for your machine.

### Option B: Docker

> Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) — download, install, launch.
> Verify: `docker --version` (should print version 20+).

```bash
docker pull symbiosisfinance/symbiosis-public-mcp:latest
```

Or build from source:
```bash
git clone https://github.com/symbiosis-finance/symbiosis-public-mcp.git
cd symbiosis-public-mcp
docker build -t symbiosis-mcp .
```

## Configuration

Copy the example config and edit it:

```bash
cp .env.example .env
```

The most important setting is `PRIVATE_KEY` — an EVM wallet private key (without `0x` prefix). It enables the server to sign and broadcast transactions on behalf of the agent.

**Without `PRIVATE_KEY`**, the server works in read-only mode: quotes, token search, calldata generation, and swap URLs. The agent cannot execute transactions.

**With `PRIVATE_KEY`**, additional tools become available: `sign_transaction`, `sign_and_broadcast`, and `get_swap_calldata_and_sign_and_broadcast`.

See [`.env.example`](.env.example) for all available settings.

## Connecting to MCP Clients

After installation, connect the server to your AI tool. All examples below use **stdio** mode (the default).

Replace `/full/path/to` with the actual path printed after `npm run build`.

<details open>
<summary><b>Claude Code</b></summary>

```bash
# With private key
claude mcp add symbiosis -e PRIVATE_KEY=YOUR_KEY -- node /full/path/to/dist/index.js

# Without private key (read-only)
claude mcp add symbiosis -- node /full/path/to/dist/index.js
```

Using Docker:
```bash
claude mcp add symbiosis -e PRIVATE_KEY=YOUR_KEY -- docker run -i --rm symbiosisfinance/symbiosis-public-mcp node dist/index.js
```

Verify: `claude mcp list`

</details>

<details>
<summary><b>Claude Desktop</b></summary>

Add to `claude_desktop_config.json`:

Node.js:
```json
{
  "mcpServers": {
    "symbiosis": {
      "command": "node",
      "args": ["/full/path/to/dist/index.js"],
      "env": { "PRIVATE_KEY": "YOUR_KEY" }
    }
  }
}
```

Docker:
```json
{
  "mcpServers": {
    "symbiosis": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "PRIVATE_KEY=YOUR_KEY", "symbiosisfinance/symbiosis-public-mcp", "node", "dist/index.js"],
      "env": {}
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

Add to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "symbiosis": {
      "command": "node",
      "args": ["/full/path/to/dist/index.js"],
      "env": { "PRIVATE_KEY": "YOUR_KEY" }
    }
  }
}
```

</details>

<details>
<summary><b>Windsurf</b></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "symbiosis": {
      "command": "node",
      "args": ["/full/path/to/dist/index.js"],
      "env": { "PRIVATE_KEY": "YOUR_KEY" }
    }
  }
}
```

</details>

<details>
<summary><b>GitHub Copilot (VS Code)</b></summary>

Add to `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "symbiosis": {
      "type": "stdio",
      "command": "node",
      "args": ["/full/path/to/dist/index.js"],
      "env": { "PRIVATE_KEY": "YOUR_KEY" }
    }
  }
}
```

</details>

<details>
<summary><b>Cline</b></summary>

Open Cline settings → MCP Servers → Edit MCP Settings:

```json
{
  "mcpServers": {
    "symbiosis": {
      "command": "node",
      "args": ["/full/path/to/dist/index.js"],
      "env": { "PRIVATE_KEY": "YOUR_KEY" }
    }
  }
}
```

</details>

<details>
<summary><b>Continue</b></summary>

Add to `~/.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "symbiosis",
      "command": "node",
      "args": ["/full/path/to/dist/index.js"],
      "env": { "PRIVATE_KEY": "YOUR_KEY" }
    }
  ]
}
```

</details>

<details>
<summary><b>Zed</b></summary>

Add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "symbiosis": {
      "command": {
        "path": "node",
        "args": ["/full/path/to/dist/index.js"],
        "env": { "PRIVATE_KEY": "YOUR_KEY" }
      }
    }
  }
}
```

</details>

### Remote (Hosted)

Connect to the hosted instance without installing anything:

```bash
# Claude Code
claude mcp add symbiosis --transport http https://mcp.symbiosis.finance/mcp
```

For other clients:
```json
{ "mcpServers": { "symbiosis": { "url": "https://mcp.symbiosis.finance/mcp" } } }
```

The hosted instance runs in read-only mode (no private key).

## Transport Modes

The server supports two transport modes:

| Mode | Use case |
|------|----------|
| **stdio** (default) | Local agent frameworks and CLI tools — Claude Code, Cursor, etc. |
| **Streamable HTTP** | Containerized deployments, web-based agents, remote access |

### Running with Node.js

```bash
# stdio (default) — used by MCP clients automatically
npm start

# HTTP on port 3000
MCP_TRANSPORT=http PORT=3000 npm start
```

### Running with Docker

```bash
# stdio — for direct use with MCP clients (see examples above)
docker run -i --rm -e PRIVATE_KEY=YOUR_KEY symbiosisfinance/symbiosis-public-mcp node dist/index.js

# HTTP on port 3000 — for server/remote deployments
docker run -d -p 3000:3000 -e MCP_TRANSPORT=http symbiosisfinance/symbiosis-public-mcp
```

Or using Docker Compose:
```bash
docker compose up -d --build
```

## Development

```bash
npm run dev          # stdio dev mode (no build needed)
npm run dev:http     # HTTP dev mode on port 3000
npm run inspect      # MCP Inspector UI
```

## Tools

| Tool | Requires `PRIVATE_KEY` | Description |
|------|:----------------------:|-------------|
| `get_instructions` | — | Returns the agent guide with workflow, conventions, and tips |
| `get_supported_chains` | — | List all 50+ supported blockchain networks |
| `search_tokens` | — | Search 6000+ tokens by name, symbol, or address |
| `get_quote` | — | Get a swap quote — expected output, fees, estimated time |
| `get_swap_calldata` | — | Build transaction calldata with approve check and gas params |
| `get_swap_url` | — | Generate a pre-filled Symbiosis app URL |
| `get_rpcs` | — | Get validated RPC endpoints for any chain, sorted by latency |
| `get_tx_status` | — | Check cross-chain swap status |
| `get_balances` | — | Check token balances across all EVM chains |
| `broadcast_transaction` | — | Broadcast a signed transaction via RPCs |
| `sign_transaction` | Yes | Sign a transaction with the server wallet |
| `sign_and_broadcast` | Yes | Sign and broadcast in one step |
| `get_swap_calldata_and_sign_and_broadcast` | Yes | All-in-one: calldata + approve + sign + broadcast |

Tools marked with **—** work without a private key, but `get_swap_calldata` and `get_balances` require explicit wallet addresses if `PRIVATE_KEY` is not set.

## License

[MIT](LICENSE), Copyright 2025 Symbiosis
