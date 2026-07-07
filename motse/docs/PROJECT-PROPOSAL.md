# Motse — A National Digital Public Infrastructure Platform for Botswana

### Project Proposal

*Version 1.0 · Prepared for review by digital-government, financial-inclusion, and cultural-heritage stakeholders*

---

## 1. Executive summary

**Motse** (Setswana for *home / village*) is a proposal to build Botswana's own
**Digital Public Infrastructure (DPI)** — a single, trusted platform on which
civic, cultural, and financial services can be delivered to every citizen,
including those on feature phones and in areas with intermittent connectivity.

Where most countries assemble digital services as disconnected apps, each
re-inventing identity, payments, and audit, Motse provides **three shared
primitives that every service inherits**: a **verified identity graph**, a
**double-entry money-movement ledger**, and a **governance and audit engine**.
Because these primitives are shared, every service built on Motse is
*trustworthy by construction* — money always balances, every action is audited,
and access is always governed.

Motse goes one decisive step further than a typical platform. It is
**self-governing**: it continuously reconciles its own data against the
authoritative financial ledger, measures the effectiveness of its own
operational decisions, produces a single executive view of platform and business
health, learns from outcomes to improve over time, and **fails its own build
whenever the quality of its evidence regresses**. For a system that will hold
public money and public trust, this ability to *prove* it is working — with
evidence, not assertion — is as important as any feature.

A working reference implementation already exists — the modular monolith,
payment rails, ten service modules, and the full enterprise-intelligence layer —
demonstrating that the architecture is feasible, testable, and production-shaped.
This proposal seeks endorsement and resourcing to harden that implementation into
a national platform.

---

## 2. The opportunity

Botswana has strong institutions, high mobile penetration, established
mobile-money rails, and a national ambition — articulated in **Vision 2036** and
the country's digital-transformation agenda — to become a diversified,
knowledge-based, digitally-enabled economy. Yet the digital experience of
citizens and institutions remains **fragmented**:

- **Services are siloed.** Each ministry, bank, campaign, or cultural project
  builds its own identity, its own payments, its own records — duplicating cost
  and creating inconsistent, hard-to-audit systems.
- **Inclusion is uneven.** Smartphone-first services leave behind feature-phone
  users, rural communities, and the elderly — precisely the people public
  infrastructure exists to serve.
- **Trust is asserted, not proven.** Citizens are asked to trust that funds were
  disbursed, that a community campaign spent honestly, that their cultural
  contribution will not be misused — with little machine-verifiable evidence.
- **Culture is at risk.** Oral history, language, and heritage are eroding faster
  than they are being recorded, and the few digital efforts that exist rarely
  respect consent, ownership, or the wishes of the communities they document.

