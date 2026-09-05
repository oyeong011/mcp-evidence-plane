/**
 * The claim the two repositories exist to make, pinned as a test.
 *
 * This exercises the Twin's approval contract against the real policy engine.
 * It does not call a running Twin: the tool names and evidence flags stand in
 * for that seam, so this proves the plane's half of the contract and not the
 * cross-repo integration itself.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { Decision } from "../src/policy.ts";
import { EvidenceLedger } from "../src/ledger.ts";
import { Gateway } from "../src/gateway.ts";
import type { ToolCall } from "../src/catalog.ts";

const operator = { id: "operator-1", clearance: 2 } as const;

function step(toolName: string, evidence: { simulation: boolean; approval: boolean }): ToolCall {
  return {
    toolName,
    caller: operator,
    args: {},
    hasSimulationEvidence: evidence.simulation,
    hasApprovalEvidence: evidence.approval,
  };
}

const noEvidence = { simulation: false, approval: false };
const simulatedOnly = { simulation: true, approval: false };
const fullEvidence = { simulation: true, approval: true };

test("a patch cannot advance at any point in the approval flow", async () => {
  const ledger = new EvidenceLedger();
  const gateway = new Gateway(ledger);
  const run = async (call: ToolCall) => gateway.handle(call, async () => ({ ok: true }));

  // Straight to applying the patch, before anything has been proven.
  const premature = await run(step("twin.apply_patch", noEvidence));
  assert.equal(premature.decision.decision, Decision.Deny);

  // Asking for approval with nothing simulated.
  const unproven = await run(step("request_approval", noEvidence));
  assert.equal(unproven.decision.decision, Decision.RequireApproval);
  assert.ok(unproven.decision.reasons.includes("missing-simulation-evidence"));

  // The simulation itself is allowed; that is how evidence comes to exist.
  const simulated = await run(step("simulate_patch", simulatedOnly));
  assert.equal(simulated.decision.decision, Decision.Allow);

  // Simulated, but nobody has approved yet.
  const unapproved = await run(step("request_approval", simulatedOnly));
  assert.equal(unapproved.decision.decision, Decision.RequireApproval);
  assert.ok(unapproved.decision.reasons.includes("missing-approval-evidence"));

  // Both kinds of evidence present: the approval request itself may proceed.
  const eligible = await run(step("request_approval", fullEvidence));
  assert.equal(eligible.decision.decision, Decision.Allow);

  // And still the patch does not apply. Approval records eligibility, never execution.
  const approved = await run(step("twin.apply_patch", fullEvidence));
  assert.equal(approved.decision.decision, Decision.Deny);
  assert.ok(approved.decision.reasons.includes("mutation-authority-refused"));

  // Every step above is on the record, in order, and the chain still verifies.
  assert.equal(ledger.size(), 6);
  assert.equal(ledger.verify(), true);
});
