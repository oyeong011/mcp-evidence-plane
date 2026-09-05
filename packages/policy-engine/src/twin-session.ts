/**
 * A governed session against a live Twin.
 *
 * The Twin is spawned as a child process speaking newline-delimited JSON-RPC
 * over stdio. Every tool call goes through the gateway first; a refused call
 * is never written to the child. Simulation evidence is not something the
 * caller asserts: the session grants it only after it has itself seen a
 * successful simulate_patch and compare_runs for that scenario. Approval
 * evidence is granted only by an explicit approver action recorded here.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type { Caller, ToolCall } from "./catalog.ts";
import { Gateway, type Outcome, type ToolResult } from "./gateway.ts";
import type { EvidenceLedger } from "./ledger.ts";

type JsonRpcResponse = {
  id?: number;
  result?: { tools?: unknown[]; content?: { type: string; text: string }[] };
  error?: { code: number; message: string; data?: unknown };
};

export type TwinLaunch = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
};

export function defaultTwinLaunch(repo: string): TwinLaunch {
  return {
    command: "uv",
    args: ["run", "--project", "backend", "python", "-m", "telco_twin.mcp.stdio"],
    cwd: repo,
  };
}

export class TwinSession {
  readonly #gateway: Gateway;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, (r: JsonRpcResponse) => void>();
  readonly #simulated = new Map<string, { simulated: boolean; compared: boolean }>();
  readonly #scenarioOfSimulation = new Map<string, string>();
  readonly #approved = new Set<string>();
  #nextId = 1;
  #stderr = "";

  constructor(ledger: EvidenceLedger, launch: TwinLaunch) {
    this.#gateway = new Gateway(ledger);
    this.#child = spawn(launch.command, [...launch.args], {
      cwd: launch.cwd,
      env: { ...process.env, NODE_OPTIONS: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr += chunk.toString();
    });
    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => {
      let parsed: JsonRpcResponse;
      try {
        parsed = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      if (parsed.id !== undefined) {
        this.#pending.get(parsed.id)?.(parsed);
        this.#pending.delete(parsed.id);
      }
    });
  }

  stderr(): string {
    return this.#stderr;
  }

  async initialize(): Promise<void> {
    const reply = await this.#request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-evidence-plane", version: "0.0.1" },
    });
    if (reply.error) {
      throw new Error(`twin-initialize-failed: ${reply.error.message}`);
    }
    this.#notify("notifications/initialized");
  }

  async listTools(): Promise<string[]> {
    const reply = await this.#request("tools/list", {});
    const tools = (reply.result?.tools ?? []) as { name: string }[];
    return tools.map((tool) => tool.name);
  }

  /** Record that a named approver accepted a scenario. This never executes anything. */
  approve(scenarioId: string, approverId: string): void {
    if (!approverId) {
      throw new Error("approver-required");
    }
    this.#approved.add(scenarioId);
  }

  #scenarioFor(args: Record<string, unknown>): string | null {
    if (typeof args["scenario_id"] === "string") return args["scenario_id"];
    if (typeof args["simulation_id"] === "string") {
      return this.#scenarioOfSimulation.get(args["simulation_id"]) ?? null;
    }
    return null;
  }

  async call(toolName: string, caller: Caller, args: Record<string, unknown>): Promise<Outcome> {
    const scenarioId = this.#scenarioFor(args);
    const state = scenarioId ? this.#simulated.get(scenarioId) : undefined;
    const call: ToolCall = {
      toolName,
      caller,
      args,
      hasSimulationEvidence: Boolean(state?.simulated && state?.compared),
      hasApprovalEvidence: scenarioId !== null && this.#approved.has(scenarioId),
    };
    const outcome = await this.#gateway.handle(call, async () => this.#invoke(toolName, args));
    if (outcome.result !== null && !outcome.failed && scenarioId) {
      const current = this.#simulated.get(scenarioId) ?? { simulated: false, compared: false };
      const result = outcome.result;
      if (toolName === "simulate_patch" && typeof result["simulation_id"] === "string") {
        this.#scenarioOfSimulation.set(result["simulation_id"], scenarioId);
        current.simulated = true;
      }
      // Comparison counts as evidence only when the Twin itself judged the
      // candidate approval-eligible. A comparison that failed its constraints
      // is recorded, but it does not move the patch forward.
      if (toolName === "compare_runs" && result["approval_eligible"] === true) {
        current.compared = true;
      }
      this.#simulated.set(scenarioId, current);
    }
    return outcome;
  }

  async close(): Promise<void> {
    this.#child.stdin.end();
    await new Promise<void>((resolve) => this.#child.once("close", () => resolve()));
  }

  async #invoke(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const reply = await this.#request("tools/call", { name, arguments: args });
    if (reply.error) {
      throw new Error(`twin-tool-error: ${reply.error.message}`);
    }
    const text = reply.result?.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new Error("twin-tool-error: empty content");
    }
    return JSON.parse(text) as ToolResult;
  }

  #request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.#nextId++;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`twin-timeout: ${method}`));
      }, 60_000);
      this.#pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.#child.stdin.write(`${line}\n`);
    });
  }

  #notify(method: string): void {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }
}
