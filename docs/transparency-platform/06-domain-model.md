# 06 — Domain Model (Domain-Driven Design)

> **Purpose.** Define the **bounded contexts**, their relationships (**context map**), the
> core **aggregates/entities**, the **ubiquitous language**, and a seed **event catalog** for
> the event-driven architecture. This is the backbone the System Architecture (Design phase)
> and the GitHub epics (Delivery phase) hang on. Bounded contexts map 1:many to the 22
> services listed in the brief; the context boundaries — not org charts — drive service
> boundaries.
>
> **Design rule reflected here:** the **four justice modes** (`00 §0.2`) and **separation of
> powers** (`A-JUS-01/03`) are encoded as context boundaries and integration constraints, not
> left to convention.

---

## 6.1 Bounded contexts (core / supporting / generic)

| Context | Type | Owns | Justice mode | Owning arm (data ownership) |
|---------|------|------|--------------|-----------------------------|
| **Confidential Reporting** | Core | Anonymous reports, case codes, reporter threads | 1 | Independent operator (split-trust) |
| **Investigation** | Core | Investigations, tasks, leads, investigator notes | 2 | Executive (police/DCEC/DIS) |
| **Prosecution** | Core | Prosecution decisions, disclosure, charges | 2→3 | DPP |
| **Adjudication (Court)** | Core | Cases, hearings, orders, judgments, cause lists | 3 | Judiciary |
| **Defence** | Supporting | Representation records, defence-visible disclosure | 3 | External professional (scoped) |
| **Customary Justice** | Core | Dikgotla matters, customary proceedings | 3 (customary) | Traditional authority |
| **Corrections** | Supporting | Custody/remand status, production-to-court | 3→corrections | Prison/Rehabilitation Service |
| **Evidence** | Core | Evidence objects, custody chain, integrity proofs | 2/3 | Custodian-of-record per matter |
| **Identity & Access (IAM)** | Generic-critical | Principals, roles, entitlements, sessions | all | Platform (federated) |
| **Governance** | Core | Policies, decisions, conflicts, threshold approvals, transparency reports | governance | Independent Oversight Trust |
| **Oversight** | Supporting | Oversight reviews, escalations, responsiveness tracking | oversight | Ombudsman/oversight bodies |
| **Transparency & Analytics** | Supporting | Aggregated metrics, published datasets, methodology | 4 | Platform (governed) |
| **Notification** | Generic | Notification events, delivery, preferences | all | Platform |
| **Secure Messaging** | Generic-critical | Message threads, keys, delivery (mode-appropriate) | 1/2/3 | Platform (E2E where required) |
| **Audit** | Generic-critical | Append-only, anchored audit trail | all | Independent audit + platform |
| **Digital Archive** | Supporting | Long-term records, retention, sealing | all | Registrar/records owners |

> **Anti-Corruption Layer (ACL) note:** every integration with *existing* institutional
> systems (A-JUS-02) sits behind an ACL that translates external models into our ubiquitous
> language and prevents legacy models from leaking in. This isolates NJTIP from the
> heterogeneity and quality of legacy court/police IT.

## 6.2 Context map (relationships)

```mermaid
flowchart TB
  CR[Confidential Reporting] -->|CoI-routed report event| INV[Investigation]
  CR -.responsiveness.-> OV[Oversight]
  INV -->|case file handoff| PROS[Prosecution]
  PROS -->|charge/indictment| ADJ[Adjudication / Court]
  ADJ <-->|disclosure (scoped)| DEF[Defence]
  ADJ -->|production order| COR[Corrections]
  CUS[Customary Justice] -.escalation.-> ADJ
  EVID[Evidence] --- INV
  EVID --- PROS
  EVID --- ADJ
  IAM[(Identity & Access)] --- CR
  IAM --- INV
  IAM --- PROS
  IAM --- ADJ
  IAM --- DEF
  AUD[(Audit)] --- CR
  AUD --- INV
  AUD --- PROS
  AUD --- ADJ
  GOV[Governance] -->|signs recipient directory / policy| CR
  GOV --> OV
  ADJ --> TA[Transparency & Analytics]
  INV --> TA
  CR --> TA
  OV --> TA
  NOTIF[(Notification)] --- ADJ
  NOTIF --- CR
  MSG[(Secure Messaging)] --- CR
  MSG --- DEF
  ARC[(Digital Archive)] --- ADJ
  ARC --- EVID

  classDef judiciary fill:#e8eefc,stroke:#3b5bdb;
  classDef exec fill:#fde8e8,stroke:#c0392b;
  classDef indep fill:#e8f8ef,stroke:#1e874b;
  class ADJ,DEF,ARC judiciary;
  class INV,PROS,COR exec;
  class CR,GOV,OV indep;
```

