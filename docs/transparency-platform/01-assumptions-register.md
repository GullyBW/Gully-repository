# 01 — Assumptions Register

> **⚑ Checkpoint update (2026-07-07).** Several high-impact assumptions have been **ratified as
> architectural decisions** at the Confirmation Checkpoint — see `12-ratified-decisions.md §12.2`.
> Notably: A-ORG-01/A-GOV-01 (independent operator + oversight) → **Decided (D-01)**; A-JUS-01/03
> (separation of powers) → **adopted as architecture (D-06)**; A-JUS-02 (integrate not replace) →
> **confirmed (D-07)**; A-AI-01 (AI assistive-only) → **hard constraint (D-09)**. Ratification
> fixes the *direction*; it does **not** discharge the requirement for qualified legal/judicial/
> governance validation before deployment.

> **Why this comes first.** Every architectural, cryptographic, and governance decision in
> the later batches rests on assumptions about Botswana's law, infrastructure,
> institutions, funding, and threat environment. If an assumption is wrong, the decisions
> that depend on it must be revisited. This register makes those assumptions explicit and
> testable so they can be validated *before* we commit to architecture. Assumptions marked
> **⚑ high-impact** are surfaced again at the Confirmation Checkpoint (`03-*`).

**Legend**
- **Confidence:** How sure we are the assumption holds today. High / Medium / Low.
- **Impact if wrong:** Architectural/operational blast radius if the assumption fails.
- **Validation:** Who must confirm it and how, before we build on it.

Every assumption below is a *hypothesis to be tested*, not an established fact. Legal
assumptions in particular are **placeholders pending confirmation by an admitted Botswana
attorney** — they reflect publicly known statutes but not their current interpretation,
amendments, or enforcement practice.

---

## 1. Legal & Regulatory Assumptions

| ID | Assumption | Confidence | Impact if wrong | Validation |
|----|-----------|-----------|-----------------|-----------|
| **A-LEG-01** ⚑ | Botswana's **Data Protection Act, 2018** (and its operative regulations / Commissioner's office) governs processing of personal data on the platform, and the platform can be architected to comply as a data controller/processor. | Medium | Whole compliance section and lawful basis for processing must be re-derived; data-residency and DSAR handling change. | Botswana legal counsel + Data Protection Commissioner engagement. |
| **A-LEG-02** ⚑ | The **Whistleblowing Act, 2016** provides legal protection to persons who make disclosures in good faith, and those protections can extend to (or at least do not criminalize) anonymous/pseudonymous disclosures made through a non-governmental channel. | Low–Medium | If protections require disclosure to a *prescribed* authority or require the whistleblower's identity, the anonymity model and the routing of reports to recipients must change. This is a **load-bearing** legal question. | Botswana legal counsel; statutory review of "prescribed persons/authorities." |
| **A-LEG-03** | The **Corruption and Economic Crime Act** and the mandate of the **Directorate on Corruption and Economic Crime (DCEC)** make the DCEC (and/or the Directorate of Public Prosecutions, Ombudsman, Judicial Service Commission) an appropriate authorized recipient for justice-sector integrity reports. | Medium | The set of "authorized recipients" and the routing/governance model changes; may require multiple independent recipients to avoid conflict of interest (reporting police to police). | Legal counsel + institutional MoUs. |
| **A-LEG-04** ⚑ | Botswana law (e.g., **Criminal Procedure and Evidence Act**, **Cybercrime and Computer Related Crimes Act, 2018**, interception/assistance provisions, BOCRA licensing) permits **lawful compelled disclosure / interception** that could target the platform, its operator, its hosting provider, or telecoms carriers. | High | This is assumed **true** and is a central threat driver, not a risk to the design — but the *scope* and *process* (warrant thresholds, gag provisions) determine how much the operator-in-threat-model controls must do. | Legal counsel; map the compelled-access regime precisely. |
| **A-LEG-05** | Digital evidence (hashes, timestamps, chain-of-custody records) produced by the platform can be made **admissible** in Botswana proceedings if collected and preserved per recognized standards (electronic records/evidence provisions). | Medium | Evidence Management design and chain-of-custody formalism must adapt to whatever admissibility rules actually apply; may require notarization/independent timestamping. | Legal counsel + digital forensics expert. |
| **A-LEG-06** | Publishing **aggregated, anonymized, non-attributable** statistics and trend analyses does not, by itself, constitute defamation, contempt, or a breach of sub judice rules under Botswana law. | Medium | The public Transparency Dashboard scope shrinks; publication may require legal sign-off per release. | Legal counsel (defamation + contempt). |
| **A-LEG-07** | The platform can lawfully operate as an **independent non-governmental** entity (trust/NGO/PBO) receiving and routing reports, rather than being compelled to sit inside a government department. | Medium | If a government host is legally mandated, the entire operator-in-threat-model and trust architecture must be rebuilt around that constraint. | Legal counsel + institutional negotiation. |
| **A-LEG-08** | Cross-border transfer/processing of platform data (e.g., hosting in South Africa or the EU) is **permissible** under the Data Protection Act subject to adequacy/safeguards. | Low–Medium | Deployment-model comparison (in-country vs offshore vs hybrid) is directly constrained; may force in-country residency for some data classes. | Legal counsel; adequacy analysis. |

