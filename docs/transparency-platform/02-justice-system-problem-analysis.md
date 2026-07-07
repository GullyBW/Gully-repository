# 02 — Justice-System Problem Analysis

> **Method.** For each systemic problem we give: *symptom* (what people experience) →
> *root causes* (why it happens) → *systemic impact* (second-order effects) → *who is
> affected* → *what a platform can and cannot do*. This is a **root-cause** analysis, not a
> feature wishlist: NJTIP capabilities are justified later by tracing back to a root cause
> here.
>
> **Evidence honesty (per brief).** Problems below are framed from publicly documented,
> *general* challenges common to justice systems and from the platform's own design logic.
> **Every claim specific to Botswana's institutions is an assumption to be validated through
> stakeholder engagement and local research — not an assertion of fact.** Such claims are
> tagged `⟦validate⟧`. We do **not** invent stakeholder opinions.

---

## 2.1 Problem domains (overview)

| # | Problem domain | Primary justice mode affected | Owning assumption(s) |
|---|----------------|-------------------------------|----------------------|
| P1 | Fear and friction in reporting integrity concerns | Confidential reporting | A-LEG-02, A-ORG-01 |
| P2 | Case delays, backlogs, and lack of case visibility | Adjudication | A-JUS-02, A-JUS-05 |
| P3 | Evidence integrity & chain-of-custody weaknesses | Investigation/Adjudication | A-LEG-05, A-JUS-07 |
| P4 | Inter-agency fragmentation & duplicated effort | All | A-JUS-01, A-JUS-02 |
| P5 | Access-to-justice barriers (cost, distance, language, literacy, disability) | Citizen-facing | A-TEC-01/02, A-ORG-03, A-JUS-06 |
| P6 | Transparency & accountability deficits | Public transparency | A-JUS-04/08, A-LEG-06 |
| P7 | Integrity/corruption risk within the sector | All | A-ORG-01, A-GOV-01 |
| P8 | Records management & institutional memory loss | All | A-JUS-02/07 |
| P9 | Procedural-fairness & due-process gaps | Adjudication | A-JUS-03/04 |
| P10 | Weak data for policy & institutional learning | Oversight/policy | A-JUS-08 |

---

## 2.2 Problem trees

### P1 — Fear and friction in reporting integrity concerns
- **Symptom:** Citizens, victims, witnesses, and insiders who observe corruption or
  misconduct often do not report it.
- **Root causes:** fear of retaliation (especially when the subject holds state power —
  Threat actor TA-1); no trusted, safe channel; uncertainty about whistleblower protection
  (A-LEG-02 `⟦validate⟧`); distrust that reports lead to action (the "black hole"); literacy/
  language/access barriers; social/cultural pressure against reporting kin or authority.
- **Systemic impact:** corruption persists unchecked; public trust erodes; honest officials
  are undermined; a small number of visible retaliations chill an entire population.
- **Affected:** citizens, victims, witnesses, honest insiders, ultimately the whole public.
- **Platform can:** provide a metadata-resistant, operator-in-threat-model confidential
  channel; provide honest risk communication; provide non-attributable responsiveness
  metrics so it is not a black hole.
- **Platform cannot:** protect against device compromise, content-based self-identification,
  physical coercion, or a subject who already knows who could have reported (see `08-* §2.8`).

### P2 — Case delays, backlogs, and lack of case visibility
- **Symptom:** cases take a long time; litigants (and often their lawyers) struggle to find
  out what stage their matter is at, when the next hearing is, or why a delay occurred.
  `⟦validate⟧` extent/severity in Botswana.
- **Root causes:** manual/paper workflows and re-keying across agencies (A-JUS-02); scheduling
  conflicts and adjournments with no shared calendar; fragmented records across police→DPP→
  courts; limited registry capacity; no single source of truth for case status.
- **Systemic impact:** justice delayed; remand populations swell; witnesses become
  unavailable; costs rise; confidence falls; the delay itself becomes a corruption vector
  (delay-for-favor).
- **Affected:** litigants, accused (esp. on remand), victims, witnesses, lawyers, courts,
  prisons.
- **Platform can:** a shared case-status model with role-appropriate visibility; shared
  scheduling; automated status notifications; bottleneck analytics for oversight.
- **Platform cannot:** create judicial/registry capacity, compel timeliness, or override
  judicial discretion; it exposes and measures delay, it does not by itself remove it.

