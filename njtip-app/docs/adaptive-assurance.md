# NJTIP v1.11 — Adaptive Assurance, Predictive Operations & Enterprise Governance Evolution

Phase 10 made the platform continuously *verified*: 100 executable invariants answering "is it
correct right now?" on every commit. Phase 11 answers the question that was left over — **"is it
getting worse?"** — and turns four previously advisory signals into controls that block.

The architecture stays frozen at [Baseline v1.7](./ARCHITECTURE-BASELINE-v1.7.md). No new bounded
context; every capability extends an existing module inside its own context, with the context map
and ownership updated in the same commit. Recorded as
[ADR-0006](./adr/0006-adaptive-assurance-and-predictive-operations.md).

> **Discipline preserved.** Zero runtime dependencies · synthetic data only · deterministic ·
> fail-closed · privacy by design · human accountability. 🔒 cryptography and keys stay human-built.
> **Evidence ≠ authorization** — ten green readiness dimensions still print `NOT AUTHORIZED`.

## What Phase 11 added

| Part | Capability | Module | The guarantee |
|---|---|---|---|
| 1 | Zero Trust optimization | `iam/zero-trust-architecture.js` · [doc](./zero-trust.md) | Signed, revocable decisions reusable only while **every** condition still holds |
| 2 | Enterprise risk intelligence | `security/threat-model.js` · [doc](./risk-intelligence.md) | Risk is time-bound: an acceptance expires and neither it nor a review renews itself |
| 3 | Formal verification expansion | `iam/formal-policy.js` · [doc](./formal-policy.md) | 16 properties across 13 kinds, ~11,958 states, with counterexamples |
| 4 | Predictive SRE | `observability/sre.js` · [doc](./reliability-engineering.md) | Two-window burn alerting; a recovered incident stops paging |
| 5 | Business observability | `observability/business.js` · [doc](./business-observability.md) | Identity-bearing events are **refused**, not stripped |
| 6 | Advanced chaos | `twin2/chaos.js` · [doc](./resilience-engineering.md) | 17 scenarios, each proving **detection AND recovery** |
| 7 | Data quality governance | `fabric/data-governance.js` · [doc](./data-governance.md) | Poor quality **reduces** governance readiness |
| 8 | Supply-chain trust | `supplychain/slsa.js` · [doc](./supply-chain-security.md) | Deployment fails for an untrusted artifact |
| 9 | Comprehensive AI governance | `ai/ai-lifecycle.js` · [doc](./ai-governance.md) | Below the confidence floor the output is **withheld**, not caveated |
| 10 | Consistency governance | `twin2/multi-region.js` · [doc](./multi-region.md) | A stale read is declared acceptable in advance or **refused** |
| 11 | ADR governance evolution | `architecture/adr-governance.js` · [doc](./architecture-governance.md) | A success criterion with no number in it fails validation |
| 12 | Consumer impact analysis | `contracts/consumer-contracts.js` · [doc](./consumer-contracts.md) | Adoption is **observed**, never assumed |
| 13 | Governance continuity | `governance/ownership.js` · [doc](./governance-ownership.md) | A role nobody can fill is an ownership **gap**, not a footnote |
| 14 | Evidence confidence | `assurance/evidence-confidence.js` · [doc](./evidence-confidence.md) | Confidence is computed; supplying one is an error |
| 15 | Multi-dimensional readiness | `assurance/evidence-confidence.js` · [doc](./evidence-confidence.md) | Ten independent dimensions; authorization is never derived |
| 16 | Engineering metrics | `assurance/evidence-confidence.js` · [doc](./evidence-confidence.md) | An unmeasured metric is `null`; maturity cannot inflate |

## Assurance

```bash
npm test                    # 435 deterministic tests
npm run twin                # combined gate: 14 twin + 92 app + 9 infra = 115 invariants
npm run chaos               # 5 performance tests + 17 chaos scenarios, all detect-and-recover
npm run assurance           # 16 assurance domains → deployment authorization package
npm run production-readiness # …plus the items only a human can close
```

Thirteen new fitness functions, each written so it **can** fail — fed a crafted counterexample that
must be rejected. That discipline caught five real defects during this phase, each recorded where it
happened rather than quietly fixed:

- A cache keyed on the principal alone let a cached investigator permit be replayed as a citizen.
  Condition 5 of the caching contract exists because of it ([ADR-0005](./adr/0005-authorization-decision-caching.md)).
- The lineage-completeness check found four governed datasets with **no declared consumer**. The
  gap was in the record, not the check, so the seed was corrected.
- A readiness scorer that inferred polarity from a value's shape read `credentialFindings: 0` as a
  score of zero — confidently wrong in the direction that looks safe. Signals are now declared.
- An artifact trust score accepted a genuine signature over a *different* artifact until the digest
  binding was added.
- An ADR validation probe wrote into the real `docs/adr/` directory, making the evidence package
  intermittently non-deterministic under parallel test runs. Validation is now in-memory.

## Three things worth carrying forward

- **"No evidence" must never render as "fine."** It appears five times in this phase: an unmeasured
  dataset, an under-sampled hallucination rate, an unreported consumer adoption, an unmeasured
  engineering metric, and a readiness dimension with nothing behind it. Each one is reported as
  absent rather than defaulted to something reassuring, because the default failure mode of every
  metrics system is a green number that means nobody is reporting.
- **A control nothing can fail is decoration.** Every gate added here is proved by feeding it the
  case it must reject — a silently-surviving chaos experiment, a hand-entered confidence, an
  unmeasurable success criterion, a substituted package.
- **Aggregate to the weakest link, not the mean.** Evidence confidence, readiness and quality are
  all reported at their worst component. Averaging is how a single broken thing disappears behind
  nine working ones.

## Version

**v1.11.0** — additive and backward compatible at every published surface. Three internal
verification APIs (`infer`, `verifyRelease`, chaos experiment shape) were **tightened**, with every
call site updated in the same commit; a security control callers can opt out of is a suggestion.
