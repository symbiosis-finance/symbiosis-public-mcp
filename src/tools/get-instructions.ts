import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillPath = resolve(__dirname, "../../SKILL.md");

let cached: string | null = null;

export function getInstructions(): string {
  if (!cached) {
    cached = readFileSync(skillPath, "utf-8");
  }
  return cached;
}
