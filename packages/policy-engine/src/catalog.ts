/**
 * The closed tool catalog the proxy is willing to describe.
 *
 * A tool absent from this catalog cannot be reached: the gateway fails closed
 * rather than forwarding a call it cannot classify. Mutating tools are listed
 * so the ban on execution authority is enforced explicitly, not by omission.
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
};

function spec(partial: Partial<ToolSpec> & { name: string }): ToolSpec {
  return {
    mutates: false,
    requiresSimulation: false,
    requiresApproval: false,
    minimumClearance: 0,
    sensitiveFields: [],
    ...partial,
  };
}

export const CATALOG: Readonly<Record<string, ToolSpec>> = Object.freeze({
  "twin.read_scenario": spec({ name: "twin.read_scenario" }),
  "twin.read_topology": spec({ name: "twin.read_topology", minimumClearance: 2 }),
  "twin.read_alarms": spec({
    name: "twin.read_alarms",
    minimumClearance: 1,
    // Alarm prose is attacker-controlled text and never reaches a model verbatim.
    sensitiveFields: ["message"],
  }),
  "twin.run_counterfactual": spec({ name: "twin.run_counterfactual", minimumClearance: 1 }),
  "twin.request_approval": spec({
    name: "twin.request_approval",
    requiresSimulation: true,
    requiresApproval: true,
    minimumClearance: 2,
  }),
  "twin.apply_patch": spec({ name: "twin.apply_patch", mutates: true, minimumClearance: 3 }),
});
