# Bounded-Context Map (Stabilization Part 1)

The architecture-of-record, as **data** (`src/architecture/context-map.js`) rather than prose, so it
can be **verified** instead of asserted. `APP-FIT-CONTEXT-MAP` fails the build if the map drifts from
the code: every module under `src/` must be owned by exactly one context, every dependency target
must exist, the graph must be acyclic, every interaction must name a DDD relationship pattern and a
mechanism, and no two contexts may claim the same responsibility without an accepted-overlap record.

Live view: `GET /api/architecture/context-map` · per-context: `GET /api/architecture/contexts/{id}`.

## Contexts, coupling and accountability

`Ca` = afferent coupling (contexts depending on it) · `Ce` = efferent (contexts it depends on) ·
`I` = instability `Ce/(Ce+Ca)` (0 = maximally stable) · `Coh` = fraction of responsibilities unique
to the context.

| Context | Kind | Purpose | Ca | Ce | I | Coh | Responsible authority | Board |
|---|---|---|---|---|---|---|---|---|
| `identity-access` | supporting | Authenticate principals and authorize actions; zero standing privilege, default deny. | 8 | 0 | 0 | 1 | National Identity Authority | ISRB |
| `policy-governance` | supporting | Author, version, validate and certify access policy as data (never as code). | 1 | 1 | 0.5 | 1 | Office of the CISO | ISRB |
| `persistence` | generic | Zone-isolated repositories, unit of work, caching and object storage behind stable ports. | 2 | 1 | 0.333 | 1 | Government Data Centre Authority | ARB |
| `crypto-agility` | supporting | Govern which cryptographic algorithms are used and how they migrate — never key material. | 4 | 0 | 0 | 1 | National Cryptographic Authority | ISRB |
| `platform-events` | supporting | Immutable hash-chained event log, event contracts, PII-free pub/sub fabric. | 6 | 1 | 0.143 | 1 | Office of the CTO | ARB |
| `privacy` | **core** | Identity minimization, k-anonymity, differential privacy, the anonymity boundary. | 9 | 0 | 0 | 1 | Data Protection Commissioner | OB |
| `intake` | **core** | Accept anonymous reports (no identity accepted), route them, notify by case code only. | 1 | 3 | 0.75 | 1 | Independent Complaints Directorate | OB |
| `custody` | **core** | Preserve evidence integrity through a signed, hash-chained chain of custody. | 1 | 2 | 0.667 | 1 | Directorate of Forensic Services | OB |
| `investigation` | **core** | Guarded case/evidence lifecycles, investigator review, prioritisation, SLA. | 1 | 4 | 0.8 | 1 | DCEC | OB |
| `orchestration` | supporting | Workflow definition, simulation, formal verification, process mining, release flags. | 2 | 1 | 0.333 | 1 | Office of the CTO | ARB |
| `data-fabric` | supporting | Canonical schemas, metadata catalogue, lineage, provenance, semantic interoperability. | 4 | 2 | 0.333 | 1 | National Data Office | DGB |
| `data-exchange` | supporting | Governed inter-agency data exchange: purpose-limited, classified, approval-gated, audited. | 0 | 3 | 1 | 1 | National Data Office | DGB |
| `analytics` | supporting | Aggregate, non-attributable analytics, identity-free search, relationship graphs. | 1 | 3 | 0.75 | 1 | Office of Statistics and Analysis | DGB |
| `ai-advisory` | supporting | Explainable, advisory-only recommendations with a mandatory human-approval queue. | 0 | 2 | 1 | 1 | Office of Statistics and Analysis | OB |
| `security` | supporting | Threat intelligence that may only **lower** trust, never grant it. | 0 | 1 | 1 | 1 | National CIRT | ISRB |
| `tenancy-federation` | supporting | Multi-agency tenancy, isolation by default, governed ecosystem federation. | 0 | 2 | 1 | 1 | Ministry of Public Administration | ARB |
| `infrastructure` | supporting | Sovereign infrastructure governance: residency, compliance, drift, platform assurance. | 3 | 2 | 0.4 | 1 | Government Data Centre Authority | ORB |
| `supply-chain` | supporting | Supplier and component integrity; no deployment bypasses the gate. | 0 | 1 | 1 | 1 | Public Procurement Authority | ISRB |
| `observability` | generic | Identity-free logs, metrics, traces, SLOs, audience-specific dashboards. | 4 | 1 | 0.2 | 1 | Office of the CTO | ORB |
| `resilience` | supporting | Deterministic simulation, resilience validation, recovery strategy, crisis coordination. | 0 | 3 | 1 | 1 | National Disaster Management Office | ORB |
| `assurance` | **core** | The Digital Engineering Twin: fitness gate, compliance, maturity, capability, evolution, architecture-of-record. | 4 | 5 | 0.556 | 1 | Office of the Chief Architect | ARB |
| `legislation` | supporting | Legal instruments as versioned, simulatable artifacts mapped to controls and systems. | 0 | 2 | 1 | 1 | Attorney General Chambers | OB |
| `api-governance` | supporting | API/event contracts, versioning strategy, quality metrics, outbound integration. | 1 | 2 | 0.667 | 1 | Office of the CTO | ARB |
| `developer-platform` | generic | SDK generation, mocks, test harnesses, governed capability marketplace. | 0 | 1 | 1 | 1 | Office of the CTO | ARB |
| `knowledge` | supporting | Immutable, hash-chained institutional memory of decisions and rationale. | 0 | 1 | 1 | 1 | National Archives | OB |
| `portfolio` | supporting | Services as products: lifecycle, maturity, sustainability, usability validation. | 0 | 2 | 1 | 1 | Ministry of Public Administration | SDB |
| `governance-oversight` | **core** | Human governance: decisions, institutional ownership, asset/adaptive governance, oversight centres. | 0 | 4 | 1 | 1 | Oversight Board Secretariat | OB |
| `intelligence` | supporting | Cross-domain correlation under explicit correlation governance. | 1 | 2 | 0.667 | 1 | Office of the Chief Architect | OB |
| `geo` | generic | Coarse spatial indexing at a privacy-preserving resolution. | 0 | 1 | 1 | 1 | Department of Surveys and Mapping | DGB |
| `composition` | composition-root | Wires config + adapters + contexts; the only place synthetic vs production drivers are chosen. | — | — | — | — | Office of the Chief Architect | ARB |

