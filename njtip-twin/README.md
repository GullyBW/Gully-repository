# NJTIP — Digital Engineering Twin & Continuous Verification Framework

An **executable** implementation of the Digital Engineering Twin designed in the NJTIP blueprint
([`docs/transparency-platform/phase8/`](../docs/transparency-platform/phase8/00-phase8-index.md)).
It converts the approved architecture into **continuously verifiable behaviour** and produces
**machine-verifiable, review-ready evidence** — while deliberately preserving human responsibility
for the decisions automation must never make.

> **SYNTHETIC DATA ONLY.** No production systems, no production data, no real individuals or
> institutions. **Zero runtime dependencies** (Node.js built-ins only). **Deterministic** (seeded;
> no `Math.random`, no wall-clock in hashed content) → reproducible, bit-for-bit comparable evidence.
>
> **A green twin is EVIDENCE, not a go-live decision.** It shows the design and controls are
> internally consistent and hold under synthetic simulation. It does **not** certify real-world
> anonymity vs a global adversary, legal admissibility, or that governance/legal/funding conditions
> are met. Production go-live remains an Oversight Board decision behind the readiness gates.

## Quick start

```bash
cd njtip-twin
npm test        # unit + fitness + adversarial tests (node --test) — no install needed
npm run verify  # run architecture fitness functions against a synthetic twin
npm run simulate# run the adversarial simulation suite
npm run ci       # full continuous-verification gate + generate evidence bundle
```

Requires Node.js ≥ 18 (developed on Node 22). `npm install` is a no-op — there are no dependencies.

## What it implements (mapped to the deliverables)

| Deliverable | Where |
|-------------|-------|
| **1. Reference implementation** (modular, testable, observable engineering infra) | `src/` — zones, stores, IAM, policy engine, event bus, governance, synthetic crypto, orchestrator |
| **2. Executable architecture verification** (violations = failing tests) | `verification/fitness/*.js` + `verification/fitness.test.js` |
| **3. Adversarial simulation framework** (metrics + reports) | `adversarial/scenarios.js` (SIM-01…12) + `adversarial/scenarios.test.js` |
| **4. Evidence generation pipeline** (machine-verifiable, packaged) | `src/evidence/evidence.js` → `evidence-out/evidence.json` + `REVIEW-REPORT.md` |
| **5. Continuous verification** (CI gate, blocks on violation) | `scripts/ci.js` + `.github/workflows/njtip-twin.yml` |
| **6. Independent expert review support** | `humanReviewRequired` in the evidence bundle + review report |

## The nine architecture invariants (fitness functions)

Each converts an approved architectural decision into a check. **A failing check is an architecture
violation and fails the build.** Compliant twin passes all nine; the tests also feed deliberately
**broken** twins to prove each check *catches* violations.

| Fitness function | Invariant | Refs |
|------------------|-----------|------|
| `FIT-ZONE-ISOLATION` | No cross-zone DB paths; cross-zone only via audited events | DDR-01/04, I-6 |
| `FIT-IDENTITY-MINIMIZATION` | No reporter-identifying field is ever stored (rejected at write) | DDR-05, D-02, ID-1 |
| `FIT-LEAST-PRIVILEGE` | Zero standing privilege; separation of duties; default deny | DDR-09, E-1/E-3 |
| `FIT-POLICY-ENFORCEMENT` | Policy engine default-deny | DDR-09 |
| `FIT-ZERO-TRUST` | No implicit trust; fail-closed on control outage | DDR-09, S-3 |
| `FIT-SECURE-DATA-FLOWS` | Cross-zone events PII-free and directional | DDR-07, I-6/DD-1 |
| `FIT-ENCRYPTION` | Content is ciphertext at rest; keys not co-located | DDR-10, I-4 |
| `FIT-AUDITABILITY` | Append-only, hash-chained, anchored, tamper-evident audit | DDR-13, T-2 |
| `FIT-GOVERNANCE` | Threshold (M-of-N) custody; signed CoI-aware routing | DDR-10, E-1/I-1/T-4 |

## Adversarial scenarios (SIM-01…12)

Compromised operator · insider cross-zone · metadata correlation · DoS/flood · privilege escalation
· identity spoofing · policy bypass · misconfigured infra (proves detection) · data exfiltration ·
governance failure/coercion · component failure (fail-closed) · disaster recovery. Each documents
expected behaviour, success criteria, and resilience metrics.

## Honest limits (by design)

- The **synthetic crypto** (`src/platform/crypto.js`) demonstrates control *flow* only. The real
  cryptography, key custody, anonymity, evidence-integrity, and AI subsystems are
  **🔒 human-expert-built and ISRB-signed** — never autonomously generated (blueprint `phase6/10`,
  `phase7/04`). The twin validates their *interfaces and invariants*, not a production crypto core.
- The twin proves internal consistency under simulation. Real-world anonymity vs a global passive
  adversary, device compromise, admissibility, and the governance/legal/funding conditions are
  **human-gate** questions the twin cannot answer.

## Human accountability (never automated)

The evidence bundle always lists the domains reserved for accountable humans — cryptography,
anonymity, evidence integrity, legal compliance, constitutional interpretation, judicial procedure,
AI decision boundaries, governance policy, procurement, and production go-live. **Automation
supports these decisions with evidence; it never makes them.**
