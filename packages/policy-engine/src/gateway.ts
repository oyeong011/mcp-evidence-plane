/**
 * Enforcement.
 *
 * The policy engine decides; this applies the decision. A refused call never
 * reaches the tool, a redacted result loses its classified fields before the
 * caller sees it, and every call is committed to the ledger whether it ran or
 * not. A refusal that is not recorded is indistinguishable from one that never
 * happened.
 */

import type { ToolCall } from "./catalog.ts";
import { CATALOG } from "./catalog.ts";
import type { EvidenceLedger } from "./ledger.ts";
import { Decision, decide, type DecisionResult } from "./policy.ts";

export type ToolResult = Record<string, unknown>;

export type Outcome = {
  readonly decision: DecisionResult;
  readonly result: ToolResult | null;
  /** The tool raised. Its message is never carried out of this module. */
  readonly failed: boolean;
};

function pick(result: ToolResult, fields: readonly string[]): ToolResult {
  const kept: ToolResult = {};
  for (const field of fields) {
    if (Object.hasOwn(result, field)) {
      kept[field] = result[field];
    }
  }
  return kept;
}

function omit(result: ToolResult, fields: readonly string[]): ToolResult {
  const kept: ToolResult = { ...result };
  for (const field of fields) {
    delete kept[field];
  }
  return kept;
}

export class Gateway {
  readonly #ledger: EvidenceLedger;

  constructor(ledger: EvidenceLedger) {
    this.#ledger = ledger;
  }

  async handle(
    call: ToolCall,
    execute: (call: ToolCall) => Promise<ToolResult>,
  ): Promise<Outcome> {
    const decision = decide(call);
    this.#ledger.append(call, decision);
    if (decision.decision === Decision.Deny || decision.decision === Decision.RequireApproval) {
      return { decision, result: null, failed: false };
    }
    let raw: ToolResult;
    try {
      raw = await execute(call);
    } catch {
      // The message may carry a connection string or a token. It is dropped
      // here rather than sanitised, because sanitising is a guess.
      return { decision, result: null, failed: true };
    }
    return { decision, result: this.#project(call, decision, raw), failed: false };
  }

  #project(call: ToolCall, decision: DecisionResult, raw: ToolResult): ToolResult {
    const tool = CATALOG[call.toolName];
    switch (decision.decision) {
      case Decision.Redact:
        return omit(raw, decision.redactFields);
      case Decision.Downgrade:
        return pick(raw, tool?.downgradeFields ?? []);
      default:
        return raw;
    }
  }
}
