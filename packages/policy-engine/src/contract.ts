/**
 * The Twin's tool contract, vendored verbatim.
 *
 * `contracts/telco-twin/mcp-tools.json` is a byte copy of the artifact the Twin
 * generates from its own source. The lock beside it records which Twin commit
 * it came from and the file's hash, and a test refuses any edit here that is
 * not accompanied by a lock update. The catalog in this repository governs
 * exactly the tools in that contract, plus one mutating decoy the Twin does not
 * export, which exists so the execution ban can be proven rather than assumed.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

export const TWIN_CONTRACT_PATH = join(repoRoot, "contracts", "telco-twin", "mcp-tools.json");
export const TWIN_LOCK_PATH = join(repoRoot, "contracts", "telco-twin", "contract-lock.json");

export type TwinTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
    readonly additionalProperties: boolean;
  };
};

export type TwinContract = {
  readonly protocolVersion: string;
  readonly tools: readonly TwinTool[];
};

export function loadTwinContract(): TwinContract {
  return JSON.parse(readFileSync(TWIN_CONTRACT_PATH, "utf8")) as TwinContract;
}
