# 03 — Threat Model Validation → ⛔ Confirmation Checkpoint

> **Per the design mandate (Part C §3), the blueprint stops here.** Everything downstream —
> Governance, Trust Architecture, Security Architecture, System Architecture, and the
> roadmap — is *contingent* on the foundations in this batch. This document (a) summarizes
> the completed threat model, (b) names the highest-priority risks, (c) surfaces the
> assumptions with the greatest architectural impact, and (d) asks you the specific
> questions we must resolve before Batch 2.

---

## 3.1 What has been established so far

- **Assumptions Register** (`01-*`): 30 assumptions across legal, technical, governance,
  operational, financial, and organizational categories, each with confidence, impact-if-
  wrong, and a validation owner. Nine are flagged **⚑ high-impact**.
- **Threat Model** (`02-*`): 10 ranked assets, 9 threat-actor classes, explicit trust
  assumptions, and a formal STRIDE (23 threats) + LINDDUN (13 threats) catalogue with risk
  ratings, mitigations, residual risk, and architectural implications — plus an honest
  residual-risk statement of what no design can fully prevent.

## 3.2 The highest-priority risks (Critical band, L×I ≥ 20)

These eight drive the architecture. If the design does not credibly address these, nothing
else matters.

| ID | Threat | Why it's the top tier |
|----|--------|----------------------|
| **I-1** | Compelled disclosure of stored data from operator/host | A lawful, gagged order is the *most likely* high-impact attack, because TA-1 holds state power. Defended only by minimization + threshold key custody, and **cannot be reduced to zero**. |
| **I-2** | Metadata leakage → de-anonymization despite encryption | Encryption of content is the *easy* part; metadata is how real whistleblowers get caught. Pervasive, cross-layer. |
| **L-1** | Linking multiple reports/actions to one anonymous reporter | Unlinkability is harder than encryption and is where most designs quietly fail. |
| **ID-1** | Directly identifying the reporter from stored/transited data | Answered primarily by *not collecting identity at all* — a design premise, not a feature. |
| **ID-2 / DT-1** | Carrier/network detecting that a citizen contacts/uses the platform | In some threat models, *mere usage* is the harm; transport anonymity mitigates but cannot eliminate. Zero-rating would make it worse. |
| **S-1** | Fake/phishing intake service harvesting reports at the source | Bypasses all backend controls by attacking authenticity; a UX+crypto problem. |
| **E-1** | Insider/attacker escalates to identity-linkable data or keys | The technical expression of "operator-in-threat-model"; requires that de-anonymization need *collusion*, not a single actor. |
| **U-1** | Reporters gain false confidence from unclear risk communication | Ethically the most dangerous: the platform harms someone by over-promising. Honesty in the UX is itself a Critical safety control. |

**Reading of the model:** the dominant adversary is a **state-empowered subject of a report
(TA-1) acting through lawful compulsion (I-1) and network metadata (I-2/ID-2/DT-1), and/or
through a compromised insider/operator (E-1).** The platform's defensibility rests on three
pillars: **(1) collect almost nothing that identifies**, **(2) split what little trust
remains so no single party — including the operator — can de-anonymize**, and **(3) tell
reporters the honest truth about residual risk.** These pillars must be ratified now because
they constrain every later choice (hosting jurisdiction, key custody, transport, UX copy,
governance composition).

## 3.3 The assumptions with the greatest architectural impact

If any of these resolves differently than assumed, Batch 2+ changes materially:

| ID | Assumption (short) | If it fails… |
|----|--------------------|--------------|
| **A-ORG-01 / A-GOV-01** | Independent operator + genuinely independent oversight body | The operator-in-threat-model guarantee collapses to "trust us"; split-trust controls become theater. **Most consequential of all.** |
| **A-LEG-02** | Whistleblower protection reaches anonymous NGO-channel disclosures | Filing a report could expose the reporter to legal jeopardy rather than protect them; the value proposition inverts. |
| **A-LEG-04 / A-LEG-08** | Lawful compelled-access regime + cross-border transfer rules | Directly sets the hosting-jurisdiction and data-residency strategy (in-country vs offshore vs hybrid). |
| **A-TEC-03** | No in-country hyperscale cloud | Forces a trade between data residency and managed-service maturity in the deployment-model decision. |
| **A-TEC-02 / A-TEC-01** | Variable, costly connectivity; smartphones not universal | Determines whether USSD/SMS/voice intake and offline drafting are MVP-mandatory or future work. |
| **A-FIN-01 / A-FIN-02** | Donor funding now; sustainability uncertain | Independence and technology-portability choices depend on this. |

## 3.4 Key tensions we will have to adjudicate downstream (named now, not hidden)

1. **Anonymity vs. lawful compliance (I-1 vs NC-1/NC-2).** The strongest anonymity design
   makes the operator *unable* to comply with an order to identify a reporter. That is a
   feature for safety and a legal question for counsel. We resolve for anonymity and flag
   the legal exposure. ⚠️
