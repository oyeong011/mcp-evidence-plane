# MCP Evidence Plane

> **한국어 요약** — 에이전트의 도구 호출을 통제하고 증거로 남기는 결정 코어입니다. 모든 호출을 닫힌 카탈로그에 대조해 분류하고, 결정론적 정책 엔진이 `allow / deny / redact / require_approval / downgrade` 다섯 결정 중 하나를 고정된 순서로 내리며, 해시 체인 원장에 기록합니다. 변형(mutating) 도구는 시뮬레이션·승인 증거를 완비해도 **무조건 거부**됩니다 — 승인은 자격을 기록할 뿐 집행이 아닙니다. 리플레이는 기록된 입력으로 모든 결정을 재도출해 현재 정책과 바이트 단위로 대조하므로, 정책이 바뀌면 어느 항목이 달라지는지 정확히 드러납니다. 런타임 의존성 0, `npm test`로 29개 테스트. **실제 Twin 프로세스를 자식으로 띄워 도구 7개를 전부 게이트웨이 너머로 호출하는 통합 테스트**가 포함되며, CI는 vendoring된 계약이 가리키는 Twin 커밋을 그대로 체크아웃해 이를 실행합니다. 시뮬레이션 증거는 호출자가 주장하는 것이 아니라 Plane이 Twin의 `approval_eligible: true`를 직접 본 뒤에만 인정합니다. **미구현**: 호출자 쪽 인바운드 트랜스포트·DB·대시보드·배포.

A governed proxy for agent tool calls. Every call is classified against a closed
catalog, decided by a deterministic policy engine, and committed to an
append-only evidence ledger that makes later tampering detectable.

It is the second half of a pair. The first,
[telco-counterfactual-twin](https://github.com/oyeong011/telco-counterfactual-twin),
proves a proposed network change in a deterministic simulation before an
evidence-only approval. This repository governs how an agent is allowed to reach
those tools at all.

## Status — read this before judging scope

Implemented and tested (29 tests, `npm test`):

- the deterministic policy engine and its five decisions
- the closed tool catalog, including the mutating tool that exists to prove the
  execution ban is enforced rather than assumed
- the hash-chained evidence ledger and its tamper detection
- the gateway that applies each decision: a refused call never reaches the tool,
  a redacted result loses its classified fields, a downgraded call returns only
  what the caller's clearance allows, and every call is recorded whether it ran
  or not
- the approval flow, run end to end through the real engine
- trace replay: every recorded decision is re-derived from its recorded inputs
  and compared to the record, so a policy change since then shows up as a
  divergence at the exact entry
- **a live session against the real Twin**: the Twin's stdio MCP server is
  spawned as a child process and every one of its seven tools is called through
  the gateway; a refused call is never written to the child
- the Twin's tool contract, vendored byte for byte with a lock naming the Twin
  commit it came from; a test refuses any edit here without a lock update, and
  CI runs the integration against that exact pinned commit

Not implemented: an inbound MCP transport for callers (the plane currently acts
as an MCP client to the Twin, not as a server), the Postgres-backed registry,
the React audit dashboard, the evaluator worker, Docker Compose, and any cloud
deployment. Those need credentials and carry billing risk, so they are
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

## Evidence is observed, not asserted

Simulation evidence is not a flag the caller sets. The session grants it only
after it has itself seen a successful `simulate_patch` for the scenario and a
`compare_runs` whose result the Twin marked `approval_eligible: true`. A
comparison that failed its constraints is recorded, but does not move the patch
forward. Approval evidence is granted only by a named approver acting on the
session, and even then `request_approval` reaches the Twin as a request; the
Twin's own answer comes back `network_change_permitted: false`, `status: draft`.

## The approval flow

The claim the pair exists to make, pinned in `approval-flow.test.ts`:

| Step | Decision |
| --- | --- |
| apply the patch before anything is proven | `deny` |
| request approval with nothing simulated | `require_approval` |
| run the counterfactual | `allow` — this is how evidence comes to exist |
| request approval, simulated but unapproved | `require_approval` |
| request approval with both kinds of evidence | `allow` |
| **apply the patch with both kinds of evidence** | **`deny`** |

The last row is the point. Complete evidence makes the approval request
eligible; it never makes the patch executable. All six steps land on the ledger
in order and the chain still verifies.

`approval-flow.test.ts` exercises the plane's half with stand-in flags.
`twin-integration.test.ts` runs the same sequence against a live Twin process
with evidence derived as described above, and ends with the ledger replaying
cleanly. Without a Twin checkout it skips and says so; in CI a skip is a
failure.

## What the ledger records

Each entry holds the decision and the inputs it was made from: tool, caller and
clearance, both evidence flags, and a hash of the arguments. The policy never
reads arguments, so the hash keeps provenance while keeping content that may
carry identifiers or secrets out of the record. Entries chain by hash; replay
refuses a ledger whose chain does not verify.

## Run it

```bash
npm test
```

Node 24 or newer runs the TypeScript sources directly. The engine has no runtime
dependencies.