### P3 — Evidence integrity & chain-of-custody weaknesses
- **Symptom:** doubts about whether evidence was altered, lost, mishandled, or fabricated;
  disputes over authenticity; digital evidence hard to admit. `⟦validate⟧`
- **Root causes:** paper custody logs; no tamper-evidence; unclear custody handoffs across
  agencies; no cryptographic integrity or trusted timestamping; admissibility uncertainty
  (A-LEG-05).
- **Systemic impact:** guilty acquitted / innocent convicted on integrity grounds; appeals;
  loss of confidence in verdicts; opportunity for evidence tampering as a corruption vector.
- **Affected:** accused, victims, prosecutors, defenders, courts, investigators.
- **Platform can:** cryptographic hashing, trusted timestamping, append-only custody ledger,
  access-audited storage, integrity verification on every access (STRIDE T-1/T-2).
- **Platform cannot:** guarantee that what was submitted is itself authentic/complete
  (garbage-in), or prevent off-platform evidence handling.

### P4 — Inter-agency fragmentation & duplicated effort
- **Symptom:** police, DPP, courts, prisons, and oversight each hold partial, inconsistent
  copies of the same matter; citizens repeat their story to each; handoffs drop information.
- **Root causes:** siloed systems and mandates (A-JUS-01); no shared, permissioned data
  contracts; separation-of-powers concerns (rightly) blocking naïve data pooling (A-JUS-03);
  no event-driven notification between agencies.
- **Systemic impact:** delay, error, re-victimization, gaps that corruption exploits, no
  system-wide picture for policy.
- **Affected:** every actor, especially citizens who fall through the cracks.
- **Platform can:** an **event-driven, permissioned integration layer** where each arm owns
  its data and publishes minimal, purpose-bound events others may subscribe to under lawful
  access — *not* a central pool.
- **Platform cannot:** dissolve legitimate separation-of-powers boundaries; over-integration
  is itself a risk (P7, and I-* threats).

### P5 — Access-to-justice barriers
- **Symptom:** justice is hard to reach for the poor, rural, low-literacy,
  non-English-speaking, disabled, and digitally-excluded. `⟦validate⟧` specifics.
- **Root causes:** cost and distance to courts; English-dominant formal system vs Setswana-
  and minority-language speakers; low digital literacy (A-ORG-03); connectivity/data cost
  (A-TEC-02); disability-inaccessible processes; complexity of legal procedure; the dual
  formal/customary system (A-JUS-06) is not digitally bridged.
- **Systemic impact:** unequal justice; exclusion; reliance on informal/unaccountable
  resolution; erosion of legitimacy.
- **Affected:** rural and low-income citizens, women, persons with disabilities, minority-
  language speakers, the digitally excluded.
- **Platform can:** multi-channel access (smartphone/PWA and, per checkpoint, USSD/SMS/voice),
  Setswana + English by default, plain-language and iconographic UX, offline drafting,
  accessibility to WCAG, information about both formal and customary pathways.
- **Platform cannot:** replace legal representation, remove all cost/distance, or digitize
  people who have no access at all — assisted/intermediated access will remain necessary.

### P6 — Transparency & accountability deficits
- **Symptom:** limited public visibility into aggregate justice-sector performance, integrity
  outcomes, and how the system treats people; low ability to hold institutions accountable.
- **Root causes:** no published, verified, aggregated metrics; fear that transparency breaches
  confidentiality/sub judice (A-JUS-04/08); no trusted, non-attributable data pipeline.
- **Systemic impact:** unaccountable performance; rumor fills the vacuum; reform lacks an
  evidence base; trust declines.
- **Affected:** the public, civil society, journalists, policymakers, honest institutions.
- **Platform can:** a public Transparency Dashboard of **verified, aggregated, anonymized,
  non-attributable** statistics and trends, with automatic respect for open-justice
  exceptions (A-JUS-04).
- **Platform cannot:** publish individually identifying allegations; transparency ≠ public
  accusation (a hard rule).

### P7 — Integrity/corruption risk *within* the sector
- **Symptom:** the actors meant to deliver justice can themselves be compromised (bribery,
  interference, selective enforcement, evidence tampering, case-fixing). `⟦validate⟧`
- **Root causes:** discretion without audit; weak segregation of duties; single points of
  control over cases/evidence; insufficient oversight; the operator/insider threat (TA-2).
