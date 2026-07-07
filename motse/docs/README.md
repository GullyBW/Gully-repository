# Motse — Documentation Hub

**Motse** is a Botswana civic, cultural, and financial **Digital Public
Infrastructure** platform — a modular monolith in Node.js (CommonJS) built on three
platform primitives every module consumes: a **verified identity graph**, a
**double-entry ledger** (unified money movement), and a **governance/audit engine**.

It has since grown a full **enterprise operational platform** on top of the product:
transactions and distributed coordination, observability, runtime governance,
disaster-recovery validation, business/operational intelligence, and a
self-validating, continuously-learning analytics layer. This hub maps every
document by the layer it belongs to.

> New here? Read **[ARCHITECTURE](ARCHITECTURE.md)** first, then skim the layer
> summaries below. Running it? Jump to **[Getting started](#getting-started)**.

---

## The platform in one picture

```
 Business applications  (Flutter app · USSD/SMS · Admin portal · Webhooks · SDK)
        │
        ▼
 ┌─ Foundation ──────────────────────────────────────────────────────────────┐
 │  Unit-of-Work transactions · Transactional Outbox · Event Store + CQRS      │
 │  Distributed KV: idempotency · locks · rate limiting (in-memory → Redis)    │
 └────────────────────────────────────────────────────────────────────────────┘
        ▼
 ┌─ Observability ───────────────────────────────────────────────────────────┐
 │  Tracing (OTel) · Metrics (Prometheus) · Structured logs · Health/Readiness │
 │  Dependency health · Resilience (breakers/bulkheads/shedding) · Runtime int.│
 └────────────────────────────────────────────────────────────────────────────┘
        ▼
 ┌─ Operations ──────────────────────────────────────────────────────────────┐
 │  Runtime configuration + governance · Rollback/Snapshots · Capacity planning│
 │  Disaster-recovery validation (RTO/RPO) · Four governed DPI planes          │
 └────────────────────────────────────────────────────────────────────────────┘
        ▼
 ┌─ Business & Operational Intelligence ─────────────────────────────────────┐
 │  Business observability (value/customers/SLA) · Operational recommendations │
 │  Governance analytics · Forecast-accuracy validation (backtesting)          │
 └────────────────────────────────────────────────────────────────────────────┘
        ▼
 ┌─ Enterprise Intelligence (self-validating) ───────────────────────────────┐
 │  Business outcome validation (telemetry vs ledger) · Recommendation         │
 │  effectiveness · Executive briefing · Continuous learning · Evidence gate    │
 └────────────────────────────────────────────────────────────────────────────┘
```

Every layer is additive over the one below it, backward-compatible, independently
tested to a **≥95% statements / 95% lines / 90% branches** gate, and validated by a
chaos/production harness.

---

## Documentation by layer

### Overview & architecture
| Doc | What it covers |
| --- | --- |
| [PROJECT-PROPOSAL](PROJECT-PROPOSAL.md) | Non-technical overview — what Motse is, the opportunity, vision, beneficiaries, roadmap, risks, and success metrics (start here for the big picture) |
| [ARCHITECTURE](ARCHITECTURE.md) | System topology, the modular monolith, the three primitives, the event bus |
| [API](API.md) | The `/v1` REST surface, gateway (auth · idempotency · rate limiting), error model |
| [ROADMAP-EPICS](ROADMAP-EPICS.md) | Phased roadmap and workstream epics |
| [TESTING](TESTING.md) | Test strategy, suites, and the coverage-gate discipline |

### Foundation — correctness under load
| Doc | What it covers |
| --- | --- |
| [FOUNDATION](FOUNDATION.md) | Unit-of-Work transactions, the Transactional Outbox, the distributed (Redis-ready) runtime — idempotency, locks, rate limiting |
| [EVENTS-CQRS](EVENTS-CQRS.md) | Immutable Event Store (replay, snapshots, upcasters, time-travel) and CQRS read-model projections |

### Observability & resilience
| Doc | What it covers |
| --- | --- |
| [OBSERVABILITY](OBSERVABILITY.md) | Distributed tracing, Prometheus metrics, structured logs, health/readiness |
| [OBSERVABILITY-STACK](OBSERVABILITY-STACK.md) | OTLP export, log↔trace correlation, Grafana dashboards, Prometheus alerts |
| [RESILIENCE-RUNTIME](RESILIENCE-RUNTIME.md) | Circuit breakers, bulkheads, adaptive retries, load shedding, self-healing; runtime (heap/GC/event-loop) intelligence |
| [ENTERPRISE-MISSIONS](ENTERPRISE-MISSIONS.md) | Dependency-health state machine, identity-aware adaptive rate limiting, the enterprise event platform |

### Operations, configuration & governance
| Doc | What it covers |
| --- | --- |
| [CONFIG-CAPACITY](CONFIG-CAPACITY.md) | Typed, validated, live-applied runtime configuration; predictive capacity planning |
| [GOVERNANCE-DR](GOVERNANCE-DR.md) | Configuration governance (risk tiers, approval workflow, forensic records) and disaster-recovery validation (RTO/RPO) |
| [GOVERNED-PLANES](GOVERNED-PLANES.md) | Four governed DPI planes: Identity, Policy Kernel, AI Retrieval Gateway, Data Product Plane — provenance, audit graph, cells, certification |
| [OPERATIONS](OPERATIONS.md) | Incidents, maintenance mode, backup/restore verification, config viewer, capacity/health reports |
| [SECURITY](SECURITY.md) | Security assurance: risk scoring, ATO / impossible-travel / SIM-swap / abuse detection, secret rotation |

### Business & operational intelligence
| Doc | What it covers |
| --- | --- |
| [BUSINESS-INTELLIGENCE](BUSINESS-INTELLIGENCE.md) | Business observability (value processed, customers reached, SLA per capability) and evidence-based operational recommendations |
| [GOVERNANCE-FORECAST-ANALYTICS](GOVERNANCE-FORECAST-ANALYTICS.md) | Governance analytics (compliance/maturity, rollback rate) and forecast-accuracy validation via backtesting |

### Enterprise intelligence — the platform validates & improves itself
| Doc | What it covers |
| --- | --- |
| [BUSINESS-VALIDATION-RECOMMENDATION-EFFECTIVENESS](BUSINESS-VALIDATION-RECOMMENDATION-EFFECTIVENESS.md) | **P1** reconcile business telemetry against the authoritative ledger; **P2** track recommendations as measurable products (precision/recall/ROI) and recalibrate confidence from outcomes |
| [EXECUTIVE-OPERATIONAL-INTELLIGENCE](EXECUTIVE-OPERATIONAL-INTELLIGENCE.md) | **P3** one executive briefing answering what/why/who/value/recommended/confidence/what-if, with a single sourced operational-confidence score |
| [CONTINUOUS-LEARNING](CONTINUOUS-LEARNING.md) | **P4** a persisted knowledge base that learns trends, a calibrated forecast-confidence multiplier, and an evidence-gated maturity score |
| [EVIDENCE-INTEGRITY](EVIDENCE-INTEGRITY.md) | **P5** the CI gate that fails the build when evidence quality regresses (dead metric refs, unsupported recommendations/confidence, ungoverned config) |
| [PRODUCTION-VALIDATION](PRODUCTION-VALIDATION.md) | The chaos/production-validation harness that proves the telemetry tells the truth under fault injection |

### Payments & money
| Doc | What it covers |
| --- | --- |
| [PAYMENTS](PAYMENTS.md) | Mobile-money rails (Orange Money · MyZaka · Smega) behind a pluggable provider architecture |
| [PAYPAL](PAYPAL.md) | The PayPal diaspora card/remittance rail |
| [CARD-PAYMENTS](CARD-PAYMENTS.md) | Native card payments: gateway abstraction + failover, tokenization, 3DS, multi-currency, dispute/settlement/reconciliation |

### Product, domain & delivery
| Doc | What it covers |
| --- | --- |
| [ANALYTICS](ANALYTICS.md) | PII-free, event-driven analytics platform |
| [AI](AI.md) | AI provider interfaces (local defaults, cloud by env) and the AI evaluation framework |
| [WORKFLOW](WORKFLOW.md) | The configurable workflow engine |
| [PLUGINS](PLUGINS.md) | The signed plugin architecture |
| [QR-PLATFORM](QR-PLATFORM.md) | Signed, time-limited, revocable cross-domain QR platform |
| [PILOTS](PILOTS.md) | Pilot management and feature flags / remote config |
| [ADMIN-PORTAL](ADMIN-PORTAL.md) | The administration API and web portal |
| [MOBILE](MOBILE.md) | The offline-first mobile/PWA client |
| [DEPLOYMENT](DEPLOYMENT.md) · [INFRASTRUCTURE](INFRASTRUCTURE.md) · [NATIONAL-ROLLOUT](NATIONAL-ROLLOUT.md) | Deployment, infrastructure-as-code, national rollout assets |

---

## Getting started

```bash
# From the repo root
npm ci                        # install

npm run motse:start           # run: :4100 — /v1 API, /admin, /app PWA, /developers, /metrics
npm run motse:test            # full Motse suite (57 suites / 800 tests)

# Enterprise validation
npm run motse:validate:smoke  # chaos/production-validation harness (119 checks)
npm run motse:evidence        # evidence-integrity gate (every metric sourced, every rec evidenced)

# Coverage gates (each ≥95% statements / 95% lines / 90% branches)
npm run motse:coverage:foundation      # transactions, outbox, distributed runtime
npm run motse:coverage:observability   # tracing, metrics, health
npm run motse:coverage:resilience      # breakers, bulkheads, runtime intelligence
npm run motse:coverage:config          # runtime config + capacity
npm run motse:coverage:govdr           # config governance + DR
npm run motse:coverage:business        # business observability + operational intelligence
npm run motse:coverage:analytics       # governance analytics + forecast accuracy
npm run motse:coverage:reconciliation  # business validation + recommendation effectiveness
npm run motse:coverage:executive       # executive intelligence
npm run motse:coverage:learning        # continuous learning
npm run motse:coverage:evidence        # evidence integrity

# Operational tooling
npm run motse:slo         # regenerate SLO dashboards + Prometheus alert rules
npm run motse:bench       # in-process performance benchmark
npm run motse:load        # HTTP load test (needs a running server)
npm run motse:resilience  # load & resilience simulation
```

All quality gates run in CI via `.github/workflows/foundation.yml`.

## Codebase map

```
motse/
├── src/
│   ├── kernel/          errors · event bus · idempotency · store (repository/UoW)
│   ├── platform/        identity · ledger · escrow · governance · media  (primitives)
│   ├── modules/         heritage · kgetsi · kgotla · lelapa · letlole · loeto · mafelo · mmino · puo
│   ├── payments/        mobile-money · PayPal · native cards + gateways
│   ├── persistence/     transactional outbox
│   ├── distributed/     KV adapters (in-memory/Redis) · idempotency/locks/rate-limit · chaos KV
│   ├── events/          event store · CQRS projections
│   ├── observability/   tracing · metrics-adjacent · health · dependency health · resilience-adjacent
│   │                    runtime/capacity · business observability · operational/governance analytics
│   │                    forecast accuracy · reconciliation · recommendation effectiveness
│   │                    executive intelligence · continuous learning · evidence integrity
│   ├── resilience/      breakers · bulkheads · retries/budget · load shedding · self-healing
│   ├── config/          runtime config service + configuration governance
│   ├── ops/             ops service · backup service · DR validator
│   ├── governance/      four governed DPI planes + provenance/audit-graph/cells/certification
│   ├── monitoring/      metrics registry · structured logger · monitoring service
│   ├── admin/           administration API
│   ├── ai/ analytics/ search/ notifications/ workflow/ plugins/ developer/ qr/ i18n/ pilot/ security/
│   ├── app.js           Express app assembly
│   ├── container.js     composition root (createPlatform)
│   └── server.js        HTTP entry point
├── scripts/             production-validation · evidence-integrity · benchmark · load · scans
├── tests/               57 suites (unit + integration + chaos)
└── docs/                you are here
```

## Conventions & guarantees

- **Additive & reversible.** Every layer is additive over the layer below; new
  modules are read-only over the systems they observe. No enhancement weakens
  transaction guarantees, idempotency, governance, observability, or backward
  compatibility.
- **Evidence-driven.** Every metric has a source, every recommendation carries
  evidence + confidence + remediation, every confidence score is in range and (for
  composites) exposes its sourced components. The [EVIDENCE-INTEGRITY](EVIDENCE-INTEGRITY.md)
  gate fails CI if any of this regresses.
- **Money is exact.** All amounts are integer minor units (thebe); the ledger is
  double-entry and idempotent; the reconciler treats it as the authoritative record.
- **Tested to a gate.** New code lands with ≥95/95/90 coverage and harness checks;
  all existing suites stay green (Motse **800** + Tirelo root **131**).
