# Institutional Resilience & Knowledge Continuity (Phase 13, Parts 8, 11, 13)

Gated by `APP-FIT-KNOWLEDGE-CONTINUITY` and `APP-FIT-INSTITUTIONAL-RESILIENCE`.
Live: `GET /api/governance/knowledge-continuity` · `GET /api/governance/training` ·
`GET /api/governance/institutional-resilience`.

## The new global invariant

> **No critical capability may depend on a single person, a single process, a single document, or a
> single system.**

Evaluated continuously across eight dimensions — person, team, document, process, service, region,
supplier, communication channel — for five named critical capabilities. A violation **blocks
institutional readiness** until mitigated or explicitly accepted by the appropriate human authority.

## The trap this is built around

This platform **derives** a deputy for every role and a replica for every region. Counting names
finds two of everything and reports perfect resilience — which would make the whole invariant
decoration. So an alternative counts only if it is **validated**:

> A derived deputy who has never acted and holds no current training is a name, not an alternative.

Deputy readiness is therefore assessed on exactly the same evidence as the primary's:

| Factor | Ready means |
|---|---|
| availability | Not recorded absent |
| activity | Has performed a governance act within the current review cycle |
| training | All required courses current, attested by somebody else |
| **rehearsal** | Has taken part in the exercises relevant to the role, within validity |

Aggregated to the weakest. **Unknown is not ready** and is reported separately from *failed*, because
the remedies differ: one is "get evidence", the other is "fix the gap".

## Part 11 — Training assurance

`ExerciseRegister` records participation in `disaster-recovery`, `incident-escalation`,
`evidence-custody` and `emergency-authorization` rehearsals, each stating why it matters. Training
says you were taught; participation says you have done it under conditions resembling the real thing.

Never-participated and lapsed are separate states. Participation must be attested by somebody else —
self-reported attendance attests nothing — and expires after a year.

**Expired qualifications reduce the readiness contribution on their own**, with nobody deciding to
lower it. Unknown counts as not certified: a register nobody supplied certifies nobody.

## Part 13 — What the invariant found

Run against the real platform with a fully evidenced estate, person, document, team, process,
supplier, channel and region all clear. **Three constitutional capabilities depend on a single
service**, and this is a true fact about the architecture rather than a modelling artefact:

| Capability | Fatal single service |
|---|---|
| `anonymous-reporting` | `persistence-ind` |
| `case-investigation` | `persistence-exec` |
| `governance-decision-recording` | `persistence-jud` |

Each zone has exactly one persistence store. The check removes each service in turn rather than
counting them — *three services in a chain is a chain, not redundancy* — so the dependency is
demonstrated, not assumed.

This is recorded as a **ratchet** in the fitness function: those three are the known baseline, and
any *new* single dependency, or any capability acquiring one, fails the build rather than joining a
growing list. Equally, if one is closed, the stale exception must be removed rather than left behind.

## Accepting a single point of failure

An accepted single dependency is still a single dependency — it is one somebody has taken
responsibility for. Acceptance requires a named authority, a rationale and an **expiry**; a permanent
acceptance is a decision nobody revisits. For a **constitutional** capability, only the Oversight
Board may accept.

An expired acceptance stops covering the dependency by itself, and readiness blocks again without
anyone deciding to withdraw it.

## As composed

The activity, training, rehearsal and acceptance registers all start **empty**. The invariant
therefore does not hold, and institutional readiness is blocked with eight unaccepted dependencies.
That is the true state of a platform that has never rehearsed anything and whose deputies have never
acted — and seeding those registers to make it green would report an institutional history that
never happened.
