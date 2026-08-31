/**
 * Append-only evidence ledger.
 *
 * Each entry commits to the previous head, so any edit to a recorded decision
 * breaks every hash after it. The ledger proves what was decided; it never
 * decides anything itself.
 */

import { createHash } from "node:crypto";

import type { DecisionResult } from "./policy.ts";

export const GENESIS = "0".repeat(64);

type Entry = {
  decision: DecisionResult;
  hash: string;
};

function canonical(decision: DecisionResult): string {
  return JSON.stringify([
    decision.toolName,
    decision.callerId,
    decision.decision,
    [...decision.reasons],
    [...decision.redactFields],
  ]);
}

function link(previous: string, decision: DecisionResult): string {
  return createHash("sha256").update(previous).update("\0").update(canonical(decision)).digest("hex");
}

export class EvidenceLedger {
  readonly #entries: Entry[] = [];

  append(decision: DecisionResult): string {
    const hash = link(this.head(), decision);
    this.#entries.push({ decision, hash });
    return hash;
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
      if (link(previous, entry.decision) !== entry.hash) {
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
