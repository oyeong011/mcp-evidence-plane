/**
 * The plane as an MCP server.
 *
 * Speaks newline-delimited JSON-RPC on stdin/stdout, fronts one governed Twin
 * session, and advertises only the governed tool set: the mutating decoy is
 * never listed, and calling it by name is refused like any other refusal.
 *
 * The caller's identity comes from the environment that launched the server
 * (PLANE_CALLER_ID, PLANE_CALLER_CLEARANCE). A refused call is a JSON-RPC
 * error whose data carries the decision and its ordered reasons; an allowed
 * call returns the tool's content plus a `_plane` block naming the decision
 * that let it through, so a client can tell a downgraded answer from a full one.
 */

import { createInterface } from "node:readline";

import { CATALOG } from "./catalog.ts";
import { loadTwinContract } from "./contract.ts";
import { EvidenceLedger } from "./ledger.ts";
import { Decision } from "./policy.ts";
import { TwinSession, defaultTwinLaunch } from "./twin-session.ts";

const PROTOCOL = "2025-06-18";
const REFUSED = -32010;

type Request = { id?: number; method?: string; params?: Record<string, unknown> };

function reply(id: number | undefined, body: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`);
}

function error(id: number | undefined, code: number, message: string, data?: Record<string, unknown>): void {
  reply(id, { error: { code, message, ...(data ? { data } : {}) } });
}

function callerFromEnv(): { id: string; clearance: number } | undefined {
  const id = process.env["PLANE_CALLER_ID"];
  const clearance = Number(process.env["PLANE_CALLER_CLEARANCE"]);
  if (!id || !Number.isInteger(clearance)) return undefined;
  return { id, clearance };
}

async function main(): Promise<void> {
  const repo = process.env["TWIN_REPO"];
  if (!repo) {
    process.stderr.write("TWIN_REPO is required\n");
    process.exit(2);
  }
  const ledger = new EvidenceLedger();
  const session = new TwinSession(ledger, defaultTwinLaunch(repo));
  await session.initialize();
  const caller = callerFromEnv();
  const advertised = loadTwinContract().tools.filter(
    (tool) => Object.hasOwn(CATALOG, tool.name) && !CATALOG[tool.name]!.mutates,
  );
  let initialized = false;

  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      error(undefined, -32700, "bad json");
      continue;
    }
    const { id, method, params = {} } = request;
    if (id === undefined) {
      if (method === "notifications/initialized") initialized = true;
      continue;
    }
    switch (method) {
      case "initialize":
        reply(id, {
          result: {
            protocolVersion: PROTOCOL,
            capabilities: { tools: {} },
            serverInfo: { name: "mcp-evidence-plane", version: "0.0.1" },
          },
        });
        break;
      case "tools/list":
        if (!initialized) { error(id, -32002, "initialize is incomplete"); break; }
        reply(id, { result: { tools: advertised } });
        break;
      case "tools/call": {
        if (!initialized) { error(id, -32002, "initialize is incomplete"); break; }
        const name = typeof params["name"] === "string" ? params["name"] : "";
        const args = (params["arguments"] ?? {}) as Record<string, unknown>;
        const outcome = await session.call(name, caller ?? { id: "", clearance: -1 }, caller ? args : args);
        const decision = outcome.decision;
        if (decision.decision === Decision.Deny || decision.decision === Decision.RequireApproval) {
          error(id, REFUSED, `refused: ${decision.decision}`, { decision: decision.decision, reasons: decision.reasons });
          break;
        }
        if (outcome.failed || outcome.result === null) {
          error(id, REFUSED, "tool failed", { decision: decision.decision, reasons: ["tool-failed"] });
          break;
        }
        reply(id, {
          result: {
            content: [{ type: "text", text: JSON.stringify(outcome.result) }],
            _plane: { decision: decision.decision, reasons: decision.reasons, ledgerHead: ledger.head() },
          },
        });
        break;
      }
      default:
        error(id, -32601, "method not found");
    }
  }
  await session.close();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
