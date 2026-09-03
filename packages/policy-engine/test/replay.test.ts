import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG, type ToolCall, type ToolSpec } from "../src/catalog.ts";
import { Decision } from "../src/policy.ts";
import { EvidenceLedger } from "../src/ledger.ts";
import { Gateway } from "../src/gateway.ts";
import { replay } from "../src/replay.ts";

const operator = { id: "operator-1", clearance: 2 } as const;

function call(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: "twin.read_scenario",
    caller: operator,
    args: {},
    hasSimulationEvidence: true,
    hasApprovalEvidence: true,
    ...overrides,
  };
}

async function recordedLedger(): Promise<EvidenceLedger> {
  const ledger = new EvidenceLedger();
  const gateway = new Gateway(ledger);
  const run = async (c: ToolCall) => gateway.handle(c, async () => ({ ok: true }));
  await run(call());
  await run(call({ toolName: "twin.apply_patch" }));
  await run(call({ toolName: "twin.read_alarms" }));
  await run(call({ toolName: "twin.request_approval", hasApprovalEvidence: false }));
  return ledger;
}

test("replaying an unchanged policy reproduces every recorded decision", async () => {
  const ledger = await recordedLedger();
  const report = replay(ledger);
  assert.equal(report.total, 4);
  assert.deepEqual(report.divergences, []);
});

test("a policy change since the record shows up as a divergence at the right entry", async () => {
  const ledger = await recordedLedger();
  const stricter: Record<string, ToolSpec> = {
    ...CATALOG,
    "twin.read_scenario": { ...CATALOG["twin.read_scenario"]!, minimumClearance: 5 },
  };
  const report = replay(ledger, stricter);
  assert.equal(report.divergences.length, 1);
  const [drift] = report.divergences;
  assert.equal(drift!.index, 0);
  assert.equal(drift!.recorded.decision, Decision.Allow);
  assert.equal(drift!.replayed.decision, Decision.Downgrade);
});

test("arguments are hashed into the record, never stored", async () => {
  const ledger = new EvidenceLedger();
  const gateway = new Gateway(ledger);
  await gateway.handle(call({ args: { token: "hunter2-secret-value" } }), async () => ({}));
  const serialized = JSON.stringify(ledger.entries());
  assert.equal(serialized.includes("hunter2"), false);
  assert.match(ledger.entries()[0]!.call.argsHash, /^[0-9a-f]{64}$/);
});

test("two calls that differ only in arguments get different records", async () => {
  const ledger = new EvidenceLedger();
  const gateway = new Gateway(ledger);
  await gateway.handle(call({ args: { cell: "cell-0001" } }), async () => ({}));
  await gateway.handle(call({ args: { cell: "cell-0002" } }), async () => ({}));
  const [first, second] = ledger.entries();
  assert.notEqual(first!.call.argsHash, second!.call.argsHash);
});

test("a tampered ledger is refused before anything is replayed", async () => {
  const ledger = await recordedLedger();
  ledger.tamperForTest(1, "allow-everything");
  assert.throws(() => replay(ledger), /ledger-integrity/);
});
