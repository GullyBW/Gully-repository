# NJTIP — Controlled Pilot Deployment (Phase 10)

Artifacts and the staged process for a **controlled operational rollout**. Every gate below
is informed by automated evidence but **decided by an accountable human** — `npm run
readiness` never authorizes deployment, and the feature-flag + canary controls only *stage*
exposure, they do not grant approval.

> **Deployment approval is always a human governance decision** (recorded in the governance
> ledger, M-of-N oversight). These artifacts prepare a rollout; they do not perform one.

## Staged rollout (each stage gated by a recorded human decision)

| Stage | What runs | Evidence in | Human gate |
|---|---|---|---|
| 1. Internal engineering validation | `npm test` · `npm run twin` · `npm run perf` | 70 tests, 34 invariants, resilience checks | Engineering lead sign-off |
| 2. Synthetic operational exercise | seeded workflows + chaos (`scripts/perf.js`) | soak/chaos pass, integrity holds | Ops lead sign-off |
| 3. Controlled pilot environment | canary (`../k8s/canary.yaml`) + flags cohort `pilot-internal` | canary `/readyz`, SLO (`/api/admin/slo`) | Pilot owner sign-off |
| 4. User Acceptance Testing | UAT scripts against the pilot | UAT results | Business owner sign-off |
| 5. Independent security assessment | pen-test + evidence package (`npm run evidence`) | signed, reproducible package | Independent assessor sign-off |
| 6. Deployment readiness review | `npm run readiness` (+ human attestations) | readiness assessment | Oversight board (M-of-N) recorded decision |
| 7. Controlled production rollout | canary % ↑ via flags; promote on healthy SLO | error-budget burn, alerts | Continue/rollback = human |
| 8. Post-deployment monitoring | `/metrics` · `/api/admin/slo` · `/api/admin/traces` · `npm run health` | SLO + engineering-health trend | Continuous improvement loop |

## Controlled-exposure mechanics (staging only, not approval)

- **Feature flags** (`src/adapters/flags.js`): deterministic, sticky, identity-free rollout
  by opaque subject/cohort. Kill-switch disables a feature instantly. Default: enterprise
  features gated to the `pilot-internal` cohort at 0% general rollout.
- **Canary** (`../k8s/canary.yaml`): a small replica set on the same Service; promote by
  scaling, demote/rollback by scaling to zero. Readiness/liveness gate traffic; the
  container still refuses to start unless the assurance gate passes.

## Rollback

1. Set the feature flag `enabled: false` (kill-switch) — instant, no redeploy.
2. Scale `njtip-app-canary` to `0` (or shift the mesh split back to stable).
3. If a bad release reached stable: `kubectl rollout undo deploy/njtip-app`.
4. Data is safe by construction: transactions roll back partial writes; evidence is
   versioned + legal-hold aware; audit/custody chains are append-only and verifiable.

## Files
- [`../k8s/canary.yaml`](../k8s/canary.yaml) — canary deployment.
- [`rollout.json`](./rollout.json) — pilot cohort + canary weight configuration (reviewed).