**Relationship patterns (DDD):**
- **Confidential Reporting → Investigation:** *Customer–Supplier* via a **published event**
  (CoI-routed), through an **ACL**; Reporting never exposes reporter identity downstream
  (there is none to expose).
- **Investigation → Prosecution → Adjudication:** *Customer–Supplier* handoffs, each behind an
  ACL, each arm owning its own data (separation of powers).
- **Adjudication ↔ Defence:** *Partnership* limited to lawful disclosure; Defence reads a
  **scoped projection**, never investigative internals.
- **Evidence:** *Shared Kernel* of integrity primitives (hash, custody event, timestamp)
  used by Investigation/Prosecution/Adjudication — but each access is authz'd and audited;
  the *custodian of record* changes as a matter progresses.
- **IAM / Audit / Notification / Messaging:** *Generic/Conformist* shared platform contexts;
  IAM, Audit, and Messaging are **security-critical generics** (not "just" plumbing).
- **Governance → Reporting/Oversight:** *Upstream* — governance signs the recipient directory
  and policies that Reporting/Oversight conform to.
- **Everything → Transparency & Analytics:** one-way, **aggregate-only**, via a
  privacy-preserving projection (no raw records cross the boundary).

## 6.3 Core aggregates (selected — full ERDs in the Design phase)

| Context | Aggregate root | Key entities / value objects | Invariants (examples) |
|---------|----------------|------------------------------|-----------------------|
| Confidential Reporting | **Report** | CaseCode (VO), ReportContent (encrypted), EvidenceRef[], Thread | No PII field exists; CaseCode is high-entropy, server-unlinkable to identity |
| Investigation | **Investigation** | Task[], Lead[], Note[], AssignedInvestigator, CoIStatus | Cannot assign an investigator flagged in conflict-of-interest |
| Prosecution | **ProsecutionMatter** | ChargeDecision, DisclosureItem[], Deadline[] | Every disclosure action is audited; deadlines tracked |
| Adjudication | **Case** | Hearing[], Order[], Judgment, PartyRole[], SealStatus | State transitions follow the case state machine; sealed matters excluded from public projection |
| Defence | **Representation** | Lawyer, MatterRef, DisclosedItemRef[] | Access strictly scoped to matters on record |
| Evidence | **EvidenceObject** | ContentHash (VO), CustodyEvent[], Timestamp (VO), AccessGrant[] | Immutable content; every access appends a custody event; integrity re-verified on read |
| IAM | **Principal** | Role[], Entitlement[], Credential, Session | No standing privilege on sensitive scopes; sensitive actions require step-up + (some) dual control |
| Governance | **GovernanceDecision** | Policy, ConflictDeclaration[], ThresholdApproval[] | Sensitive capabilities need M-of-N approval; decisions are non-repudiable & logged |
| Oversight | **OversightReview** | ResponsivenessMetric[], Escalation[] | Reads aggregates/audit only; cannot mutate case data |
| Transparency & Analytics | **PublishedMetric** | AggregationSpec, SuppressionRule, Methodology | Below-threshold cells suppressed; no individual-level output path exists |
| Audit | **AuditRecord** | PrevHash, Actor, Action, Purpose, Timestamp | Append-only; hash-chained; periodically externally anchored |

## 6.4 Event catalog (seed — for the event-driven backbone)

