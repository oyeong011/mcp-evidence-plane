/**
 * The closed tool catalog the proxy is willing to describe.
 *
 * Names are the Twin's own, from the vendored contract; a contract test keeps
 * the two sets equal. A tool absent from this catalog cannot be reached: the
 * gateway fails closed rather than forwarding a call it cannot classify.
 *
 * `twin.apply_patch` is the one name the Twin does not export. It is listed so
 * the ban on execution authority is enforced explicitly and can be tested,
 * instead of holding only because nobody happened to add such a tool.
 */

export type Caller = {
  readonly id: string;
  readonly clearance: number;
};

export type ToolCall = {
  readonly toolName: string;
  readonly caller: Caller | undefined;
  readonly args: Record<string, unknown>;
  readonly hasSimulationEvidence: boolean;
  readonly hasApprovalEvidence: boolean;
};

export type ToolSpec = {
  readonly name: string;
  /** A mutating tool is always refused; the plane records eligibility only. */
  readonly mutates: boolean;
  readonly requiresSimulation: boolean;
  readonly requiresApproval: boolean;
  readonly minimumClearance: number;
  /** Fields stripped from a result before it reaches the caller. */
  readonly sensitiveFields: readonly string[];
  /** The only fields returned when the caller is below the required clearance. */
  readonly downgradeFields: readonly string[];
};

function spec(partial: Partial<ToolSpec> & { name: string }): ToolSpec {
  return {
    mutates: false,
    requiresSimulation: false,
    requiresApproval: false,
    minimumClearance: 0,
    sensitiveFields: [],
    downgradeFields: [],
    ...partial,
  };
}

export const CATALOG: Readonly<Record<string, ToolSpec>> = Object.freeze({
  list_scenarios: spec({ name: "list_scenarios" }),
  get_scenario: spec({
    name: "get_scenario",
    minimumClearance: 1,
    // A viewer learns that a scenario exists, never its hashes or target.
    downgradeFields: ["scenario_id"],
  }),
  // The Twin's tools return evidence identifiers and hashes, never alarm prose,
  // so no Twin tool carries a sensitive field today. The redaction path is kept
  // and unit-tested against an injected catalog for the day one does.
  diagnose_scenario: spec({ name: "diagnose_scenario", minimumClearance: 1 }),
  propose_patch: spec({ name: "propose_patch", minimumClearance: 2 }),
  simulate_patch: spec({ name: "simulate_patch", minimumClearance: 1 }),
  compare_runs: spec({ name: "compare_runs", minimumClearance: 1 }),
  request_approval: spec({
    name: "request_approval",
    requiresSimulation: true,
    requiresApproval: true,
    minimumClearance: 2,
  }),
  "twin.apply_patch": spec({ name: "twin.apply_patch", mutates: true, minimumClearance: 3 }),
});
