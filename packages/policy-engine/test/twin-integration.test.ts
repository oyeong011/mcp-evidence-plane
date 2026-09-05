/**
 * The cross-repository proof: every Twin tool call passes through the plane,
 * and a patch cannot advance without simulation plus approval evidence.
 *
 * This spawns the real Twin stdio server from a local checkout named by
 * TWIN_REPO. Without it the suite is skipped, and says so, rather than
 * pretending with a mock.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { Decision } from "../src/policy.ts";
import { EvidenceLedger } from "../src/ledger.ts";
import { TwinSession, defaultTwinLaunch } from "../src/twin-session.ts";
import { replay } from "../src/replay.ts";

const repo = process.env["TWIN_REPO"] ?? join(process.env["HOME"] ?? "", "Projects", "telco-counterfactual-twin");
const available = existsSync(join(repo, "backend", "src", "telco_twin", "mcp", "stdio.py"));

const operator = { id: "operator-1", clearance: 2 } as const;
const viewer = { id: "viewer-1", clearance: 0 } as const;

test("a live Twin session is governed end to end", { skip: !available && "TWIN_REPO not found" }, async () => {
  const ledger = new EvidenceLedger();
  const session = new TwinSession(ledger, defaultTwinLaunch(repo));
  try {
    await session.initialize();
    const tools = await session.listTools();
    assert.ok(tools.includes("request_approval"));
    assert.equal(tools.includes("twin.apply_patch"), false, "the Twin must not export a mutating tool");

    const listed = await session.call("list_scenarios", operator, {});
    assert.equal(listed.decision.decision, Decision.Allow);
    const scenarios = (listed.result as { scenarios: { scenario_id: string }[] }).scenarios;
    const scenarioId = scenarios[0]!.scenario_id;

    // A viewer sees that the scenario exists, not its hashes or target.
    const peek = await session.call("get_scenario", viewer, { scenario_id: scenarioId });
    assert.equal(peek.decision.decision, Decision.Downgrade);
    assert.deepEqual(Object.keys(peek.result ?? {}), ["scenario_id"]);

    // The Twin's evidence surface carries identifiers and hashes, never prose.
    const diagnosed = await session.call("diagnose_scenario", operator, { scenario_id: scenarioId });
    assert.equal(diagnosed.decision.decision, Decision.Allow);
    for (const value of Object.values(diagnosed.result ?? {})) {
      assert.ok(typeof value !== "string" || value.length < 120, "unexpected prose in evidence");
    }

    // Approval before any simulation is refused, and the Twin never hears about it.
    const early = await session.call("request_approval", operator, { scenario_id: scenarioId, simulation_id: "none", comparison_id: "none" });
    assert.equal(early.decision.decision, Decision.RequireApproval);
    assert.ok(early.decision.reasons.includes("missing-simulation-evidence"));

    const proposed = await session.call("propose_patch", operator, { scenario_id: scenarioId, target_id: "cell-0001" });
    assert.equal(proposed.decision.decision, Decision.Allow, JSON.stringify(proposed));
    const patchId = (proposed.result as { patch_id: string }).patch_id;

    const simulated = await session.call("simulate_patch", operator, { scenario_id: scenarioId, patch_id: patchId });
    assert.equal(simulated.decision.decision, Decision.Allow, JSON.stringify(simulated));
    const simulationId = (simulated.result as { simulation_id: string }).simulation_id;

    const compared = await session.call("compare_runs", operator, { simulation_id: simulationId });
    assert.equal(compared.decision.decision, Decision.Allow, JSON.stringify(compared));
    const comparisonId = (compared.result as { comparison_id: string }).comparison_id;
    assert.equal((compared.result as { approval_eligible: boolean }).approval_eligible, true);

    // Simulated and compared, but nobody has approved: still refused.
    const unapproved = await session.call("request_approval", operator, { simulation_id: simulationId, comparison_id: comparisonId });
    assert.equal(unapproved.decision.decision, Decision.RequireApproval);
    assert.ok(unapproved.decision.reasons.includes("missing-approval-evidence"));

    // A named approver records eligibility. Now the request itself may reach the Twin.
    session.approve(scenarioId, "approver-1");
    const approved = await session.call("request_approval", operator, { simulation_id: simulationId, comparison_id: comparisonId });
    assert.equal(approved.decision.decision, Decision.Allow, JSON.stringify(approved));
    // The Twin's own answer agrees: an approval request is recorded, and no change is permitted.
    assert.equal((approved.result as { network_change_permitted: boolean }).network_change_permitted, false);
    assert.equal((approved.result as { status: string }).status, "draft");

    // And still nothing applies. The mutating name is refused before the child is written to.
    const apply = await session.call("twin.apply_patch", operator, { scenario_id: scenarioId, patch_id: patchId });
    assert.equal(apply.decision.decision, Decision.Deny);
    assert.equal(apply.result, null);

    // Every step is on the ledger and the record replays cleanly.
    assert.equal(ledger.size(), 10);
    assert.equal(ledger.verify(), true);
    assert.deepEqual(replay(ledger).divergences, []);
  } finally {
    await session.close();
  }
});
