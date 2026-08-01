# Governance Ownership Model (Stabilization Part 14)

Technical architecture must reflect **organisational accountability**. Every bounded context in the
[context map](./context-map.md) has exactly one accountability record naming who is responsible, who
approves, who operates, who stewards the data, which board governs it, and how issues escalate.

Enforced by `APP-FIT-GOVERNANCE-OWNERSHIP` (`src/governance/ownership.js`): a context without a
complete record fails the build, and **the responsible authority may never also be the approving
authority** — separation of duties is structural, not procedural. Live view:
`GET /api/governance/ownership`.

> The model **records** accountability; it never exercises it. Approvals, escalations and governance
> decisions are performed by named humans and recorded in the append-only governance ledger.

## Governance boards (escalation terminals)

| Board | Mandate | Contexts governed |
|---|---|---|
| **ARB** — Architecture Review Board | Architecture changes, ADR conformance; veto on invariant breach | persistence, platform-events, orchestration, tenancy-federation, assurance, api-governance, developer-platform, composition |
| **ISRB** — Information Security Review Board | 🔒 Security-critical subsystems; cryptography and key-custody sign-off | identity-access, policy-governance, crypto-agility, security, supply-chain |
| **OB** — Oversight Board | Constitutional invariants and governance decisions; super-majority for zone/identity change | privacy, intake, custody, investigation, ai-advisory, legislation, knowledge, governance-oversight, intelligence |
| **DGB** — Data Governance Board | Classification, purpose limitation, retention, exchange approval | data-fabric, data-exchange, analytics, geo |
| **ORB** — Operations Review Board | Availability, capacity, change and incident management | infrastructure, observability, resilience |
| **SDB** — Service Delivery Board | Citizen-facing service quality, portfolio and lifecycle decisions | portfolio |

## Accountability records

| Context | Responsible authority | Approving authority | Operational owner | Data steward | Board |
|---|---|---|---|---|---|
| `identity-access` | National Identity Authority | ISRB | Platform Security Operations | Identity Data Steward | ISRB |
| `policy-governance` | Office of the CISO | ISRB | Policy Engineering Team | Policy Steward | ISRB |
| `persistence` | Government Data Centre Authority | ARB | Platform Engineering | Records Steward | ARB |
| `crypto-agility` | National Cryptographic Authority | ISRB | Key Custody Team | Key Custody Steward | ISRB |
| `platform-events` | Office of the CTO | ARB | Platform Engineering | Event Contract Steward | ARB |
| `privacy` | Data Protection Commissioner | Oversight Board | Privacy Engineering Team | Privacy Officer | OB |
| `intake` | Independent Complaints Directorate | Oversight Board | Intake Service Team | Reporting Data Steward | OB |
| `custody` | Directorate of Forensic Services | Oversight Board | Evidence Custody Team | Evidence Steward | OB |
| `investigation` | Directorate on Corruption and Economic Crime | Oversight Board | Investigation Service Team | Case Data Steward | OB |
| `orchestration` | Office of the CTO | ARB | Workflow Engineering Team | Process Steward | ARB |
| `data-fabric` | National Data Office | Data Governance Board | Data Platform Team | Canonical Model Steward | DGB |
| `data-exchange` | National Data Office | Data Governance Board | Data Exchange Team | Exchange Data Steward | DGB |
| `analytics` | Office of Statistics and Analysis | Data Governance Board | Analytics Team | Analytics Steward | DGB |
| `ai-advisory` | Office of Statistics and Analysis | AI Governance Board | Decision Support Team | Model Steward | OB |
| `security` | National CIRT | ISRB | Security Operations Centre | Threat Intelligence Steward | ISRB |
| `tenancy-federation` | Ministry of Public Administration | ARB | Federation Team | Tenant Steward | ARB |
| `infrastructure` | Government Data Centre Authority | Operations Review Board | Infrastructure Operations | Configuration Steward | ORB |
| `supply-chain` | Public Procurement Authority | ISRB | Supply Chain Assurance Team | Supplier Records Steward | ISRB |
| `observability` | Office of the CTO | Operations Review Board | Site Reliability Engineering | Telemetry Steward | ORB |
| `resilience` | National Disaster Management Office | Operations Review Board | Resilience Engineering Team | Continuity Steward | ORB |
| `assurance` | Office of the Chief Architect | ARB | Assurance Engineering Team | Evidence Steward | ARB |
| `legislation` | Attorney General Chambers | Oversight Board | Legal Informatics Team | Legislative Steward | OB |
| `api-governance` | Office of the CTO | ARB | API Platform Team | Contract Steward | ARB |
| `developer-platform` | Office of the CTO | ARB | Developer Experience Team | SDK Steward | ARB |
| `knowledge` | National Archives and Records Services | Oversight Board | Knowledge Management Team | Records Steward | OB |
| `portfolio` | Ministry of Public Administration | Service Delivery Board | Service Portfolio Team | Service Records Steward | SDB |
| `governance-oversight` | Oversight Board Secretariat | Oversight Board | Governance Operations Team | Decision Ledger Steward | OB |
| `intelligence` | Office of the Chief Architect | Oversight Board | Systems Intelligence Team | Correlation Steward | OB |
| `geo` | Department of Surveys and Mapping | Data Governance Board | Geospatial Team | Geospatial Steward | DGB |
| `composition` | Office of the Chief Architect | ARB | Platform Engineering | Configuration Steward | ARB |

## Escalation

Every path runs **operational owner → responsible authority → governance board** and must terminate
at a recognised board (verified by fitness). Example:

```
custody:  Evidence Custody Team → Directorate of Forensic Services → Oversight Board
identity: Platform Security Operations → National Identity Authority → ISRB
```

## Where accountability binds to the platform

| Decision | Who decides | Recorded as |
|---|---|---|
| Go-live / production deployment | Approving authority + board | Governance ledger entry (never a readiness score) |
| Architecture change | ARB (OB super-majority for constitutional invariants) | ADR + updated context map |
| 🔒 Cryptography / key custody | ISRB | ISRB sign-off; keys human-built |
| Data exchange for a restricted dataset | Data steward + DGB | Named approver on the exchange agreement |
| Recovery execution | Named human authority | Recovery authorization record |
| Legislative enactment | Attorney General Chambers + OB | Enactment record (simulation is advisory) |
| AI model use | AI Governance Board | Model approval record |

**Roles only.** The model never stores a named individual, an email address or any personal
identifier — a fitness check asserts it.
