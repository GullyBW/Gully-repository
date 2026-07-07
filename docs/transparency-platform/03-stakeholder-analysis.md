# 03 — Stakeholder Analysis

> **Method & honesty.** For each stakeholder we document: *role*, *goals/needs* (as inferred
> from the role — **not** invented quotes or claimed opinions), *key interactions*,
> *permissions posture*, *risks TO them*, *risks FROM them* (every stakeholder is also a
> potential threat), *incentives*, and *design implications*. Needs marked `⟦validate⟧` must
> be confirmed by genuine engagement with that group before design relies on them. Per the
> brief: **we do not invent stakeholder opinions.**
>
> "Permissions posture" is a *direction of travel* for the later Permission Matrix, not the
> final RBAC/ABAC spec.

---

## 3.1 Stakeholder map (by relationship to the platform)

| Group | Primary justice mode | Trust zone (see §09) |
|-------|----------------------|----------------------|
| Citizens, victims, witnesses, reporters | Reporting, access | **Untrusted client** (anonymous where applicable) |
| Lawyers, public defenders | Adjudication, access | Identified external professional |
| Prosecutors (DPP) | Investigation→adjudication | Identified executive-justice |
| Police / DCEC / DIS investigators | Investigation | Identified executive |
| Judges, magistrates, judicial officers, court admin/registrars | Adjudication | Identified judiciary (independent) |
| Kgosis / customary courts | Customary adjudication, access | Identified traditional authority |
| Prison/rehabilitation service | Corrections | Identified executive |
| Oversight bodies (Ombudsman, judicial oversight, audit) | Oversight | Identified independent |
| Governance body (Independent Oversight Trust) | Governance | **Split-trust custodian** |
| Civil society, journalists | Transparency | External public consumer |
| Legal aid providers | Access | Identified external |
| Policymakers | Policy | External consumer of aggregates |
| Platform operators/admins/SRE/SOC | Operations | **In threat model** (least privilege, dual control) |
| Auditors (internal/external) | Assurance | Independent read-only + integrity |
| Domain experts (criminologists, psychologists, psychiatrists, accessibility experts) | Advisory/design | Non-operational advisors |

---

## 3.2 Detailed stakeholder records

### Citizens / victims / witnesses / reporters
- **Role:** raise integrity concerns (Mode 1), seek information/access to justice, participate
  as victims/witnesses.
- **Needs `⟦validate⟧`:** safety and anonymity when reporting; a channel they trust; to know
  their report/case went somewhere; plain-language, Setswana-first, low-cost, offline-capable
  access; dignity and non-re-victimization; clarity on rights and next steps.
- **Interactions:** mobile app / PWA / (per checkpoint) USSD-SMS-voice; secure messaging with
  case handlers; notifications; public transparency dashboard.
- **Permissions posture:** anonymous or self-sovereign pseudonymous; can see only their own
  matter; cannot see others' data.
- **Risks TO them:** retaliation, de-anonymization, coercion, re-victimization, exclusion by
  language/literacy/disability/connectivity.
- **Risks FROM them:** false/malicious/defamatory reports, flooding (TA-7); accidental self-
  identification.
- **Incentives:** safety, resolution, being heard, trust that it matters.
- **Design implications:** operator-in-threat-model anonymity, honest risk UX (U-1),
  multi-channel accessible design, non-attributable responsiveness metrics, anti-abuse that
  preserves anonymity.

### Lawyers (private) & Public Defenders
- **Role:** represent parties; defenders provide state/assigned defence.
- **Needs `⟦validate⟧`:** timely case status/scheduling; access to their clients' case record
  and disclosed evidence; secure communication; document filing; caseload management
  (defenders often over-loaded).
- **Interactions:** dedicated workspaces; case management; evidence (disclosed subset);
  scheduling; messaging.
- **Permissions posture:** access scoped to matters they are on record for; defence sees
  disclosed prosecution evidence per rules, not investigative internals.
- **Risks TO them:** information disadvantage vs prosecution; overload; security of privileged
  comms.
- **Risks FROM them:** unauthorized access attempts, leakage, conflicts of interest.
- **Incentives:** effective representation, efficiency, fairness.
- **Design implications:** equality-of-arms in information design; strict matter-scoped ABAC;
  privileged-communication protection; defender workspace as a first-class component (P9).

### Prosecutors (DPP)
- **Role:** assess, direct, and conduct prosecutions; disclosure obligations.
- **Needs `⟦validate⟧`:** case files from investigators; evidence with integrity; scheduling;
  disclosure tracking; workload/priority tools.