The global DPI movement (exemplified by India's identity and payments "stack")
shows the alternative: a **thin, shared, sovereign layer** of public digital
rails on which both government and the private sector innovate. Motse is that
layer, designed specifically for Botswana's institutions, languages, and
realities.

---

## 3. Vision and mission

> **Vision.** Every person in Botswana can participate in civic life, preserve
> and share their heritage, and move money safely — through one trusted,
> inclusive, and sovereign digital platform.

> **Mission.** To deliver a national Digital Public Infrastructure whose every
> service is trustworthy by construction, whose reach extends to the feature
> phone and the village kgotla, and which can continuously prove — with
> measurable evidence — that it is operating correctly and in the public
> interest.

---

## 4. What Motse is

### 4.1 Three shared primitives

Every Motse service is built on the same foundation, so trust is inherited rather
than re-implemented:

| Primitive | What it guarantees |
| --- | --- |
| **Verified identity graph** | Progressive identity levels (from anonymous to institutionally verified), role- and scope-based access, device-bound sessions, and community-membership attestation — including identity for feature-phone (USSD) users. |
| **Double-entry ledger** | All money movement is recorded in exact integer units, always balances to zero, is idempotent (never double-charges), and is reconciled against provider statements with automatic variance alerting. |
| **Governance & audit engine** | Every consequential action is written to a tamper-evident, hash-chained audit log with public inclusion proofs; sensitive changes flow through risk-based approval workflows. |

### 4.2 Ten citizen and institutional services

On those primitives, Motse delivers a coherent suite of civic, cultural, and
financial services (Setswana-named, reflecting the institutions they serve):

- **Lelapa** — the household/family unit and its shared records.
- **Kgotla** — traditional and civic governance: councils, seats, elder
  elections, dispute resolution, and public notices.
- **Heritage** — a consent-first cultural archive for oral history, language, and
  tradition, with restricted content that *fails closed* and a strict "no
  training / no derivatives" contract honoured by every pipeline.
- **Puo** — language and learning: courses, lessons, and community correction.
- **Mafelo** — places and **offline data packs** for low-connectivity areas.
- **Loeto** — community tourism experiences and bookings with fair revenue
  splits.
- **Kgetsi** — community fundraising campaigns with escrow, milestone-gated
  release requiring evidence and dual approval, and a **public, verifiable
  campaign ledger**.
- **Letlole** — community trusts and treasuries with signed resolutions and
  transparent balances.
- **Mmino** — music and audio distribution for local artists.

### 4.3 Inclusive payments

Motse meets people where their money already is: **mobile money** (Orange Money,
Mascom MyZaka, BeMobile Smega), **diaspora remittance** (PayPal), and **native
card payments** (with gateway failover, tokenization, 3-D Secure, and
multi-currency) — all posting through the single double-entry ledger, so the
books are always consistent regardless of rail.

### 4.4 Reach: the feature phone and the offline village

Motse is designed for **full parity across channels**. The same commands that
work in the app work over **USSD and SMS**, with the same idempotency and audit
guarantees, and an **offline outbox** replays actions in order, exactly once,
when connectivity returns. Inclusion is an architectural property, not an
after-thought.

---

## 5. The differentiator: a platform that governs itself

A national platform must be *operable* and *auditable* at scale. Motse therefore
includes a complete **enterprise operational and intelligence layer** — the
capability that most sets it apart:

- **Resilience & observability.** Distributed tracing, metrics, structured logs,
  health checks, circuit breakers, bulkheads, load shedding, and self-healing —
  so the platform degrades gracefully and its behaviour is always visible.
- **Governed operations.** Runtime configuration changes are risk-classified and
  flow through approval workflows; disaster-recovery readiness is continuously
  validated against recovery-time and data-loss objectives; capacity is forecast
  from real usage.
- **Business outcome validation.** The platform **reconciles its own business
  telemetry against the authoritative ledger** — if a dashboard disagrees with
  the money, it says so, with the probable cause, the financial exposure, and a
  remediation plan.
- **Decision effectiveness.** Every operational recommendation is tracked as a
  measurable product (was it accepted? did it help?), and the platform
  **recalibrates its own confidence from real outcomes**.
- **Executive intelligence.** One briefing answers the seven questions leadership
  actually asks — *what happened, why, who was affected, how much value was at
  stake, what is recommended, how confident are we, and what happens if we do
  nothing* — backed by a single, sourced confidence score.
- **Continuous learning & evidence integrity.** The platform learns from its
  history and enforces, in its automated build pipeline, that **every metric has
  a source, every recommendation has evidence, every dashboard reflects live
  data, and every confidence score is statistically justified** — failing the
  build if any of this regresses.

In short: Motse does not merely run — it **measures, validates, explains,
improves, and guards itself**. This is the foundation of public trust.

---

## 6. Beneficiaries and stakeholders

| Stakeholder | Value delivered |
| --- | --- |
| **Citizens** | One trusted identity and wallet; inclusive access via feature phone; verifiable transparency for the campaigns and trusts they fund; a voice in civic processes; ownership of their cultural contributions. |
| **Communities (morafe) & dikgosi** | Digital kgotla governance, community trusts and campaigns with public ledgers, and heritage preserved on the community's own terms. |
| **Government & regulators** | A sovereign, auditable rail for service delivery and disbursement; machine-verifiable transparency and compliance evidence. |
| **Financial-inclusion partners** | A consistent, reconciled ledger across every payment rail, lowering the cost and risk of reaching underserved segments. |
| **Cultural & academic institutions** | An ethical, consent-first archive with strong protections against misuse and unauthorised AI training. |
| **Developers & the private sector** | A public SDK and API to build regulated, trustworthy services without re-implementing identity, payments, or audit. |

---

## 7. Technical approach

Motse is a **modular monolith**: services live behind hard internal boundaries in
one deployable, integrating through a versioned, replayable event log. This gives
the operational simplicity of a single system with the clean seams needed to
extract services later. Key architectural commitments:

- **Storage-agnostic by design.** Services depend on a repository interface, so
  the reference implementation's in-memory stores map cleanly to production
  systems of record (a relational database for the ledger, a document store for
  engagement data, object storage for media).
- **Event-sourced core.** An immutable event store supports replay, snapshots,
  schema evolution, and read-model projections — the basis for reporting that can
  never silently drift from truth.
- **Data sovereignty & residency.** A cell-based design supports regional
  isolation and residency requirements; every governed output is
  provenance-signed.
- **Additive, reversible evolution.** Every capability is layered additively over
  the one below, is independently testable, and can be rolled back without
  migration — a discipline enforced by automated quality gates.

The reference implementation is proven by **an extensive automated test suite,
targeted coverage gates (≥95% statements / 95% lines / 90% branches on new code),
and a chaos/production-validation harness** that injects faults and verifies the
telemetry still tells the truth.

---

## 8. Implementation roadmap

The platform is delivered in additive phases, each independently valuable and
shippable. The reference implementation already realises the full arc below;
national delivery re-executes it against production infrastructure and
institutional partners.

| Phase | Focus | Outcome |
| --- | --- | --- |
| **0 — Foundation** | Identity, ledger, governance primitives; core services; feature-phone parity | A trustworthy, inclusive core |
| **1 — Payments & administration** | Mobile money, cards, remittance; the administration portal | Money moves safely; operators can run the platform |
| **2 — National readiness** | Analytics, security assurance, pilots, offline packs, infrastructure-as-code | Ready to pilot at community scale |
| **3 — Extensibility & delivery** | Workflow engine, plugins, public SDK/API, localization, multi-region rollout | Third parties can build; the platform scales nationally |
| **4 — Enterprise operations** | Distributed runtime, resilience, configuration governance, disaster recovery | Operable and recoverable at national scale |
| **5 — Enterprise intelligence** | Business validation, recommendation effectiveness, executive intelligence, continuous learning, evidence integrity | The platform proves and continuously improves its own trustworthiness |

Each phase carries its own acceptance evidence: passing tests, coverage gates,
and validation-harness results.

---

## 9. Governance, security, and compliance

- **Privacy by design.** Analytics are PII-free; restricted cultural content is
  never exposed in public search, exports, or offline packs; sensitive delivery
  uses identity-bound, short-lived signed links.
- **Consent & cultural rights.** Heritage contributions require recorded consent
  in the subject's language; revocation triggers takedown; a "no training / no
  derivatives" flag is enforced by every processing job.
- **Auditability.** A hash-chained audit log with public inclusion proofs makes
  tampering detectable by anyone; the platform can produce a signed compliance
  report on demand.
- **Separation of duties.** High-risk configuration and financial actions require
  distinct approvers and are recorded with full forensic detail.
- **Security assurance.** Continuous risk scoring, account-takeover and abuse
  detection, secret rotation, and dependency/secret scanning are built in.

---

## 10. Risk management

| Risk | Mitigation |
| --- | --- |
| **Adoption / digital literacy** | Feature-phone (USSD/SMS) parity, Setswana-first localization, and community-led pilots through the kgotla. |
| **Connectivity gaps** | Offline data packs and an exactly-once offline outbox; the platform assumes intermittent connectivity as the norm. |
| **Data sovereignty & trust** | Cell-based residency, provenance signing, public audit proofs, and a self-validating evidence layer. |
| **Financial integrity** | Double-entry ledger, idempotency, provider reconciliation with variance alerting, and continuous telemetry-vs-ledger validation. |
| **Operational risk at scale** | Resilience patterns, governed configuration, validated disaster recovery, and capacity forecasting. |
| **Vendor lock-in** | Storage-agnostic repositories, pluggable payment providers, and open standards (OpenTelemetry, Prometheus) throughout. |

---

## 11. Success metrics

Success is measured with the same evidence discipline the platform enforces on
itself:

- **Inclusion** — share of active users transacting via USSD/SMS; rural and
  feature-phone reach.
- **Financial integrity** — reconciliation success rate and telemetry-vs-ledger
  data-confidence at or near 100%; zero unexplained variance.
- **Transparency** — number of campaigns and trusts with a public, verifiable
  ledger; audit-proof verifications served.
- **Trust in operations** — operational-confidence score, recommendation
  precision/recall, and evidence-integrity gate passing on every build.
- **Cultural preservation** — heritage items recorded under consent; contributor
  and community satisfaction.
- **Service adoption** — institutions and third-party developers building on the
  platform.

---

## 12. Sustainability and resourcing

Motse is designed to be **sustainable and sovereign**: open, standards-based, and
storage-agnostic, so it avoids lock-in and can be operated by Botswana
institutions. A phased resourcing model pairs a small, senior platform-engineering
core with domain, security, and community-engagement functions, and scales
delivery partners per phase. Detailed budgets are established per phase against
the acceptance evidence above; because the architecture is additive and
reversible, investment is de-risked — each phase delivers standalone value and can
be paused or rolled back without stranding the prior investment.

*(Indicative budget figures and partner arrangements are developed collaboratively
with sponsoring institutions during phase planning and are intentionally omitted
from this overview.)*

---

## 13. Conclusion

Botswana has the institutions, the mobile rails, and the national ambition to
build public digital infrastructure that belongs to its people. Motse turns that
ambition into architecture: **shared primitives that make every service
trustworthy, reach that includes the feature phone and the offline village,
cultural preservation on the community's terms, and — uniquely — a platform that
can continuously prove it is operating in the public interest.**

A working reference implementation already demonstrates that this is not
aspirational but achievable. We propose to advance it, phase by phase and with
evidence at every step, into the digital home — the *motse* — of Botswana's civic,
cultural, and financial life.

---

*This proposal is accompanied by the full engineering and operations
documentation set (see the [documentation hub](README.md)), which details the
architecture, guarantees, and validation evidence behind every claim above.*
