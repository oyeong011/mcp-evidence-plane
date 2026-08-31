# Threat model

## Assets

The decision record. Everything else in this repository exists to make the
record of what was decided, and on what evidence, hard to forge after the fact.

## Trust boundaries

| Input | Trust | Handling |
| --- | --- | --- |
| Tool name | untrusted | matched against a closed catalog; unknown names denied |
| Caller identity | untrusted | absent identity denied; clearance never inferred |
| Tool arguments | untrusted | never interpolated into a decision |
| Alarm and log prose | hostile | classified sensitive and redacted before return |
| Evidence flags | untrusted | absence blocks, never approves |

## Attacks considered

**Prompt injection through returned content.** Alarm text is written by whoever
can raise an alarm. It is redacted rather than returned, so a model cannot read
instructions smuggled into operational prose.

**Silent escalation through an unlisted tool.** A tool the catalog does not
describe cannot be classified, so it is denied. Adding a tool is a source change
that is reviewed, not a runtime registration.

**Forging an approval after the fact.** Each ledger entry commits to the previous
head, so editing any recorded decision invalidates every hash after it.

**Claiming execution authority.** The catalog carries a mutating tool precisely
so a test can prove it is refused with complete evidence present. An empty
catalog would make the ban unfalsifiable.

## Out of scope, and named as such

Transport authentication, database durability, key custody, and deployment
isolation are not implemented here. Until they are, this engine is a decision
core and not a production gateway, and nothing in this repository should be read
as claiming otherwise.