Events are **facts about the past**, named in the ubiquitous language, carrying **minimal,
purpose-bound** payloads (data-minimization by design). PII/identity is **never** in an event
crossing a context boundary.

| Event | Emitted by | Consumed by | Payload (minimized) |
|-------|-----------|-------------|---------------------|
| `ReportSubmitted` | Confidential Reporting | (internal) | CaseCode, category, timestamp (coarse) |
| `ReportRouted` | Confidential Reporting/Governance | Investigation, Oversight | CaseCode, recipientId, CoIStatus |
| `ReportReceived` | Investigation | Oversight | CaseCode, receiptRef, timestamp |
| `EvidenceIngested` | Evidence | Investigation/Prosecution/Adjudication | evidenceId, contentHash, custodyRef |
| `EvidenceAccessed` | Evidence | Audit | evidenceId, actorRole, purpose, timestamp |
| `InvestigationOpened` / `…Closed` | Investigation | Prosecution, Oversight, Analytics | investigationId, status, timestamps |
| `ProsecutionDecided` | Prosecution | Adjudication, Analytics | matterId, decisionType, timestamp |
| `CaseFiled` / `HearingScheduled` / `HearingHeld` / `OrderIssued` / `JudgmentDelivered` | Adjudication | Defence, Corrections, Notification, Analytics | caseId, event-specific minimal fields, sealFlag |
| `DisclosureMade` | Prosecution | Defence, Audit | matterId, itemRef, timestamp |
| `RemandStatusChanged` | Corrections | Oversight, Analytics | custodyRef, status, timestamp |
| `ResponsivenessBreached` | Oversight | Governance, Analytics | metricId, target, actual |
| `GovernanceApprovalGranted` | Governance | (target context) | approvalId, capability, M-of-N ref |
| `AuditRecordAppended` | Audit | (anchoring service) | recordHash, prevHash |
| `MetricPublished` | Transparency & Analytics | (public) | metricId, aggregate values, methodologyRef |

> **CQRS opportunity (flagged for Design phase):** read-heavy, role-differentiated views
> (case status per party role, transparency aggregates, oversight dashboards) are natural
> **read models** projected from these events, separate from the write models that enforce
> invariants. This keeps party-scoped projections (I-5/DD-1 mitigation) out of the
> authoritative aggregates.

## 6.5 Ubiquitous language (glossary — extract)

| Term | Meaning in NJTIP |
|------|------------------|
| **Report** | A confidential submission by an anonymous reporter (Mode 1). *Not* a "case." |
| **Case** | A matter before a court (Mode 3), owned by the Judiciary. |
| **Investigation** | An authorized inquiry (Mode 2), owned by the executive arm. |
| **Case code** | High-entropy, client-generated handle for an anonymous report; carries no identity. |
| **Custodian of record** | The party currently accountable for an evidence object's custody. |
| **Authorized recipient** | An institution/unit permitted (and not in conflict) to receive a routed report. |
| **Non-attributable** | Aggregated so no individual can be re-identified (transparency outputs). |
| **Split trust / threshold** | Sensitive capability requiring M-of-N independent custodians. |
| **Seal / sealed matter** | A case/record with restricted visibility under statutory exception. |
| **Responsiveness** | Measured latency from report intake to recipient action (non-attributable). |

> A conflated vocabulary is how justice-tech projects blur Mode 1 and Mode 3 and leak
> reporter data into case data. Keeping "Report" ≠ "Case" in the language is a control.

## 6.6 Definition-of-Done

- [x] Bounded contexts defined with type, ownership arm, and justice mode.
- [x] Context map with DDD relationship patterns and separation-of-powers coloring.
- [x] Core aggregates with example invariants that encode safety/separation rules.
- [x] Event catalog seed with minimized, PII-free cross-context payloads.
- [x] CQRS opportunities and ubiquitous-language glossary (with the Report≠Case control).
- **Required specialist review:** DDD/domain experts with each institution; privacy review of
  event payloads (no identity crosses boundaries); judicial review of Adjudication ownership;
  security review of IAM/Audit/Messaging as security-critical generics.

*Next: `07-capability-map.md`.*
