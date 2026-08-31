# MCP Evidence Plane

A governed proxy for agent tool calls. Every call is classified against a closed
catalog, decided by a deterministic policy engine, and committed to an
append-only evidence ledger that makes later tampering detectable.

It is the second half of a pair. The first,
[telco-counterfactual-twin](https://github.com/oyeong011/telco-counterfactual-twin),
proves a proposed network change in a deterministic simulation before an
evidence-only approval. This repository governs how an agent is allowed to reach
those tools at all.

## Status — read this before judging scope

Implemented and tested:

- the deterministic policy engine and its five decisions
- the closed tool catalog, including the mutating tool that exists to prove the
  execution ban is enforced rather than assumed
- the hash-chained evidence ledger and its tamper detection

Not implemented: the Fastify MCP transport, the Postgres-backed registry, the
React audit dashboard, the replay/evaluator worker, Docker Compose, CI, and any
cloud deployment. Those need credentials and carry billing risk, so they are
gated on an explicit human decision rather than assumed.

No number in this README comes from anywhere but `npm test`.

## Decisions

| Decision | When |
| --- | --- |
| `deny` | unknown tool, unknown caller, or any mutating tool |
| `require_approval` | simulation or approval evidence is missing |
| `downgrade` | the caller's clearance is below the tool's |
| `redact` | the result carries fields classified sensitive |
| `allow` | none of the above applies |

Rules are evaluated in that fixed order, so the same call always produces the
same decision and the same ordered reasons, and a decision can be replayed from
the ledger and compared byte for byte.

## What it refuses to do

No path grants execution authority. `twin.apply_patch` is listed in the catalog
and is denied unconditionally, with full simulation and approval evidence
present. Approval records eligibility; it never applies a change.

Alarm prose is attacker-controlled text. `twin.read_alarms` is redacted rather
than returned, so injected instructions never reach a model verbatim.

Unrecognised input fails closed: a tool absent from the catalog is denied, not
forwarded.

## Run it

```bash
npm test
```

Node 24 or newer runs the TypeScript sources directly. The engine has no runtime
dependencies.
