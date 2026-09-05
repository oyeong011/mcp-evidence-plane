import { test } from "node:test";
import assert from "node:assert/strict";

import { Decision, decide } from "../src/policy.ts";
import { EvidenceLedger } from "../src/ledger.ts";
import { CATALOG, type ToolCall } from "../src/catalog.ts";

const caller = { id: "operator-1", clearance: 2 } as const;

function call(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: "simulate_patch",
    caller,
    args: {},
    hasSimulationEvidence: true,
    hasApprovalEvidence: true,
    ...overrides,
  };
}

test("an unknown tool is denied rather than passed through", () => {
  assert.equal(decide(call({ toolName: "twin.definitely_not_a_tool" })).decision, Decision.Deny);
});

test("an unknown caller is denied", () => {
  assert.equal(decide(call({ caller: undefined })).decision, Decision.Deny);
});

test("a mutating tool is denied even with full evidence", () => {
  const mutating = Object.values(CATALOG).find((tool) => tool.mutates);
  assert.ok(mutating, "the catalog must carry at least one mutating tool to prove the ban");
  assert.equal(decide(call({ toolName: mutating.name })).decision, Decision.Deny);
});

test("a patch cannot advance without simulation evidence", () => {
  const result = decide(call({ toolName: "request_approval", hasSimulationEvidence: false }));
  assert.equal(result.decision, Decision.RequireApproval);
  assert.ok(result.reasons.includes("missing-simulation-evidence"));
});

test("a patch cannot advance without approval evidence", () => {
  const result = decide(call({ toolName: "request_approval", hasApprovalEvidence: false }));
  assert.equal(result.decision, Decision.RequireApproval);
});

test("a sensitive field is redacted rather than returned", () => {
  const withProse = {
    ...CATALOG,
    read_alarm_text: { ...CATALOG["diagnose_scenario"]!, name: "read_alarm_text", sensitiveFields: ["alarms"] },
  };
  const result = decide(call({ toolName: "read_alarm_text" }), withProse);
  assert.equal(result.decision, Decision.Redact);
  assert.deepEqual(result.redactFields, ["alarms"]);
});

test("insufficient clearance downgrades instead of denying outright", () => {
  const result = decide(call({ toolName: "get_scenario", caller: { id: "viewer", clearance: 0 } }));
  assert.equal(result.decision, Decision.Downgrade);
});

test("a fully cleared read is allowed", () => {
  assert.equal(decide(call({ toolName: "list_scenarios" })).decision, Decision.Allow);
});

test("the ledger chains entries so tampering is detectable", () => {
  const ledger = new EvidenceLedger();
  const first = call({ toolName: "list_scenarios" });
  const second = call({ toolName: "diagnose_scenario" });
  ledger.append(first, decide(first));
  ledger.append(second, decide(second));
  assert.equal(ledger.verify(), true);
  ledger.tamperForTest(0, "allow-everything");
  assert.equal(ledger.verify(), false);
});

test("the ledger head changes when an entry is appended", () => {
  const ledger = new EvidenceLedger();
  const before = ledger.head();
  const only = call({ toolName: "list_scenarios" });
  ledger.append(only, decide(only));
  assert.notEqual(ledger.head(), before);
});
