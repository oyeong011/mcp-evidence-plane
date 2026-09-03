/**
 * Deterministic policy engine.
 *
 * The same call always yields the same decision and the same ordered reasons,
 * so a decision can be replayed from the ledger and compared byte for byte.
 * Every unrecognised condition resolves to Deny.
 *
 * A decision depends on the tool, the caller, and the two evidence flags. It
 * never depends on the arguments, which is what lets the ledger keep only a
 * hash of them and still replay every decision exactly.
 */

import { CATALOG, type ToolCall, type ToolSpec } from "./catalog.ts";

export const Decision = Object.freeze({
  Allow: "allow",
  Deny: "deny",
  Redact: "redact",
  RequireApproval: "require_approval",
  Downgrade: "downgrade",
} as const);

export type DecisionName = (typeof Decision)[keyof typeof Decision];

export type DecisionResult = {
  readonly toolName: string;
  readonly callerId: string | null;
  readonly decision: DecisionName;
  readonly reasons: readonly string[];
  readonly redactFields: readonly string[];
};

export type Catalog = Readonly<Record<string, ToolSpec>>;

function result(
  call: ToolCall,
  decision: DecisionName,
  reasons: readonly string[],
  redactFields: readonly string[] = [],
): DecisionResult {
  return {
    toolName: call.toolName,
    callerId: call.caller?.id ?? null,
    decision,
    reasons,
    redactFields,
  };
}

function approvalReasons(call: ToolCall, tool: ToolSpec): readonly string[] {
  const reasons: string[] = [];
  if (tool.requiresSimulation && !call.hasSimulationEvidence) {
    reasons.push("missing-simulation-evidence");
  }
  if (tool.requiresApproval && !call.hasApprovalEvidence) {
    reasons.push("missing-approval-evidence");
  }
  return reasons;
}

export function decide(call: ToolCall, catalog: Catalog = CATALOG): DecisionResult {
  const tool = Object.hasOwn(catalog, call.toolName) ? catalog[call.toolName] : undefined;
  if (tool === undefined) {
    return result(call, Decision.Deny, ["unknown-tool"]);
  }
  if (call.caller === undefined) {
    return result(call, Decision.Deny, ["unknown-caller"]);
  }
  if (tool.mutates) {
    // No path in this system grants execution authority, whatever the evidence.
    return result(call, Decision.Deny, ["mutation-authority-refused"]);
  }
  const missing = approvalReasons(call, tool);
  if (missing.length > 0) {
    return result(call, Decision.RequireApproval, missing);
  }
  if (call.caller.clearance < tool.minimumClearance) {
    return result(call, Decision.Downgrade, ["insufficient-clearance"]);
  }
  if (tool.sensitiveFields.length > 0) {
    return result(call, Decision.Redact, ["sensitive-fields-present"], tool.sensitiveFields);
  }
  return result(call, Decision.Allow, []);
}