## 2. Technical & Infrastructure Assumptions

| ID | Assumption | Confidence | Impact if wrong | Validation |
|----|-----------|-----------|-----------------|-----------|
| **A-TEC-01** | Mobile-phone penetration in Botswana is high; **smartphone** penetration is moderate and growing but **not universal**, and **feature phones** remain in use, especially in rural areas and among lower-income and older citizens. | High | If smartphone penetration is lower than assumed, USSD/SMS and voice intake channels become mandatory in the MVP, not future work — changing scope and threat surface. | Telecom/market data (Statistics Botswana, BOCRA reports). |
| **A-TEC-02** ⚑ | **Connectivity is variable and often expensive**; rural coverage is predominantly 3G/2G with intermittent data; urban areas have 4G and growing 5G. Data cost is a real barrier to use. | High | Offline drafting, low-bandwidth clients, and payload minimization move from "nice to have" to core requirements; affects UX and evidence-upload design. | BOCRA coverage/pricing data; field testing. |
| **A-TEC-03** ⚑ | There is **no hyperscale cloud region physically inside Botswana**; the nearest low-latency hyperscale regions (AWS/Azure/GCP) are in **South Africa**. In-country hosting means local data centres / colocation with more limited managed services. | High | Deployment-model comparison and DR strategy hinge on this; "in-country + hyperscale" is not currently an option, forcing a trade between residency and managed-service maturity. | Confirm current provider footprints and local DC capabilities. |
| **A-TEC-04** | The **Tor network / anonymizing overlays are reachable** from Botswana (not nationally blocked today), enabling an onion-service or equivalent metadata-resistant intake channel. | Medium | If Tor is blocked or blocking is plausible, the anonymous-transport design must include pluggable transports/bridges/domain-fronting alternatives, raising complexity. | Network measurement (OONI data) + ongoing monitoring. |
| **A-TEC-05** | Citizens' devices are **substantially outside the platform's control** and a meaningful fraction may be compromised, shared, second-hand, or subject to seizure. | High | Confirms device-compromise as an accepted residual risk, not a solvable one; drives panic mode, ephemerality, and "no false confidence" UX. | Threat intel; accepted as design premise. |
| **A-TEC-06** | Reliable, independent **time sources** and a trustworthy timestamping authority (RFC 3161 or transparency-log style) can be provisioned for evidence integrity. | Medium | Evidence timestamping may need an external/anchored source (e.g., public transparency log) if no trusted local TSA exists. | Cryptography engineer + forensics. |

## 3. Governance & Institutional Assumptions

| ID | Assumption | Confidence | Impact if wrong | Validation |
|----|-----------|-----------|-----------------|-----------|
| **A-GOV-01** ⚑ | An **independent, multi-stakeholder oversight body** (drawing from judiciary-adjacent bodies, Law Society of Botswana, civil society, academia, faith/community leaders, and independent security experts) can be constituted, resourced, and sustained with genuine independence from the institutions being reported on. | Low–Medium | The operator-in-threat-model controls that rely on *split trust* (no single operator can de-anonymize) become unenforceable; the whole trust architecture weakens to "trust us." **This is the single most important governance assumption.** | Stakeholder mapping + founding-charter negotiation. |
| **A-GOV-02** | There is sufficient, durable **political tolerance** for an independent integrity-reporting platform that its operation will not be legislated, litigated, or funded out of existence in its first years. | Low | Sustainability and hosting-jurisdiction decisions must hedge against hostile-state action (offshore fallback, mirrored governance). | Political-economy analysis; stakeholder engagement. |
| **A-GOV-03** | **Conflict-of-interest** can be managed: individuals connected to the justice institutions under scrutiny can be excluded from case-affecting roles without leaving the governance body unstaffable. | Medium | Governance staffing model and recusal rules change; may need regional/diaspora members. | Governance design + recruitment. |
| **A-GOV-04** | Authorized recipient institutions will **act on** routed reports and accept an **independent audit** of their responsiveness (transparency reporting on intake→action latency). | Low–Medium | The platform risks becoming a "black hole" that erodes trust; may need SLAs, escalation to Ombudsman/Parliament, and public non-attributable responsiveness metrics. | Institutional MoUs. |

