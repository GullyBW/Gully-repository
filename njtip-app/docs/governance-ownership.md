# Governance Ownership Model (Stabilization Part 14 · Phase 11, Part 13)

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

---

# Governance Continuity (Phase 11, Part 13)

An owner who is on leave is an owner who cannot decide, and a governance object with nobody
available to decide is a governance object that has quietly stopped being governed. Continuity
makes that visible instead of leaving it to be discovered.

Gated by `APP-FIT-GOVERNANCE-CONTINUITY`. Live: `GET /api/governance/continuity`.

## Deputies are derived, not listed

> **The rule:** *Deputy &lt;primary office&gt;*, unless an override records a different named deputy.

Deriving them from a stated rule rather than hand-listing thirty records means **a new bounded
context cannot be added without a deputy** — there is nothing to forget to fill in. Overrides exist
where the deputy is genuinely a different office: a board's deputy is its **vice-chair**, not a
"Deputy Board".

Two structural rules are checked as part of ownership validation itself, because a continuity model
that quietly breaks separation of duties is worse than none:

- A deputy may never be the primary.
- **Substitution must not collapse separation of duties** — the deputy responsible authority may not
  be the approving authority or its deputy. Otherwise one person's absence dissolves the separation
  the primary structure exists to keep.

## Availability and the effective owner

An absence names a person, a reason, the human who recorded it, and **a start and an end**. An
open-ended absence is refused: that is an unfilled post, not an absence.

```
effectiveOwner(subsystem, role, at)
  primary available  → the primary holds it
  primary away       → the named deputy holds it
  both away          → OWNERSHIP GAP; escalates to the governance board
```

Nothing defaults to whoever happens to be around. `coverageScore()` reports the fraction of
(subsystem × role) pairs with somebody actually able to decide — 120 pairs across the platform — and
`ownershipGaps()` names every one that is uncovered, structurally defective, or overdue for review.

## Succession

```
1. primary accountable office
2. named deputy
3. the governance board — the terminal authority
```

Every chain has exactly this shape and always ends at a board. **A succession chain that ends in a
person can end in nobody.** Where the accountable office *is* the board, the chain reads chair →
vice-chair → the board sitting as a body: a chair acting alone and a quorate board are different
authorities, and only the second can act when the first two cannot.

## Review cadence

| Board | Cadence |
|---|---|
| ISRB · OB | 90 days |
| ARB · DGB · ORB | 180 days |
| SDB | 365 days |

**A never-reviewed record is `overdue`, not `pending`.** A record nobody has ever checked is the
least trustworthy kind, so it cannot sit in a softer bucket than one merely reviewed too long ago.

---

# Active Ownership: Activity, Training & Escalation (Phase 12, Part 13)

Phase 11 asked *"is somebody available to decide?"* That is necessary and not sufficient.

- An owner who has recorded no governance act in eight months is **nominally available and
  practically absent**.
- An owner whose mandatory training lapsed two years ago is available, active, and **not currently
  competent** to exercise the role.

Both look identical in an availability register. Both are how a governance object stops being
governed while the org chart still says otherwise.

> **Availability is what somebody declared. Activity is what they did. Training is what they are
> certified to do.** Three separate facts; satisfying one does not imply the others.

## Activity monitoring

`ActivityRegister` records governance acts — `decision`, `approval`, `review`,
`escalation-response`, `attestation` — each attributed and timestamped.

| Band | Days since last act | Meaning |
|---|---|---|
| `active` | ≤ 90 | Has exercised the role within the current review cycle |
| `stale` | ≤ 180 | Has not acted in over a quarter — verify the role is still held |
| `dormant` | > 180 | Treat the role as vacant until confirmed |
| **`never-acted`** | — | **No governance act has ever been recorded. An office nobody has seen act is an office on paper** |

`never-acted` is its own band and the worst one. It is not an absence of evidence that gets rounded
up to "probably fine".

## Training status

| Role | Required |
|---|---|
| `responsibleAuthority` | records-management · evidence-handling |
| `approvingAuthority` | records-management · separation-of-duties |
| `operationalOwner` | incident-response · records-management |
| `dataSteward` | data-protection · records-management |

Valid for 365 days. **Missing and expired are reported separately**, because the remedy differs: one
is "book the course", the other is "you have been operating uncertified." A completion must be
attested by a named human — a self-declared certification certifies nothing.

## Escalation as a workflow

Phase 11 published the escalation *path*. A path nobody walks is a picture. `EscalationWorkflow`
makes it stateful:

```
raised ──acknowledge──► acknowledged ──resolve──► resolved
   │
   └─ unacknowledged past 24 h → reported as overdue, escalated to the terminal board
```

**Resolution cannot skip acknowledgement.** "Resolved without anyone admitting they saw it" is
exactly the record that makes an after-the-fact review impossible.

## Active coverage

`activeCoverage()` is the Part 13 invariant — *no governance object without active ownership* — and
is deliberately separate from `coverageScore()`, which still answers the narrower availability
question and is unchanged.

**Activity and training default to unknown when no register is supplied, and unknown is reported as
unknown.** A platform that treats "we have no record of this owner acting" as evidence of active
ownership has inverted the meaning of the word evidence. The composition root therefore starts these
registers **empty**: a freshly composed platform genuinely has no governance history, and seeding
one would report a past that never happened.

`continuityDashboard()` aggregates availability, activity, training, escalation and review to the
**weakest** of them, and names the dormant and uncertified owners rather than reporting a percentage.

Live: `GET /api/governance/continuity/dashboard` (oversight-board).

---

# Knowledge Continuity (Phase 13, Part 8)

See [`institutional-resilience.md`](./institutional-resilience.md) for the full treatment. In short:
`knowledgeContinuity()` reports, per (subsystem, role), whether the primary is ready, whether the
deputy is ready, and the **bus factor** — how many people could actually take over.

`roleReadiness()` is the weakest of availability, activity, training and rehearsal. Because this
model derives a deputy for every role, a deputy counts only when assessed on the same evidence as the
primary; otherwise every role would report a bus factor of two and mean nothing.
