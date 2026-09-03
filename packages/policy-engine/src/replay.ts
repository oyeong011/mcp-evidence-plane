/**
 * Trace replay.
 *
 * Re-derive every recorded decision from its recorded inputs and compare it to
 * what the ledger says was decided. A divergence means the policy in force now
 * is not the policy that was in force then, so the record can show not only
 * what happened but whether it would still happen.
 *
 * Replay refuses a ledger whose chain does not verify. Replaying a tampered
 * record would lend it the appearance of having been checked.
 */

import type { ToolCall } from "./catalog.ts";
import type { EvidenceLedger, RecordedCall } from "./ledger.ts";
import { decide, type Catalog, type DecisionResult } from "./policy.ts";

export type Divergence = {
  readonly index: number;
  readonly recorded: DecisionResult;
  readonly replayed: DecisionResult;
};

export type ReplayReport = {
  readonly total: number;
  readonly divergences: readonly Divergence[];
};

function callFromRecord(record: RecordedCall): ToolCall {
  return {
    toolName: record.toolName,
    caller:
      record.callerId !== null && record.clearance !== null
        ? { id: record.callerId, clearance: record.clearance }
        : undefined,
    // Arguments are not part of any decision, so the hash is provenance only
    // and the replay does not need the content back.
    args: {},
    hasSimulationEvidence: record.hasSimulationEvidence,
    hasApprovalEvidence: record.hasApprovalEvidence,
  };
}

function sameDecision(left: DecisionResult, right: DecisionResult): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function replay(ledger: EvidenceLedger, catalog?: Catalog): ReplayReport {
  if (!ledger.verify()) {
    throw new Error("ledger-integrity: chain does not verify; refusing to replay");
  }
  const divergences: Divergence[] = [];
  ledger.entries().forEach((entry, index) => {
    const replayed = decide(callFromRecord(entry.call), catalog);
    if (!sameDecision(entry.decision, replayed)) {
      divergences.push({ index, recorded: entry.decision, replayed });
    }
  });
  return { total: ledger.size(), divergences };
}