## 4. Operational Assumptions

| ID | Assumption | Confidence | Impact if wrong | Validation |
|----|-----------|-----------|-----------------|-----------|
| **A-OPS-01** ⚑ | **Local cybersecurity, cryptography, and DevSecOps expertise is scarce**; some specialist functions (24/7 SOC, cryptographic review, incident response) will need regional/remote sourcing or managed services. | High | Staffing plan, cost model, and — critically — the *trust boundary* widen to include remote/outsourced operators, who must therefore also be inside the operator-in-threat-model controls. | Local market scan; recruitment/partner strategy. |
| **A-OPS-02** | The operator can sustain **24/7** monitoring and incident response (directly or via a vetted managed partner) from launch. | Medium | If not, the platform must degrade gracefully and set honest availability/response expectations; affects NFRs and SLAs. | Ops staffing/partner plan. |
| **A-OPS-03** | Reports will be predominantly in **English and Setswana**, with a long tail of other languages; human reviewers fluent in both are available. | High | Localization scope, AI-translation reliance, and reviewer staffing change. | Linguistic/staffing review. |
| **A-OPS-04** | Report **volume at launch is low-to-moderate** (pilot scale) but must be architected to scale nationally, including **abuse/flooding** scenarios. | Medium | Capacity, rate-limiting, triage automation, and cost projections change. | Pilot metrics. |

## 5. Financial Assumptions

| ID | Assumption | Confidence | Impact if wrong | Validation |
|----|-----------|-----------|-----------------|-----------|
| **A-FIN-01** ⚑ | **Initial funding** is available from development partners / donors / philanthropic sources for build and first years of operation; the platform is **not** required to be self-funding at launch. | Medium | If self-funding is required, scope shrinks drastically and independence is at risk (a platform funded by those it scrutinizes cannot claim independence). | Funding strategy + committed sources. |
| **A-FIN-02** ⚑ | **Long-term sustainability** funding is uncertain; the design must minimize recurring cost and avoid vendor lock-in that would strand the platform if a funder exits. | High | Drives technology choices toward open standards, portability, and low idle-cost architectures. | Sustainability plan. |
| **A-FIN-03** | **BWP/USD foreign-exchange volatility** materially affects the cost of offshore hosting, foreign specialists, and licensed tooling priced in USD/EUR. | High | Budgets must carry FX contingency; favors cost predictability and, where possible, BWP-denominated/in-region spend. | Finance review; FX hedging policy. |
| **A-FIN-04** | Botswana **telecommunications/data costs** are a non-trivial line item both for operations and (indirectly) for citizens' ability to use the platform; zero-rating or subsidised access may be negotiable but is not guaranteed. | Medium | Affects both cost model and adoption; zero-rating has its own privacy trade-offs (carrier can see who uses the service). ⚠️ COST noted for later. | BOCRA/carrier engagement. |

## 6. Organizational & Product Assumptions

