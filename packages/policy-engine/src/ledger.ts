/**
 * Append-only evidence ledger.
 *
 * Each entry commits to the previous head, so any edit to a recorded decision
 * breaks every hash after it. The ledger proves what was decided and on what
 * inputs; it never decides anything itself.
 *
 * Arguments are recorded as a hash. They may carry identifiers or secrets, and
 * the policy never reads them, so keeping the hash preserves provenance while
 * keeping the content out of the record.
 */

import { createHash } from "node:crypto";

import type { ToolCall } from "./catalog.ts";
import type { DecisionResult } from "./policy.ts";

export const GENESIS = "0".repeat(64);

export type RecordedCall = {
  readonly toolName: string;
  readonly callerId: string | null;
  readonly clearance: number | null;
  readonly argsHash: string;
  readonly hasSimulationEvidence: boolean;
  readonly hasApprovalEvidence: boolean;
};

export type LedgerEntry = {
  readonly call: RecordedCall;
  readonly decision: DecisionResult;
  readonly hash: string;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function recordCall(call: ToolCall): RecordedCall {
  return {
    toolName: call.toolName,
    callerId: call.caller?.id ?? null,
    clearance: call.caller?.clearance ?? null,
    argsHash: sha256(canonicalJson(call.args)),
    hasSimulationEvidence: call.hasSimulationEvidence,
    hasApprovalEvidence: call.hasApprovalEvidence,
  };
}

function link(previous: string, call: RecordedCall, decision: DecisionResult): string {
  return sha256(`${previous}\0${canonicalJson(call)}\0${canonicalJson(decision)}`);
}

export class EvidenceLedger {
  readonly #entries: LedgerEntry[] = [];

  append(call: ToolCall, decision: DecisionResult): string {
    const recorded = recordCall(call);
    const hash = link(this.head(), recorded, decision);
    this.#entries.push({ call: recorded, decision, hash });
    return hash;
  }

  entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  head(): string {
    return this.#entries.at(-1)?.hash ?? GENESIS;
  }

  size(): number {
    return this.#entries.length;
  }

  verify(): boolean {
    let previous = GENESIS;
    for (const entry of this.#entries) {
      if (link(previous, entry.call, entry.decision) !== entry.hash) {
        return false;
      }
      previous = entry.hash;
    }
    return true;
  }

  /** Rewrite a recorded reason in place so a test can prove detection works. */
  tamperForTest(index: number, reason: string): void {
    const entry = this.#entries[index];
    if (entry === undefined) {
      throw new RangeError(`no ledger entry at ${index}`);
    }
    this.#entries[index] = {
      ...entry,
      decision: { ...entry.decision, reasons: [reason] },
    };
  }
}
