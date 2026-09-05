/**
 * The plane as a server: an MCP client speaks to the plane, never to the Twin.
 *
 * `serve.ts` is spawned as a child. It exposes the governed tool set over
 * newline-delimited JSON-RPC, and every tools/call is decided by the gateway
 * before anything is forwarded to the Twin it fronts. A refused call comes back
 * as a JSON-RPC error carrying the decision and its reasons.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serve = join(here, "..", "src", "serve.ts");
const repo = process.env["TWIN_REPO"] ?? join(process.env["HOME"] ?? "", "Projects", "telco-counterfactual-twin");
const available = existsSync(join(repo, "backend", "src", "telco_twin", "mcp", "stdio.py"));

type Reply = { id?: number; result?: Record<string, unknown>; error?: { code: number; message: string; data?: Record<string, unknown> } };

function client(env: Record<string, string>) {
  const child = spawn(process.execPath, [serve], { env: { ...process.env, ...env, NODE_OPTIONS: "" }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, (r: Reply) => void>();
  let next = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const reply = JSON.parse(line) as Reply;
      if (reply.id !== undefined) pending.get(reply.id)?.(reply);
    } catch { /* not for us */ }
  });
  let stderr = "";
  child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
  let closed: Error | null = null;
  child.once("close", (code) => { closed = new Error(`server exited (${code}): ${stderr}`); for (const r of pending.values()) r({ error: { code: -1, message: closed.message } }); pending.clear(); });
  const request = (method: string, params: Record<string, unknown>): Promise<Reply> =>
    new Promise((resolve) => {
      if (closed) { resolve({ error: { code: -1, message: closed.message } }); return; }
      const id = next++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  const close = () => new Promise<void>((resolve) => { child.stdin.end(); child.once("close", () => resolve()); });
  return { request, notify, close };
}

test("the plane serves MCP and refuses at its own boundary", { skip: !available && "TWIN_REPO not found" }, async () => {
  const c = client({ TWIN_REPO: repo, PLANE_CALLER_ID: "operator-1", PLANE_CALLER_CLEARANCE: "2" });
  try {
    const init = await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    assert.equal((init.result as { serverInfo: { name: string } }).serverInfo.name, "mcp-evidence-plane");
    c.notify("notifications/initialized");

    const list = await c.request("tools/list", {});
    const names = ((list.result as { tools: { name: string }[] }).tools).map((t) => t.name);
    assert.ok(names.includes("list_scenarios"));
    assert.equal(names.includes("twin.apply_patch"), false, "the decoy is never advertised");

    const ok = await c.request("tools/call", { name: "list_scenarios", arguments: {} });
    assert.equal(ok.error, undefined, JSON.stringify(ok));
    const text = (ok.result as { content: { text: string }[] }).content[0]!.text;
    assert.ok(JSON.parse(text).scenarios.length >= 1);

    const refused = await c.request("tools/call", { name: "twin.apply_patch", arguments: {} });
    assert.ok(refused.error, "a mutating call must come back as a JSON-RPC error");
    assert.equal(refused.error!.data!["decision"], "deny");
    assert.deepEqual(refused.error!.data!["reasons"], ["mutation-authority-refused"]);

    const unknown = await c.request("tools/call", { name: "not_a_tool", arguments: {} });
    assert.equal(unknown.error!.data!["decision"], "deny");
  } finally {
    await c.close();
  }
});

test("a viewer identity is downgraded by the server, not by the client", { skip: !available && "TWIN_REPO not found" }, async () => {
  const c = client({ TWIN_REPO: repo, PLANE_CALLER_ID: "viewer-1", PLANE_CALLER_CLEARANCE: "0" });
  try {
    await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    c.notify("notifications/initialized");
    const list = await c.request("tools/call", { name: "list_scenarios", arguments: {} });
    const sid = JSON.parse((list.result as { content: { text: string }[] }).content[0]!.text).scenarios[0].scenario_id as string;
    const peek = await c.request("tools/call", { name: "get_scenario", arguments: { scenario_id: sid } });
    const body = JSON.parse((peek.result as { content: { text: string }[] }).content[0]!.text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ["scenario_id"]);
    assert.equal((peek.result as { _plane: { decision: string } })._plane.decision, "downgrade");
  } finally {
    await c.close();
  }
});