- **Systemic impact:** the deepest harm — it corrupts the remedy itself and is self-
  concealing.
- **Affected:** everyone, and the platform itself (which must assume its own operators can be
  compromised).
- **Platform can:** least privilege, segregation of duties, dual control, tamper-evident
  audit, anomaly detection, independent oversight tooling, operator-in-threat-model design.
- **Platform cannot:** eliminate corruption; it raises the cost, narrows opportunity, and
  improves detectability. Over-claiming here would be dishonest.

### P8 — Records management & institutional memory loss
- **Symptom:** lost files, unfindable precedents, inconsistent records, no reliable archive.
  `⟦validate⟧`
- **Root causes:** paper/hybrid records; no digital archive with retention and integrity; staff
  turnover; disaster exposure (fire/flood/loss).
- **Systemic impact:** cases collapse for want of records; inconsistent decisions; no learning.
- **Affected:** courts, registries, litigants, researchers, policymakers.
- **Platform can:** a secure, integrity-protected **Digital Archive** with governed retention,
  DR, and search (respecting sealing/redaction).
- **Platform cannot:** recover records that were never captured; migration of legacy paper is
  a large, separate effort.

### P9 — Procedural-fairness & due-process gaps
- **Symptom:** parties unclear on their rights, next steps, or reasons; unequal ability to
  participate; the accused's/defence's information disadvantage. `⟦validate⟧`
- **Root causes:** complexity; information asymmetry; no structured guidance; representation
  gaps (public-defence capacity).
- **Systemic impact:** unfair or unfairly-perceived outcomes; appeals; loss of legitimacy.
- **Affected:** accused, victims, unrepresented litigants, defenders.
- **Platform can:** transparent case state machines, rights/next-step guidance, notifications,
  a public-defender workspace, appeals workflow, explainable process (never automated
  judgment).
- **Platform cannot:** provide legal advice, guarantee representation, or substitute for
  judicial reasoning.

### P10 — Weak data for policy & institutional learning
- **Symptom:** reforms and resourcing decisions lack reliable system-wide data.
- **Root causes:** fragmented data (P4); no analytics layer; privacy/legal caution blocking
  data use; no feedback loop from outcomes to policy.
- **Systemic impact:** decisions by anecdote; misallocation; repeated mistakes.
- **Affected:** policymakers, oversight, institutions, ultimately citizens.
- **Platform can:** a privacy-preserving Analytics Platform producing aggregate insight for
  oversight/policy, with strict purpose limitation (LINDDUN DD-2).
- **Platform cannot:** make political will exist; data informs policy, it does not enact it.

---

## 2.3 Root-cause clustering (where to intervene)

Most problems above trace to a small number of **leverage points**:

1. **No trusted, safe, accountable channels** (P1, P6, P7) → confidential reporting + oversight + transparency.
2. **Fragmentation and no shared source of truth** (P2, P4, P8, P10) → event-driven, permissioned integration + case model + archive + analytics.
3. **Integrity not provable** (P3, P7) → cryptographic evidence integrity + tamper-evident audit + least privilege.
4. **Exclusion** (P5, P9) → multi-channel, multilingual, accessible, guided UX honoring formal *and* customary justice.

Designing for these four leverage points (rather than 22 disconnected features) is the
systems-thinking spine of the whole blueprint.

## 2.4 What is explicitly out of scope for the platform to "solve"

To avoid over-promising (honesty constraint): the platform **does not** adjudicate, does not
decide guilt, does not replace institutions or legal representation, does not remove judicial
discretion, does not guarantee outcomes, and does not fix underlying resourcing or political
constraints. It **enables** transparency, integrity, accountability, and access; the human
institutions remain responsible for justice itself.

## 2.5 Definition-of-Done

- [x] Each systemic problem given root-cause, impact, affected parties, and honest can/cannot.
- [x] Botswana-specific claims tagged `⟦validate⟧`; no invented stakeholder opinions.
- [x] Root causes clustered into leverage points that justify later architecture.
- [x] Explicit out-of-scope statement to prevent over-claiming.
- **Required specialist review:** justice-sector policy experts, judicial officers,
  criminologists, Botswana legal advisors, access-to-justice/CSO practitioners; **all
  `⟦validate⟧` items require primary research/stakeholder engagement before design relies on
  them.**

*Next: `03-stakeholder-analysis.md`.*
