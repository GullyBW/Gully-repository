# Non-Functional Requirements — Continuous Validation (Part 9)

Each NFR has a **continuous check** integrated into the Twin and/or the app CI where practical.

| NFR | How it's validated (automated) | Status |
|-----|-------------------------------|--------|
| **Scalability** | Twin perf harness (`njtip-twin` `npm run bench`); stateless services scale horizontally; quota-shedding chaos (`SIM-36`, `CHAOS-STORAGE-EXHAUSTION`) | ✅ checked |
| **Performance** | Perf harness records policy/routing/evidence hot-path latency; trend file | ✅ (informational) |
| **Reliability** | Idempotency + no-duplicate on retransmit (`CHAOS-PACKET-LOSS`); audit/custody integrity checks | ✅ |
| **Availability** | Degrade-to-minimal-intake; fail-closed on component loss (`CHAOS-*`, `SIM-29/35`) | ✅ |
| **Maintainability** | Zero deps; small modules; drift detection; ADR-governed change; contract tests | ✅ |
| **Recoverability** | DR from ciphertext-only backup; RTO/RPO drills (`SIM-12/30/35`, `CHAOS-*`) | ✅ (synthetic) |
| **Accessibility** | Semantic, keyboard-navigable, theme-aware UI; WCAG target (formal audit later) | ◐ prototype |
| **Usability** | Simple single-action journeys; honest guidance (`docs/ux`) | ◐ prototype |
| **Internationalization** | EN/Setswana placeholders in synthetic data; full i18n a v1.x item | ◐ planned |
| **Security** | Full Twin fitness + 35 adversarial + 9 chaos + 4 formal; fail CI on regression | ✅ |
| **Privacy** | No identity/PII in stores, logs, aggregates; identity rejected at write (`FIT-IDENTITY-MINIMIZATION`, privacy tests) | ✅ |

## Integration into the Twin
Security, privacy, reliability, availability, recoverability, scalability, and maintainability NFRs
are enforced as **fitness functions / simulations / chaos experiments** — a regression fails CI.
Accessibility, usability, and i18n are prototype-level and scheduled for formal validation (blueprint
phase3/04) with real target users; these require human judgment and are not auto-certified.