- **Permissions posture:** access to matters assigned; can receive routed investigations;
  disclosure actions audited.
- **Risks TO them:** interference, coercion, security of case data.
- **Risks FROM them:** selective or improper prosecution, disclosure failures, insider misuse (P7).
- **Incentives:** just outcomes, conviction integrity, efficiency, protection from interference.
- **Design implications:** prosecutor workspace; audited disclosure workflow; segregation from
  judiciary data (A-JUS-03); anomaly detection on case handling.

### Police / DCEC / DIS Investigators
- **Role:** investigate; collect evidence; may be authorized recipients of Mode-1 reports.
- **Needs `⟦validate⟧`:** intake of reports/tips; evidence capture with chain of custody;
  case collaboration; secure storage; scheduling with courts/prosecution.
- **Permissions posture:** least privilege, matter-scoped, dual control for sensitive actions;
  **conflict-of-interest routing** so an implicated unit cannot handle its own report.
- **Risks TO them:** targeting, coercion, operational security exposure.
- **Risks FROM them:** the central threat actor for Mode 1 (TA-1) when they are the *subject*
  of a report; evidence tampering, leaks, abuse of investigative powers (P7).
- **Incentives:** solve cases; but incentives can be adverse where they are implicated.
- **Design implications:** they are **both user and adversary** depending on context —
  investigation tooling must be usable *and* wrapped in audit, least privilege, dual control,
  and conflict-of-interest routing. This duality is designed for explicitly.

### Judges, Magistrates, Judicial Officers, Court Administrators / Registrars
- **Role:** adjudicate; manage court records, scheduling, registries.
- **Needs `⟦validate⟧`:** reliable case records; scheduling; document management; integrity of
  evidence before them; independence from executive interference; open-justice compliance.
- **Permissions posture:** judiciary-owned data zone; access by matter and role; registrar
  controls records/sealing/redaction.
- **Risks TO them:** interference, security, reputational risk from data errors.
- **Risks FROM them:** case-fixing, improper sealing, insider misuse (P7); but also the arm
  whose independence must be *protected* by design.
- **Incentives:** fair, efficient, defensible adjudication; institutional independence.
- **Design implications:** **judicial-independence data ownership** (A-JUS-03) is a hard trust
  boundary; court admin portal; registrar-controlled archive/sealing; open-justice publication
  rules (A-JUS-04).

### Kgosis / Customary Courts (dikgotla)
- **Role:** administer customary justice; often citizens' first/primary justice contact
  (A-JUS-06).
- **Needs `⟦validate⟧`:** recognition and appropriate (not imposed) tooling; language and
  cultural fit; linkage to the formal system where matters escalate.
- **Permissions posture:** distinct customary context; careful data-sharing with formal system.
- **Risks TO them:** inappropriate digitization that disrupts legitimate custom; exclusion.
- **Risks FROM them:** inconsistent record-keeping; rights concerns requiring safeguards.
- **Incentives:** community legitimacy, efficient local resolution.
- **Design implications:** customary justice is a **first-class domain**, engaged *with*
  traditional leaders, not an afterthought; avoid imposing formal-court models onto dikgotla.
  🔒 requires genuine consultation.

### Prison / Rehabilitation Service
- **Role:** custody, remand management, rehabilitation.
- **Needs `⟦validate⟧`:** remand/case-status linkage (to prevent over-detention from delay,
  P2); scheduling for court production; records.
- **Permissions posture:** scoped to custodial function; case-status read via events.
- **Risks TO/FROM them:** detainee rights; data on vulnerable persons; insider misuse.
- **Design implications:** remand-status integration to surface over-detention as an oversight
  metric; strict handling of vulnerable-person data.

### Oversight bodies (Ombudsman, judicial oversight, audit institutions)
- **Role:** independent scrutiny of institutions and of the platform itself.
- **Needs `⟦validate⟧`:** access to aggregated/audited data; responsiveness metrics; ability
  to investigate patterns; escalation authority.
- **Permissions posture:** independent read + audit; cannot alter case data; own their records.
- **Risks TO them:** capture, under-resourcing.
- **Risks FROM them:** overreach into judicial independence; data misuse.
- **Design implications:** Oversight Portal; non-attributable analytics; escalation workflow;
  they are a key check that Mode-1 reports are acted on (A-GOV-04, R-1).

### Governance body — Independent Oversight Trust (proposed)
- **Role:** the operator/governor of the platform; custodian of split trust for anonymity.
- **Needs:** genuine independence (A-GOV-01); tooling for decisions, conflict-of-interest,
  transparency reporting, threshold key custody, audit scheduling.
