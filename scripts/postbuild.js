import { resolve, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(__dirname, "..", "dist", "index.js");

// Try to read PRIVATE_KEY from .env or environment
let pk = process.env.PRIVATE_KEY || "";
if (!pk) {
  try {
    const envFile = readFileSync(resolve(__dirname, "..", ".env"), "utf8");
    const match = envFile.match(/^PRIVATE_KEY=(.+)$/m);
    if (match) pk = match[1].trim();
  } catch {}
}

const keyValue = pk || "0xYOUR_KEY";
const keyNote = pk
  ? "\x1b[32mPRIVATE_KEY loaded from .env\x1b[0m"
  : "\x1b[2mPRIVATE_KEY is optional — enables sign_transaction and sign_and_broadcast tools.\nWithout it, the server works in read-only mode (quotes, calldata, RPCs).\x1b[0m";

const R = "\x1b[0m";
const G = "\x1b[32m";
const C = "\x1b[36m";
const D = "\x1b[2m";
const B = "\x1b[1m";

console.log(`
${G}${B}✓ Build complete!${R}

${B}Connect to an MCP client:${R}

${C}Claude Code:${R}
  claude mcp add symbiosis -e PRIVATE_KEY=${keyValue} -- node ${distPath}

${C}Claude Desktop ${D}(claude_desktop_config.json)${R}${C}:${R}
  {"mcpServers":{"symbiosis":{"command":"node","args":["${distPath}"],"env":{"PRIVATE_KEY":"${keyValue}"}}}}

${C}Cursor ${D}(.cursor/mcp.json)${R}${C}:${R}
  {"mcpServers":{"symbiosis":{"command":"node","args":["${distPath}"],"env":{"PRIVATE_KEY":"${keyValue}"}}}}

${keyNote}
`);