| ID | Assumption | Confidence | Impact if wrong | Validation |
|----|-----------|-----------|-----------------|-----------|
| **A-ORG-01** ⚑ | The platform will be **operated by an independent entity** (proposed: an Independent Oversight Trust) rather than by any institution subject to reporting — this is the premise that makes "operator-in-threat-model" tractable. | Medium | If a subject institution operates it, no technical control fully restores reporter trust; the design would have to lean far harder on split-key/threshold cryptography and third-party escrow, at high cost and complexity. | Governance/legal decision. |
| **A-ORG-02** | The **first release scope** is confidential reporting on the justice sector (police, courts, prosecutors, judicial officers, prison services, government investigators, public officials, regulatory bodies); other domains are explicitly future work. | High | Scope creep risk; requirements and threat model are sized to this scope. | Product/sponsor sign-off. |
| **A-ORG-03** | Citizens' **digital literacy varies widely**; a meaningful segment has low literacy and low familiarity with apps, requiring plain-language, iconographic, and possibly assisted/voice intake. | High | UX strategy and accessibility requirements expand; affects fraud/quality trade-offs. | UX research with target users. |
| **A-ORG-04** | The **public brand/name** and launch communications will be designed with legal and comms advisors; the working name "BNTIP" is a placeholder and the platform's public identity is not fixed by this blueprint. | High | None architecturally; flagged to avoid premature branding. | Comms/legal. |
| **A-ORG-05** | The platform's purpose is **lawful confidential reporting**, not public accusation; users, media, and institutions will be clearly and repeatedly informed of this boundary. | High | If misused as a public-accusation channel, defamation/contempt exposure and reporter-safety harms rise sharply; drives strict separation of reporting and disclosure. | Product + legal + comms. |

---

## 6b. Justice-Institutional Assumptions (ecosystem scope)

> Added when scope expanded from confidential reporting to the full National Justice
> Transparency & Integrity Platform. These concern Botswana's justice institutions,
> separation of powers, and the state of existing systems. **All A-JUS-* items are
> hypotheses requiring validation with the named institutions and Botswana legal/judicial
> advisors — none is asserted as established fact.**

| ID | Assumption | Confidence | Impact if wrong | Validation |
|----|-----------|-----------|-----------------|-----------|
| **A-JUS-01** ⚑ | Botswana's justice sector comprises distinct arms under **separation of powers**: the **Judiciary** (Magistrates' Courts, High Court, Court of Appeal, and **Customary Courts / dikgotla**), the **executive** law-enforcement/investigation bodies (**Botswana Police Service**, **DCEC**, **DIS**, **Botswana Prison/Rehabilitation Service**), the **Directorate of Public Prosecutions (DPP)**, and independent oversight (**Ombudsman**, judicial oversight, **Law Society of Botswana**). Each arm's data must be owned by that arm, not silently shared. | Medium | The trust model and data-ownership architecture are directly derived from this; if the institutional map is materially different, §09 Trust Model and access design must be reworked. | Botswana legal/judicial advisors; institutional confirmation. |
| **A-JUS-02** ⚑ | The platform must **interoperate with, not blindly replace,** whatever case-management, records, and evidence systems these institutions already operate (which may range from paper-based to partial digital). NJTIP is an integration/transparency/integrity layer plus new capabilities, not a rip-and-replace of court IT. | Low–Medium | If institutions expect full replacement, scope, cost, and risk balloon; if they forbid integration, the value proposition shrinks to citizen-facing modes only. | Institutional systems audit; MoUs. |
| **A-JUS-03** ⚑ | **Judicial independence** requires that adjudication data and workflows are controlled by the Judiciary and are **not** accessible to the executive (police/DCEC/DIS) or to the platform operator, except through lawful, audited, case-appropriate channels. | Medium | Central to legitimacy; violating it would make the platform constitutionally and politically untenable. Drives strict inter-arm trust boundaries. | Judicial advisors; constitutional review. |
| **A-JUS-04** | **Open-justice** principles apply to court proceedings (hearings/judgments generally public) subject to statutory exceptions (juveniles, sexual offences, protected witnesses, national security, sealed matters). Public transparency outputs must respect these exceptions automatically. | Medium | The public Transparency Dashboard's publication rules and redaction logic depend on this; wrong = unlawful disclosure or over-suppression. | Legal counsel; court rules review. |
| **A-JUS-05** ⚑ | Institutions will **participate**: authorized recipients act on routed reports; courts/prosecutors/defenders will adopt workspaces; oversight bodies will use oversight tooling. Adoption is voluntary-to-mandated and not guaranteed. | Low | Without participation the platform becomes citizen-facing theater; drives a phased, incentive-aware rollout and honest success metrics. | Change-management strategy; institutional buy-in. |
| **A-JUS-06** | A **dual legal system** operates: received/common law courts **and** customary law administered through dikgotla under traditional leaders (Kgosis). Many citizens first encounter justice at the customary level. | Medium–High | Accessibility, language, domain model, and case taxonomy must accommodate customary justice, not just formal courts; omitting it excludes much of the population. | Cultural/legal advisors; Kgosi engagement. |
| **A-JUS-07** | Digital **evidence and records produced by the platform** can be integrated into existing court records/registries in a legally recognized form (chain of custody, admissibility per A-LEG-05). | Low–Medium | Evidence Management and archive integration must adapt to registry rules; may require registrar-controlled interfaces. | Registrars; digital forensics; legal. |
| **A-JUS-08** | The Judiciary/DPP/police have or can obtain **authority and mandate** to place case metadata into a shared transparency layer without breaching statutory confidentiality, sub judice, or witness-protection rules. | Low | Determines how much case-visibility (Mode 3/4) is lawful; wrong = severe legal exposure. | Legal counsel; statutory review. |