2. **Data residency vs. operational maturity (A-TEC-03 vs A-LEG-08).** In-country hosting
   maximizes legal-residency alignment but reduces managed-service maturity and DR options;
   offshore does the reverse and adds a foreign compelled-access surface.
3. **Availability tooling vs. metadata exposure (D-1 vs I-2).** CDNs/DDoS scrubbing see
   traffic; using them can undercut metadata resistance unless carefully configured. ⚠️
4. **Anti-abuse vs. anonymity (S-4/D-3 vs L-1/ID-1).** Conventional anti-abuse (CAPTCHAs,
   device fingerprinting, phone verification) de-anonymizes; we must use privacy-preserving
   alternatives at higher cost. ⚠️
5. **Evidence retention vs. data minimization (A3/T-1 vs DD-1).** Evidence integrity wants
   durable retention; anonymity wants aggressive deletion. Adjudicated in Evidence
   Management (Batch 3).
6. **Usability/reach vs. detection resistance (A-TEC-01/02 vs DT-1/ID-2).** The easiest-to-
   reach channels (SMS/USSD, zero-rated data) are the *least* metadata-safe. ⚠️

## 3.5 Scope and honesty reaffirmed

- **First release scope** is the justice sector (A-ORG-02). Confirm or adjust.
- The platform **routes confidential reports to authorized recipients** and **does not
  publish individually identifying allegations** (Part C §6). Public output = verified,
  aggregated, anonymized statistics only.
- We will **not** give high-risk reporters false confidence. The residual risks in `02-* §2.8`
  (device compromise, content-based ID, coercion, global passive adversary, successful
  compulsion, governance capture, usage detection) are the honest boundary of what the
  platform can do.

---

## 3.6 ⛔ CONFIRMATION CHECKPOINT — decisions requested of you

**Please confirm or correct the following before we proceed to Batch 2 (Governance & Trust).
Your answers are load-bearing; changing them later means reworking downstream sections.**

**Q1 — Operator & oversight model (A-ORG-01 / A-GOV-01).**
Do you confirm the platform should be built around an **independent operator + genuinely
independent, multi-stakeholder oversight body**, with the operator explicitly inside the
threat model? Or is a government-hosted / single-institution model a hard requirement we
must design within (which materially weakens achievable anonymity guarantees)?

**Q2 — Anonymity vs. lawful compliance posture (I-1 / NC-2).**
Do you confirm we should resolve conflicts **in favor of anonymity** — i.e., architect so
the operator is *technically unable* to de-anonymize a reporter even under lawful order —
accepting the resulting legal exposure and the need for Botswana legal review? Or must the
design retain a lawful-disclosure capability (which fundamentally changes the trust model)?

**Q3 — Hosting jurisdiction leaning (A-TEC-03 / A-LEG-04 / A-LEG-08).**
Which way do you lean for the deployment-model analysis we'll do in Batch 2/3:
(a) **in-country** (max residency alignment, weaker managed services),
(b) **offshore** (stronger services, adds foreign compelled-access surface),
(c) **hybrid/distributed** (split sensitive vs non-sensitive; higher complexity), or
(d) **no lean — present the full comparison and recommend**? *(We can recommend regardless;
this just tells us your priors.)*

**Q4 — Intake channels for the MVP (A-TEC-01 / A-TEC-02 / DT-1).**
Must the **first release** support low-end reach — USSD / SMS / voice / feature phones and
offline drafting — as mandatory (maximizes reach, worsens metadata safety), or is a
**smartphone/PWA-first** MVP acceptable with low-end channels as a fast follow?

**Q5 — First-release scope (A-ORG-02).**
Confirm the justice-sector scope for release one, or tell us to widen/narrow it.

**Q6 — Threat model completeness.**
Is there a threat actor, asset, or attack vector we have **under- or over-weighted** for the
Botswana context (e.g., specific institutions, known past incidents, particular political
risks) that we should fold into the model before building on it?

**Q7 — Batch sizing for what comes next.**
After you confirm, how would you like Batch 2 delivered:
(a) **Governance Framework + Trust Architecture + Executive Summary together** (recommended —
they interlock), or (b) one section at a time for closer review?

---

### How to respond

You can answer as briefly as *"Q1 independent, Q2 anonymity, Q3 hybrid, Q4 PWA-first, Q5
confirmed, Q6 none, Q7 a"* and we will proceed. Any "correct" or "adjust" on an assumption
will be written back into `01-assumptions-register.md` before Batch 2 so the record stays
truthful.

**Until you respond, no Batch-2+ content will be generated — by design, not by oversight.**

## 3.7 Definition-of-Done for Batch 1

- [x] Threat model summarized; highest-priority (Critical) risks identified and interpreted.
- [x] Highest-architectural-impact assumptions surfaced.
- [x] Key downstream tensions named honestly rather than deferred silently.
- [x] Formal Confirmation Checkpoint with specific, decision-shaping questions.
- [x] Explicit stop; downstream work declared contingent on confirmation.
