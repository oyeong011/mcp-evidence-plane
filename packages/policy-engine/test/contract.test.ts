import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { CATALOG } from "../src/catalog.ts";
import { loadTwinContract, TWIN_CONTRACT_PATH, TWIN_LOCK_PATH } from "../src/contract.ts";

test("the vendored Twin contract matches its lock byte for byte", () => {
  const lock = JSON.parse(readFileSync(TWIN_LOCK_PATH, "utf8")) as { sha256: string };
  const actual = createHash("sha256").update(readFileSync(TWIN_CONTRACT_PATH)).digest("hex");
  assert.equal(actual, lock.sha256, "contract file edited without updating the lock");
});

test("every Twin tool is governed by the catalog", () => {
  const contract = loadTwinContract();
  for (const tool of contract.tools) {
    assert.ok(Object.hasOwn(CATALOG, tool.name), `ungoverned Twin tool: ${tool.name}`);
  }
});

test("the catalog governs only Twin tools plus the deliberate mutating decoy", () => {
  const contract = loadTwinContract();
  const twinNames = new Set(contract.tools.map((tool) => tool.name));
  for (const [name, spec] of Object.entries(CATALOG)) {
    if (spec.mutates) {
      assert.equal(twinNames.has(name), false, "the Twin must not export a mutating tool");
      continue;
    }
    assert.ok(twinNames.has(name), `catalog tool absent from the Twin contract: ${name}`);
  }
});

test("the Twin exports no mutating tool, so the ban is enforced here, not there", () => {
  const contract = loadTwinContract();
  const mutating = Object.entries(CATALOG).filter(([, spec]) => spec.mutates).map(([n]) => n);
  assert.equal(mutating.length, 1);
  assert.equal(contract.tools.some((t) => t.name === mutating[0]), false);
});

test("request_approval is the only Twin tool that needs both kinds of evidence", () => {
  const needsBoth = Object.entries(CATALOG)
    .filter(([, s]) => s.requiresSimulation && s.requiresApproval)
    .map(([n]) => n);
  assert.deepEqual(needsBoth, ["request_approval"]);
});