- **Permissions posture:** **no single member can act alone**; threshold/dual control for any
  sensitive capability; all actions logged non-repudiably.
- **Risks TO them:** coercion, capture, targeting.
- **Risks FROM them:** governance capture makes split-trust theater (top residual risk).
- **Design implications:** governance is engineered as a software subsystem (policy engine,
  decision log, threshold controls, governance dashboards) — see Governance batch.

### Civil society & Journalists
- **Role:** watchdogs; amplify transparency; sometimes conduits for reporters.
- **Needs `⟦validate⟧`:** access to verified aggregate data; confidence in platform integrity;
  ability to hold institutions accountable.
- **Permissions posture:** public read of transparency outputs; no access to case/reporter data.
- **Risks TO them:** targeting; being fed manipulated data.
- **Risks FROM them:** pressure to publish unverified allegations (which the platform must not
  supply); mis-contextualizing aggregates.
- **Design implications:** rigorous, clearly-caveated public data; the platform never provides
  individually identifying allegations (hard rule); methodology transparency.

### Legal aid providers
- **Role:** assist unrepresented/low-income litigants.
- **Needs `⟦validate⟧`:** intake, case linkage, resources, scheduling for their clients.
- **Design implications:** legal-aid access as part of the access-to-justice layer (P5, P9).

### Policymakers
- **Role:** set policy, resourcing, reform.
- **Needs `⟦validate⟧`:** reliable aggregate insight (P10); trend/bottleneck analysis.
- **Permissions posture:** aggregate-only, purpose-limited (DD-2).
- **Risks FROM them:** function creep; politicizing data; defunding independence.
- **Design implications:** privacy-preserving analytics with strict purpose limitation and
  governance approval for new uses.

### Platform operators / admins / SRE / SOC (incl. outsourced — A-OPS-01)
- **Role:** run, secure, and maintain the platform.
- **Needs:** operability, observability, incident response — *without* standing access to
  sensitive data.
- **Permissions posture:** **zero standing privilege**; just-in-time, dual-authorized,
  time-boxed, fully-audited access; cannot alone de-anonymize (E-1).
- **Risks FROM them:** the insider threat (TA-2), including coercion and bribery.
- **Design implications:** operator-in-threat-model is realized here — the hardest access
  controls apply to the people running the system.

### Auditors (internal & external / independent)
- **Role:** assure security, privacy, integrity, and governance.
- **Needs:** tamper-evident logs, independent read access, reproducible evidence of controls.
- **Design implications:** Audit Platform with append-only, externally-anchored logs (T-2),
  scheduled independent audits (governance).

### Domain experts (criminologists, psychologists, psychiatrists, accessibility experts)
- **Role:** advise on trauma-informed, humane, accessible, and effective design; not
  operational users.
- **Needs:** input channels into design; evidence-based guidance.
- **Design implications:** trauma-informed UX for victims/witnesses; accessibility by default;
  humane handling of vulnerable persons. Engaged in design, not given data access.

---

## 3.3 Cross-cutting tensions between stakeholders

| Tension | Between | How the design holds it |
|---------|---------|-------------------------|
| Anonymity vs. accountability | Reporters ↔ investigators/courts | Mode separation: repudiability for reporters, non-repudiation for officials |
| Transparency vs. confidentiality/sub judice | Public/journalists ↔ courts/parties | Only verified aggregates public; open-justice exceptions auto-enforced |
| Integration vs. separation of powers | Agencies ↔ judiciary | Event-driven, permissioned, arm-owned data; no central pool (A-JUS-03) |
| Investigator as user vs. as adversary | Police ↔ reporters | Conflict-of-interest routing; audit; dual control |
| Access/reach vs. metadata safety | Citizens ↔ their own safety | Multi-channel with honest per-channel risk guidance (DT-1) |
| Operator utility vs. operator-in-threat-model | SRE/SOC ↔ reporters | Zero standing privilege; split trust |

## 3.4 Definition-of-Done

- [x] Every stakeholder group documented with role, needs, interactions, permissions posture,
  risks-to and risks-from, incentives, and design implications.
- [x] No invented opinions; role-inferred needs tagged `⟦validate⟧` for engagement.
- [x] Dual "user *and* adversary" nature captured where it applies (esp. investigators, operators).
- [x] Cross-stakeholder tensions surfaced and mapped to design responses.
- **Required specialist review:** each institution validates its own record; criminologists/
  psychologists for trauma-informed design; accessibility experts; customary-law/Kgosi
  engagement (A-JUS-06); CSOs for citizen and watchdog needs.

*Next: `04-functional-gap-analysis.md`.*
