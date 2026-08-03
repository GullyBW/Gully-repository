# NJTIP v1.12 — Predictive Governance, Digital Twin Operations & Enterprise Intelligence

Phase 11 answered *"is it getting worse?"* Phase 12 answers the question after that — **"what will
this change do, and to whom?"** — and adds the two things a governance platform needs to answer it:
a model of itself it can rehearse changes against, and a chain that reaches from a technical event
all the way to a person.

The architecture stays frozen at [Baseline v1.7](./ARCHITECTURE-BASELINE-v1.7.md). No new bounded
context; every capability extends an existing module inside its own context, with context map,
ownership and ADR catalogue updated in the same commit. The consistency and ADR-schema decisions are
recorded as [ADR-0007](./adr/0007-session-consistency-and-adr-review-lifecycle.md).

> **Discipline preserved.** Zero runtime dependencies · synthetic data only · deterministic ·
> fail-closed · privacy by design · human accountability. 🔒 cryptography and keys stay human-built.
> **Evidence ≠ authorization** — every report in this phase carries `authorizes: false`, and ten
> green readiness dimensions with a clean dependency graph still print `NOT AUTHORIZED`.

## What Phase 12 added

| Part | Capability | Module | The guarantee |
|---|---|---|---|
| 1 | Context-aware Zero Trust | `iam/zero-trust-architecture.js` · [doc](./zero-trust.md) | The context digest covers the **resource's** tenant, not just the subject's |
| 2 | Quantitative risk | `security/threat-model.js` · [doc](./risk-intelligence.md) | Likelihood × Impact − control effectiveness, with compensating credit capped |
| 3 | Formal verification catalogue | `iam/formal-policy.js` · [doc](./formal-policy.md) | 16 machine-readable properties, each with an owning ADR and a named owner |
| 4 | Predictive SRE | `observability/sre.js` · [doc](./reliability-engineering.md) | An unmeasurable prediction reports `unknown`, never healthy |
| 5 | Mission correlation | `observability/business.js` · [doc](./business-observability.md) | Infrastructure → application → business → mission, every link with a mechanism |
| 6 | Four-stage resilience | `twin2/chaos.js` · [doc](./resilience-engineering.md) | Detection **and** containment **and** recovery **and** verification, each observed separately |
| 7 | Executive quality intelligence | `fabric/data-governance.js` · [doc](./data-governance.md) | An unmeasured dataset is reported unmeasured, not sound |
| 8 | Supply-chain trust | `supplychain/slsa.js` · [doc](./supply-chain-security.md) | Zero scans is not zero findings; an unidentified builder blocks |
| 9 | AI fairness & calibration | `ai/ai-lifecycle.js` · [doc](./ai-governance.md) | Four incompatible fairness criteria; the platform refuses to pick |
| 10 | Session consistency | `twin2/multi-region.js` · [doc](./multi-region.md) | An unverifiable session guarantee is refused, not assumed |
| 11 | ADR review lifecycle | `architecture/adr-governance.js` · [doc](./architecture-governance.md) | "Reviewed periodically" is not a schedule; incomplete ADRs are rejected |
| 12 | Release impact | `contracts/consumer-contracts.js` · [doc](./consumer-contracts.md) | Two changes landing on one consumer is one unacceptable release |
| 13 | Active ownership | `governance/ownership.js` · [doc](./governance-ownership.md) | Available, active and trained are three separate facts |
| 14 | Evidence provenance | `assurance/evidence-confidence.js` · [doc](./evidence-confidence.md) | A high band with a falling trend is a control on its way out |
| 15 | Readiness dependencies | `assurance/evidence-confidence.js` · [doc](./evidence-confidence.md) | The graph explains; it never aggregates, and cannot reach authorization |
| 16 | Engineering intelligence | `assurance/evidence-confidence.js` · [doc](./evidence-confidence.md) | Polarity is declared; a gap in a series is a gap, not a flat line |
| 17 | **Digital Twin of Operations** | `twin2/operations-twin.js` · [doc](./operations-twin.md) | Built from the architecture-of-record; isolation verified by digest after every run |
| 18 | **Predictive mission impact** | `observability/business.js` · [doc](./business-observability.md) | Citizen impact in the citizen's words; an unmapped path is unknown, not safe |
| 19 | **Automated compliance intelligence** | `legislation/compliance-intelligence.js` · [doc](./compliance-intelligence.md) | An unassessed change is a gap; a failing control is not a control |
| 20 | **Enterprise knowledge graph** | `graph/enterprise-graph.js` · [doc](./enterprise-graph.md) | Traceability is a per-entity question with named answers |

## Assurance

```bash
npm test                    # 600 deterministic tests
npm run twin                # combined gate: 14 twin + 105 app + 9 infra = 128 invariants
npm run chaos               # 17 chaos scenarios, each proving all four resilience stages
npm run assurance           # 16 assurance domains → deployment authorization package
npm run production-readiness # …plus the items only a human can close
```

Ten new fitness functions, each written so it **can** fail — fed a crafted counterexample that must
be rejected. That discipline caught real defects again, recorded where they happened rather than
quietly fixed:

- **Cross-tenant cache replay.** The tenant *check* worked, but the context digest keyed only the
  *subject's* tenant, so a cached permit for one agency's resource was replayable against another's.
  `resourceTenant` and `resourceJurisdiction` are in the digest because of it.
- **A republished policy registry took authorization down.** `registry()` returned a display summary
  that dropped `conditions`, so `publish(pap.registry())` turned a targeted deny into a blanket one.
  `registry()` is now a lossless round-trip and `summary()` is the short form.
- **Tautological resilience stages.** The first version derived `contained` from `detected` and
  `verified` from `recovered` — every experiment scored 1.0 automatically. Rewritten to require all
  four from *different* observations, and all 17 experiments re-stated.
- **The mission chain reached nothing for `anonymous-reporting`** — the constitutional service. The
  platform measures nothing directly about whether people can report. `case-throughput` is now
  linked, with the weakness recorded in the link's own text: it is a **proxy**.
- **An evidence node property named `kind` shadowed the node's own kind**, silently reclassifying
  every evidence node and taking graph traceability to zero. Caught by the traceability check
  reporting a number that could not be right.

## Three things worth carrying forward

- **A model maintained beside the thing it models is worse than none.** Both new artefacts — the
  operations twin and the enterprise graph — are *built* from the registries on every construction,
  with drift checked in both directions. A hand-kept twin answers confidently and wrongly, and the
  answer looks the same either way.
- **Unknown is not safe.** The mission forecast, the compliance gap analysis, the engineering
  forecast, the traceability report and the continuity dashboard all distinguish "we checked and it
  is fine" from "we have no record". Reassurance by omission is the failure mode of every report
  that only lists what it found.
- **Explaining is not aggregating.** The readiness dependency graph was the temptation of this phase:
  it would have been easy to roll an unready prerequisite into its dependent's score. That single
  number is the thing ten independent dimensions exist to avoid, so the graph reports the foundation
  and a human reads both.

## Version

**v1.12.0** — additive and backward compatible at every published surface. Three internal
verification behaviours were **tightened** rather than relaxed, with every call site updated in the
same commit: the chaos contract now requires four stages instead of two, reads against
session-scoped contexts now require a session token, and ADRs from 0007 must carry a review schedule
and sunset criteria. A gate callers can opt out of is a suggestion.