## 6c. AI-Specific Assumptions

| ID | Assumption | Confidence | Impact if wrong | Validation |
|----|-----------|-----------|-----------------|-----------|
| **A-AI-01** | AI is used **only** for assistive tasks (translation EN↔Setswana and other languages, categorization, duplicate detection, PII detection/redaction suggestion, summarization, workflow prioritization) and **never** for legal determinations, guilt/innocence, or replacing a human decision. | High | If AI is expected to adjudicate or score guilt, the design is rejected on rights/fairness grounds; this is a hard constraint, not a preference. | Governance/ethics review. |
| **A-AI-02** | AI outputs affecting people are **explainable, auditable, human-reviewed, and contestable**; models can be run in a privacy-preserving manner (no sensitive data sent to third-party endpoints that could retain or leak it). | Medium | Drives model hosting (self-hosted/on-prem for sensitive paths), audit logging of AI use, and appeal rights. ⚠️ COST: self-hosting models is more expensive than API calls. 🔒 | AI systems + privacy review. |
| **A-AI-03** | Setswana (and minority-language) NLP quality is **imperfect**; translation/redaction will make errors and must be treated as advisory, with human verification for anything consequential. | Medium–High | Prevents over-reliance; drives human-in-the-loop and error-handling design. | Linguistic evaluation. |

## 7. Assumption dependency notes (what breaks what)

- If **A-GOV-01** (genuine independent oversight) or **A-ORG-01** (independent operator)
  fails, the **operator-in-threat-model** guarantee cannot be met by technical means
  alone. Everything in the Trust Architecture and Governance batches is downstream of
  these two.
- If **A-LEG-02** (whistleblower protection reaches anonymous NGO-channel disclosures)
  fails, the **routing model and the value proposition to reporters** change — a report
  might expose the reporter to legal jeopardy rather than protect them.
- If **A-TEC-03** (no in-country hyperscale) plus **A-LEG-08** (cross-border transfer
  allowed) resolve in tension, the **deployment-model comparison** is where that tension
  is adjudicated (Batch 2/3).
- If **A-FIN-01/02** (funding) fail, **independence** fails, because the cheapest funder
  is often the institution being scrutinized.
- If **A-JUS-01/03** (separation of powers, judicial independence) is mis-mapped, the whole
  **Trust Model (§09)** and inter-arm data-ownership design are wrong. These are the
  ecosystem-scope equivalents of A-ORG-01/A-GOV-01.
- If **A-JUS-02** (integrate, not replace) is wrong in either direction, **System
  Architecture scope, cost, and delivery risk** change by an order of magnitude.
- If **A-JUS-05** (institutional participation) fails, Modes 2–4 (investigation,
  adjudication, transparency) cannot function; only Mode 1 (citizen reporting) survives, and
  even it becomes a "black hole" (R-1).
- If **A-AI-01** (AI assistive-only) is not accepted, the design is rejected outright on
  rights/fairness grounds.

## 8. Definition-of-Done for this section

- [x] Assumptions documented across all categories (legal, technical, governance,
  operational, financial, organizational, **justice-institutional, AI**).
- [x] Each assumption carries confidence, impact-if-wrong, and a validation owner.
- [x] High-impact assumptions (⚑) are flagged for the Confirmation Checkpoint.
- [x] Dependency notes identify which assumptions are load-bearing for later phases.
- **Required specialist review:** Botswana legal counsel (all A-LEG-*, A-JUS-04/07/08),
  judicial/constitutional advisor (A-JUS-01/03), institutional-systems analyst (A-JUS-02/05),
  cultural/customary-law advisor (A-JUS-06), governance/political-economy advisor (A-GOV-*),
  telecom/infrastructure analyst (A-TEC-*), finance/FX (A-FIN-*), AI/privacy (A-AI-*).

*Next: `02-threat-model-stride-linddun.md`.*