## Reading the numbers

- **`privacy` (Ca 9, I 0) and `identity-access` (Ca 8, I 0)** are the most-depended-upon and least
  volatile contexts — exactly right: constitutional invariants must be stable.
- **`governance-oversight`, `resilience`, `portfolio` (I 1)** depend on others and are depended on by
  none. They are *consumers of posture*, which is why none of them can be captured by a context they
  observe.
- **`assurance` (Ca 4, Ce 5)** reads widely but is consumed only through the `fitness-contract`
  shared kernel; a fitness function fails the build for whoever broke it, and `APP-FIT-CONTEXT-MAP`
  explicitly forbids `assurance` from depending on `governance-oversight` (no regulator capture).
- **Cohesion is 1.0 for every context** after the boundary review (below): no two contexts claim the
  same responsibility.

## Upstream / downstream (the flow that matters)

```
privacy ─┬─────────────────────────────────────────────────────────► (shared kernel: 9 contexts)
         │
intake ──► investigation ──► analytics ──► ai-advisory ──► [human approval queue]
   ▲            ▲                              (advisory only, never acts)
   │            │
custody ────────┘        platform-events ──► (published language: every context)

identity-access ──► policy-governance ──► (enforcement is conformist everywhere)
crypto-agility ──► persistence · custody · knowledge
infrastructure ──► supply-chain ──► [fail-closed deployment gate]
assurance ──► legislation · portfolio · intelligence ──► governance-oversight ──► [recorded human decision]
```

The **anonymity boundary is crossed once**, in `intake`. `investigation` is deliberately downstream:
an investigator reaches a case, never a reporter.

## Anti-corruption layers

Every external model is translated at a boundary; no foreign model enters the domain.

| Context | Translates |
|---|---|
| `identity-access` | `external-idp` (OIDC/SAML claims → principal + role, never implicit privilege) |
| `persistence` | `external-database`, `external-object-store` |
| `crypto-agility` | `external-kms-hsm` (🔒 key references only, never material) |
| `platform-events` | `external-broker` |
| `data-fabric` | `external-agency-schema` (foreign schema → canonical model) |
| `data-exchange` | `external-agency-consumer` |
| `security` | `external-threat-feed` (**trust-lowering only** — a feed can never grant trust) |
| `tenancy-federation` | `external-jurisdiction` |
| `infrastructure` | `external-cloud-provider` |
| `supply-chain` | `external-supplier` |
| `api-governance` | `external-consumer` |

## Shared kernels

A shared kernel is a definition that **must be identical** across its members; divergence is a defect.

| Kernel | Authority | Members |
|---|---|---|
| `privacy-invariants` | `privacy` | intake, investigation, data-fabric, data-exchange, analytics, ai-advisory, observability, assurance, intelligence, geo |
| `canonical-model` | `data-fabric` | data-fabric, data-exchange, api-governance |
| `pii-free-event-language` | `platform-events` | platform-events |
| `fitness-contract` | `assurance` | assurance, legislation, portfolio, governance-oversight, intelligence |

## Boundary review findings (Part 1)

Each context was reviewed for purpose, boundary integrity, overlap, cohesion and coupling. Outcomes:

| Finding | Decision | Where recorded |
|---|---|---|
| `tenancy/federation` and `tenancy/ecosystem-federation` both modelled "trust between organisations" | **Merged** into one `tenancy-federation` context; one isolation model, two entry points | ADR-0003 |
| "National Data Marketplace" named a commercial model it does not implement | **Renamed** the capability to *National Data Exchange*; `DataMarketplace` retained as the compatible implementation | ADR-0003 |
| `intelligence` and `data-exchange` both claimed `purpose-limitation` | **Scoped**: `intelligence` owns `correlation-purpose-limitation`; `data-exchange` owns exchange purpose limitation | this map |
| Usability evidence had no owning context | **Consolidated** into `portfolio` — user evidence about a service belongs to that service's record | ADR-0003 |
| `govops/center` and `govops/command-center` overlap in reporting | **Kept separate**: operational vs strategic audiences, different cadence; both advisory | ADR-0003 |
| `assurance` reads every context | **Kept**: reads are one-way via the `fitness-contract` kernel; a fitness check forbids the reverse edge | `APP-FIT-CONTEXT-MAP` |

No context is currently marked for further consolidation. Anything that becomes one must name its
target (`consolidateInto`) or the map fails validation.

## Unnecessary abstractions removed / not introduced

- No generic "service layer" or "manager" indirection: contexts expose behaviour, not wrappers.
- No second event abstraction: `platform-events` is the only published language for notifications.
- No parallel identity model in federation — it conforms to `identity-access`.
- No new bounded contexts in v1.9. Stabilization added only *descriptive* modules (context map,
  contracts, migration roadmap, correlation register, usability evidence) inside existing contexts.
