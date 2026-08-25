# 08 — Formal Threat Model (STRIDE + LINDDUN)

> This is the **load-bearing** artifact of the whole blueprint. Per the design mandate,
> **every** subsequent architecture and governance decision must reference the STRIDE
> and/or LINDDUN threat(s) it addresses. Nothing downstream is built until this model is
> validated at the Confirmation Checkpoint (`11-*`).
>
> STRIDE covers **security** threats (Spoofing, Tampering, Repudiation, Information
> disclosure, Denial of service, Elevation of privilege). LINDDUN covers **privacy &
> anonymity** threats (Linking, Identifying, Non-repudiation, Detecting, Data disclosure,
> Unawareness, Non-compliance). For this platform, **LINDDUN is co-equal with STRIDE**,
> because loss of anonymity can be fatal in the literal sense.

> **⚑ Scope note — two trust zones.** This model now spans the whole justice ecosystem, which
> contains **two fundamentally different trust zones** that must never be conflated:
>
> - **Zone R — Confidential Reporting (Mode 1):** anonymous citizens; **maximum anonymity**;
>   the operator is inside the threat model; reporters get **deniability/repudiability**.
>   Sections 2.1–2.9 (the original core) cover this zone in depth.
> - **Zone O — Identified Official Workflows (Modes 2–4):** investigators, prosecutors,
>   defenders, judicial officers, oversight — **known, accountable actors**; the priorities
>   are **integrity, due process, separation of powers, least privilege, and
>   non-repudiation** (the opposite of Zone R's reporter deniability).
>
> A control that is right for one zone can be *wrong* for the other (e.g., device attestation
> aids Zone O accountability but destroys Zone R deniability — NR-1). **Section 2.10 adds the
> ecosystem/Zone-O threats** on top of the Zone-R core below.

---

## 2.1 Assets to protect (ranked by consequence of loss)

| # | Asset | Why it matters | Consequence of compromise |
|---|-------|----------------|---------------------------|
| **A1** | **Reporter anonymity / identity linkage** | The crown jewel. Includes any data that links a report to a natural person: account, device, network, timing, writing style, or content that only a few people could have authored. | Retaliation, dismissal, prosecution, physical harm, or death of the reporter. **Irreversible.** |
| **A2** | **Report content** | The substance of the disclosure. | Exposure of the reporter (via content), tipping off the accused, evidence destruction. |
| **A3** | **Evidence & its integrity** | Files, hashes, timestamps, chain-of-custody records. | Loss of legal defensibility; wrongful outcomes; inability to act. |
| **A4** | **Metadata** | Network (IP, timing, size), device (fingerprint, OS), behavioral (session patterns), and system logs. | The primary de-anonymization vector even when content is encrypted. |
| **A5** | **Case data & investigator work product** | Case files, correlations, notes, recipient routing. | Tipping off subjects; endangering reporters/witnesses; compromising investigations. |
| **A6** | **Cryptographic keys & secrets** | Keys protecting content, evidence, metadata, and identities. | Total compromise of confidentiality; forged evidence; mass de-anonymization. |
| **A7** | **Audit logs & their integrity** | Records of who did what. | Undetected insider abuse; loss of accountability; loss of legal defensibility. |
| **A8** | **Service availability** | The intake channel itself. | Reports can't be filed at the moment they matter; chilling effect; loss of trust. |
| **A9** | **Investigator / staff / governance member identities & safety** | The humans operating the platform. | Coercion, corruption, targeting of the operator's people. |
| **A10** | **Public trust / platform reputation** | The intangible that makes anyone use it at all. | A single credible de-anonymization or leak ends adoption permanently. |

## 2.2 Threat actors (capability × motivation)

| ID | Actor | Capability | Motivation | Notes |
|----|-------|-----------|-----------|-------|
| **TA-1** | **Justice-sector subject with state powers** (implicated police, prosecutor, judicial officer, prison official) | **High** — lawful access to investigative tools, interception, subpoena/warrant, coercion, and insider knowledge of institutions. | Self-preservation; silence the reporter; discredit the platform. | The defining adversary. They are *both* the subject of reports *and* hold state power. Assume they can lawfully compel telecoms and possibly the operator/host. |
| **TA-2** | **Malicious or coerced insider / operator / administrator** | **High** — privileged access to systems, data, and keys. | Bribery, coercion, ideology, or infiltration. | Explicitly inside the threat model (design mandate §3). Includes outsourced SOC/DevOps staff (A-OPS-01). |
| **TA-3** | **Hosting provider / cloud provider under compelled disclosure** | **High** for data-at-rest and metadata they hold; can be legally gagged. | Legal compulsion (their jurisdiction or Botswana MLAT). | The reason "encrypt everything the provider can see, minimize what they hold" is non-negotiable. |
| **TA-4** | **Telecom carrier / ISP** | **High** for network metadata; can log/intercept under license conditions. | Legal compulsion; commercial data retention. | Sees *that* a citizen contacted the platform even if not *what*. Central to LINDDUN Detecting/Linking. |
| **TA-5** | **External attacker / cybercriminal / hacktivist** | **Medium–High** — remote exploitation, phishing, DDoS, supply-chain. | Financial, notoriety, disruption, resale of leaked data. | Standard AppSec adversary; still capable of catastrophic outcomes here. |
| **TA-6** | **Nation-state / well-resourced APT** (foreign or domestic) | **Very high** — 0-days, global passive traffic analysis, sustained targeting. | Strategic intelligence; protect allied officials; destabilization. | Cannot be fully defended against; design raises cost and narrows windows. |
| **TA-7** | **Fraudulent / malicious reporter** | **Low–Medium** — can submit false, defamatory, flooding, or poisoning reports. | Discredit a rival; discredit the platform; overwhelm triage. | Threatens integrity and availability, not confidentiality. |
| **TA-8** | **Physical-world coercer** | Varies | Intimidate a reporter/operator/governance member into revealing information. | Outside pure technical control; mitigated by ephemerality, split trust, and duress features. |
| **TA-9** | **Curious/negligent insider or third party** | Low | No malice; accidental exposure, misconfiguration, lost laptop. | The most *common* cause of breaches; mitigated by least privilege and DLP. |

## 2.3 Trust assumptions (what we do and do not trust)

- **We do NOT trust:** any single operator/administrator; the hosting provider with
  plaintext; the telecom layer with metadata; the network path; the reporter's device; any
  single institution as sole recipient; automated judgments about truth.
- **We conditionally trust:** the independent oversight body **only in aggregate and only
  under split control** (no single member can act alone); vetted, dual-controlled staff for
  narrowly-scoped operations; open-source, audited cryptographic primitives.
- **We must trust (and therefore must minimize reliance on):** the correctness of a small,
  auditable trusted computing base (crypto libraries, the intake service's metadata
  handling); the physical security of key-management hardware; the honesty of *at least a
  threshold* of governance members.
- **Root-of-trust principle:** wherever we are forced to trust, we (a) minimize the size of
  what must be trusted, (b) split it so compromise requires collusion, (c) make its use
  auditable, and (d) name the residual trust explicitly. ⚠️ COST: split trust and threshold
  controls slow down legitimate operations and raise complexity — accepted for A1.

## 2.4 Risk rating method

Likelihood (L) and Impact (I) each on 1–5. **Risk = L × I**, banded:

| Score | Band |
|-------|------|
| 1–5 | **Low** |
| 6–11 | **Medium** |
| 12–19 | **High** |
| 20–25 | **Critical** |

Impact is scored against **reporter safety first** — a threat that endangers a reporter is
scored Impact 5 even if its system footprint is small.

---

## 2.5 STRIDE — Security threat catalogue

Each entry: description · assets · L · I · risk · mitigations (design intent, detailed in
later batches) · residual risk · architectural implication.

### Spoofing (authenticity)

**S-1 — Impersonation of the real intake service (phishing / fake app).**
An adversary stands up a look-alike app, PWA, or onion address to harvest reports and
de-anonymize reporters at the source. · Assets: A1, A2, A10 · L4 × I5 = **20 Critical** ·
Mitigations: signed/reproducible app builds; published verification fingerprints; onion
service key pinning; certificate pinning + CT monitoring; official distribution channels;
in-product authenticity guidance; short, memorable, officially-published entry points ·
Residual: a reporter who never verifies fingerprints can still be phished (device/user
factor) · **Implication:** authenticity verification is a first-class UX and crypto
requirement, not an afterthought.

**S-2 — Impersonation of a reporter to a returning session.**
Someone who obtains a reporter's anonymous credential (passphrase/recovery code) hijacks
their case thread. · Assets: A1, A5 · L2 × I4 = **8 Medium** · Mitigations: high-entropy
anonymous credentials generated client-side; no server-side identity to phish; optional
second factor that never ties to a real identity · Residual: credential theft on a
compromised device · **Implication:** anonymous-account model must be capture-resistant and
device-independent yet not recoverable via any identifying channel.

**S-3 — Impersonation of an investigator/admin/governance member.**
Adversary spoofs a privileged operator to access case data or routing. · Assets: A5, A6,
A9 · L3 × I5 = **15 High** · Mitigations: phishing-resistant MFA (FIDO2/WebAuthn hardware
keys) for all privileged roles; hardware-backed keys; zero standing privilege; per-action
step-up · Residual: coerced legitimate operator (→ TA-8, covered by dual control) ·
**Implication:** hardware-backed, phishing-resistant auth mandatory for every privileged
actor.

**S-4 — Sybil / mass fake reporters.**
Automated creation of many fake anonymous identities to flood or poison. · Assets: A8, A5 ·
L4 × I3 = **12 High** · Mitigations: privacy-preserving anti-abuse (proof-of-work, rate
limits keyed to *anonymous* tokens, anomaly detection) that does **not** require
identifying the reporter · Residual: determined low-volume abuse persists · **Implication:**
abuse controls must preserve anonymity — no CAPTCHAs that phone home to third parties that
can log the reporter (⚠️ COST: rules out convenient reCAPTCHA-style services).

### Tampering (integrity)

**T-1 — Alteration of report content or evidence in transit or at rest.**
· Assets: A2, A3 · L3 × I5 = **15 High** · Mitigations: end-to-end encryption from client
to recipient enclave; content-addressed storage (hash = address); per-object integrity
hashes; signatures at submission; append-only evidence store · Residual: tampering on the
reporter's device before encryption · **Implication:** integrity must be established at the
earliest possible point (client) and verifiable independently thereafter. 🔒
HUMAN-EXPERT-REVIEW-REQUIRED.

**T-2 — Tampering with audit logs to hide insider abuse.**
· Assets: A7 · L3 × I5 = **15 High** · Mitigations: append-only, cryptographically-chained
(hash-linked) logs; external anchoring of log digests (transparency-log style); segregation
of duties so log admins ≠ system admins · Residual: collusion across duty boundaries ·
**Implication:** tamper-evident logging with independent anchoring is a core subsystem, not
a feature of the app.

**T-3 — Malicious modification of the client or its dependencies (supply chain).**
A poisoned dependency or build pipeline exfiltrates or de-anonymizes at the source. ·
Assets: A1, A2, A6 · L3 × I5 = **15 High** · Mitigations: reproducible builds; SBOM;
dependency pinning + provenance (SLSA); signed releases; minimal dependency surface for the
anonymity-critical path; independent build verification · Residual: sophisticated
upstream/nation-state supply-chain attack (TA-6) · **Implication:** the anonymity-critical
code path must have a *deliberately tiny, audited* dependency footprint. 🔒
HUMAN-EXPERT-REVIEW-REQUIRED.

**T-4 — Tampering with routing so reports go to the wrong (implicated) recipient.**
· Assets: A2, A5, A10 · L2 × I5 = **10 Medium** · Mitigations: signed recipient key
directory under governance control; conflict-of-interest routing rules enforced and
audited; multi-recipient options to avoid "reporting police to police" · Residual: governance
capture · **Implication:** recipient key directory is a governed, signed, auditable
artifact.

### Repudiation

**R-1 — A recipient institution denies ever receiving a report (the "black hole").**
· Assets: A10, A5 · L3 × I4 = **12 High** · Mitigations: signed, timestamped
delivery/receipt records held by the independent operator; non-attributable responsiveness
metrics published; escalation path (Ombudsman/Parliament) · Residual: institution acts on
but does not progress a case · **Implication:** delivery accountability is a designed
governance + technical control (A-GOV-04).

**R-2 — An operator denies an unauthorized access occurred.**
· Assets: A7 · L2 × I4 = **8 Medium** · Mitigations: tamper-evident logs (T-2); dual
control; independent audit access · Residual: covered by T-2 residual · **Implication:**
non-repudiation of *operator* actions, not reporters.

> **Deliberate non-repudiation asymmetry:** the platform provides **non-repudiation for
> operators and institutions** (accountability) while providing **repudiability /
> deniability for reporters** (safety). This asymmetry is a core design tenet and reappears
> in LINDDUN NR-1.

### Information Disclosure (confidentiality) — *the highest-stakes STRIDE category here*

**I-1 — Compelled disclosure of stored data from the hosting provider or operator.**
State actor (TA-1/TA-3) serves a warrant/subpoena, possibly gagged. · Assets: A1, A2, A3,
A4 · L4 × I5 = **20 Critical** · Mitigations: hold as little identifying data as possible;
end-to-end encryption so the provider has only ciphertext; keys split across independent
governance custodians (threshold) so the operator *cannot* comply even if compelled; data
minimization and aggressive retention limits; warrant canary; jurisdiction choice to raise
the cost of compulsion · Residual: ⚠️ COST/HONESTY: **cannot be reduced to zero.** If the
threshold set of custodians is compelled *and* colludes/complies, or if data was retained
that should not have been, disclosure occurs. The design goal is to make lawful compulsion
*technically ineffective* against A1 by ensuring no single compelled party holds enough to
de-anonymize. · **Implication:** threshold key management + radical data minimization are
the only real defenses; documented honestly to avoid false confidence. 🔒
HUMAN-EXPERT-REVIEW-REQUIRED.

**I-2 — Metadata leakage enabling de-anonymization even with content encrypted.**
Traffic timing/size, IP, device fingerprint, login patterns. · Assets: A4 → A1 · L4 × I5 =
**20 Critical** · Mitigations: metadata-resistant transport (onion service / mixnet-style
padding); no server-side IP logging; strip client metadata (EXIF etc.) before storage;
uniform response sizing/timing where feasible; no third-party analytics/SDKs on
anonymity-critical paths; store metadata only when unavoidable and encrypt/minimize it ·
Residual: global passive adversary (TA-6) correlation attacks · **Implication:** metadata
minimization is a *pervasive* requirement touching every layer; "just add TLS" is
insufficient. 🔒 HUMAN-EXPERT-REVIEW-REQUIRED.

**I-3 — De-anonymization through report *content* (writing style, unique facts).**
A report only a few insiders could have written identifies its author regardless of crypto.
· Assets: A1 · L3 × I5 = **15 High** · Mitigations: AI/human PII detection + redaction
suggestions; stylometry warnings; guidance to generalize identifying detail; reviewer
handling protocols · Residual: ⚠️ HONESTY: **content-based identification is largely outside
the platform's control** — the reporter chooses what to write. · **Implication:** the UX must
*warn* without paternalistically blocking; PII redaction assists but never guarantees.

**I-4 — Breach of case data / evidence store by external attacker.**
· Assets: A2, A3, A5 · L3 × I5 = **15 High** · Mitigations: defense in depth; encryption at
rest with keys outside the storage tier; network segmentation; least privilege; WAF; strong
AppSec (OWASP ASVS/MASVS); continuous monitoring · Residual: novel exploit / insider ·
**Implication:** standard but rigorous — the difference here is that leaked ciphertext must
remain useless without the split keys.

**I-5 — Correlation across sessions/cases links multiple reports to one reporter.**
· Assets: A1, A4 · L3 × I5 = **15 High** · Mitigations: unlinkable per-report identities by
default; explicit, informed opt-in to link a follow-up to a prior case; no cross-report
tracking identifiers · Residual: content/timing correlation · **Implication:** unlinkability
is the default; linkage is a deliberate, reporter-controlled exception (see LINDDUN L-1).

### Denial of Service (availability)

**D-1 — Volumetric/application DDoS on the intake channel.**
· Assets: A8 · L4 × I4 = **16 High** · Mitigations: upstream DDoS scrubbing/CDN for
public-facing surfaces (with privacy-preserving configuration), rate limiting, autoscaling,
onion-service DoS defenses, graceful degradation to a minimal intake mode · Residual:
sustained nation-state DDoS · **Implication:** availability engineering with privacy-aware
CDN choices (⚠️ COST: a CDN sees traffic — must be configured to not undermine I-2).

**D-2 — Targeted resource exhaustion via malicious uploads.**
Huge/malformed evidence files. · Assets: A8 · L3 × I3 = **9 Medium** · Mitigations: size/type
limits, streaming validation, sandboxed processing, quotas · Residual: crafted
slow-drip abuse · **Implication:** upload pipeline hardening.

**D-3 — Deliberate report flooding to bury real reports (TA-7).**
· Assets: A8, A5 · L3 × I3 = **9 Medium** · Mitigations: anonymity-preserving anti-abuse
(S-4), triage prioritization, duplicate detection · Residual: sophisticated distributed
flooding · **Implication:** triage must be robust to noise without discarding signal.

### Elevation of Privilege

**E-1 — Insider or attacker escalates to access identity-linkable data or keys.**
· Assets: A1, A6 · L3 × I5 = **15 High** · Mitigations: zero standing privilege;
just-in-time, dual-authorized, time-boxed access; strict RBAC/ABAC; separation of duties so
*no single role* can access enough to de-anonymize; key operations require threshold
approval · Residual: multi-party collusion (TA-2 × TA-2) · **Implication:** the system must
be architected so that **de-anonymization requires collusion of parties who are structurally
disincentivized and independently audited** — this is the technical expression of
"operator-in-threat-model."

**E-2 — Container/host/orchestration escape.**
· Assets: A2, A3, A6 · L2 × I5 = **10 Medium** · Mitigations: hardened images, minimal
attack surface, runtime security, patch discipline, workload isolation for sensitive
services (e.g., dedicated nodes/enclaves for the anonymity-critical path) · Residual:
0-day (TA-6) · **Implication:** the anonymity-critical path may warrant stronger isolation
(confidential computing / HSM-backed enclave) than the rest.

---

## 2.6 LINDDUN — Privacy & anonymity threat catalogue

For a whistleblower system these threats can be **more consequential than the STRIDE ones**,
because they directly attack A1.

### Linking

**L-1 — Linking multiple reports, sessions, or actions to the same (still-anonymous)
reporter.**
Even without a name, linking builds a fingerprint that eventually identifies. · Assets: A1,
A4 · L4 × I5 = **20 Critical** · Mitigations: unlinkable-by-default identities (I-5); no
persistent client identifiers; per-report cryptographic separation; padding/timing defenses;
warn users before any linkage · Residual: content and behavioral correlation; global
adversary · **Implication:** unlinkability is a top-tier design goal, enforced at data-model,
crypto, and transport layers simultaneously. 🔒 HUMAN-EXPERT-REVIEW-REQUIRED.

### Identifying

**ID-1 — Directly identifying the reporter from stored or transited data.**
Any datum that resolves to a natural person. · Assets: A1 · L4 × I5 = **20 Critical** ·
Mitigations: collect **no** real-world identity by default; client-side data minimization;
strip metadata; encrypt content end-to-end; store pseudonymous tokens only; threshold-guard
anything that could identify · Residual: content-based (I-3), device-based, coercion-based ·
**Implication:** "identity you never collected cannot be disclosed" — data minimization is
the primary privacy control. 🔒 HUMAN-EXPERT-REVIEW-REQUIRED.

**ID-2 — Identifying via the *access network* (the carrier/ISP sees the citizen reach the
platform).**
· Assets: A4 → A1 · L4 × I5 = **20 Critical** · Mitigations: metadata-resistant transport so
the *content and destination* are obscured (onion service means the carrier sees "Tor," not
"the reporting platform"); guidance on safer access (public networks, shared devices)
*with honest caveats* · Residual: ⚠️ HONESTY: the carrier can still see the citizen used Tor/
the app at all; in some threat models *that alone* is incriminating. Zero-rating (A-FIN-04)
would make this **worse**, not better. · **Implication:** transport-layer anonymity is
essential *and* insufficient alone; must be paired with honest user guidance.

### Non-repudiation (here, a *threat* — we want deniability for reporters)

**NR-1 — The system inadvertently creates proof that a specific person filed a report.**
Signed submissions, device attestations, or logs that bind a report to a person destroy
deniability. · Assets: A1 · L3 × I5 = **15 High** · Mitigations: reporters use anonymous,
non-attributable credentials; **no** device attestation or identity signature on reporter
actions; deniable/repudiable submission design; the operator/institution side is
non-repudiable but the reporter side is not · Residual: content-based proof · **Implication:**
the STRIDE non-repudiation asymmetry (R-1/R-2) is deliberately *not* applied to reporters.

### Detecting

**DT-1 — Detecting that a particular person is *using* or *has used* the platform.**
Even without content, mere use can trigger retaliation. · Assets: A1, A4 · L4 × I5 =
**20 Critical** · Mitigations: metadata-resistant transport; cover-traffic/padding where
feasible; a **plausible-cover** entry (e.g., the app resembles or nests behind an innocuous
function); panic mode and rapid local-data destruction; guidance on shared/public device
use · Residual: ⚠️ HONESTY: a determined network observer (TA-4/TA-6) may still detect
usage; on-device forensic seizure defeats local hiding · **Implication:** "detection
resistance," not just "content confidentiality," is an explicit requirement — this is often
the difference between life and death for the reporter and is frequently *underweighted* by
naïve designs.

**DT-2 — Detecting sensitive attributes from behavior/patterns visible to the operator.**
· Assets: A4 · L3 × I4 = **12 High** · Mitigations: minimize behavioral logging; aggregate
only; access controls on any behavioral data · Residual: inference from necessary
operational data · **Implication:** operational telemetry must be privacy-budgeted.

### Data Disclosure (policy/lifecycle)

**DD-1 — Excessive collection or over-retention creates a de-anonymization treasure trove.**
Data you keep is data that can be compelled (I-1), breached (I-4), or leaked (TA-9). ·
Assets: A1, A2, A4 · L3 × I5 = **15 High** · Mitigations: strict data-minimization by
design; short, enforced retention with cryptographic erasure; purpose limitation; no
"collect now, decide later" · Residual: data needed for legitimate case handling must
persist for its lifecycle · **Implication:** retention and erasure are *engineered and
governed*, not policy PDFs — and are in explicit tension with evidence needs (adjudicated in
Evidence Management, Batch 3).

**DD-2 — Secondary use / function creep (data collected for reporting used for something
else).**
· Assets: A1, A10, plus A-ORG-02 scope · L3 × I4 = **12 High** · Mitigations: purpose
limitation enforced technically and by governance; expansion to new domains requires fresh
DPIA + governance approval · Residual: governance capture · **Implication:** purpose
limitation is a governance-enforced boundary, especially as the platform expands.

### Unawareness

**U-1 — Reporters don't understand the residual risks and gain false confidence.**
The most ethically dangerous failure: a reporter trusts "anonymous" and is harmed by a risk
the platform never claimed to cover (device malware, content-based ID, coercion). · Assets:
A1, A10 · L4 × I5 = **20 Critical** · Mitigations: honest, layered, plain-language and
Setswana risk communication *before* submission; threat-aware UX; no overclaiming of
"anonymity"; explicit "what this protects / what it cannot protect" · Residual: users skip or
misread warnings · **Implication:** **honesty in the UX is a safety control**, ranked
Critical — this directly implements the engagement's honesty constraint. 🔒
HUMAN-EXPERT-REVIEW-REQUIRED (safety-critical copy).

**U-2 — Reporters unaware they are self-identifying through content (links DT-1/I-3).**
· Assets: A1 · L4 × I4 = **16 High** · Mitigations: pre-submission review prompts; PII/
stylometry warnings; examples of safe vs unsafe phrasing · Residual: user choice ·
**Implication:** guided, non-blocking pre-submission review.

### Non-compliance

**NC-1 — The platform violates the Data Protection Act or other Botswana law in how it
handles data.**
· Assets: A10, legal standing · L2 × I4 = **8 Medium** · Mitigations: DPIA; compliance-by-
design; lawful basis mapping; Data Protection Commissioner engagement; documented retention/
DSAR handling that is compatible with anonymity · Residual: legal interpretation shifts
(A-LEG-01) · **Implication:** compliance is designed in and legally reviewed (Batch 5), not
retrofitted.

**NC-2 — Conflict between legal obligations and anonymity (e.g., a lawful order to identify
a reporter, or DSAR/right-to-erasure mechanics that could be abused to probe for a
reporter).**
· Assets: A1 · L3 × I5 = **15 High** · Mitigations: architect so the operator *cannot*
identify a reporter (I-1/ID-1 threshold design), making some orders technically impossible to
comply with; design DSAR/erasure so they cannot be weaponized to confirm a reporter's
existence · Residual: ⚠️ HONESTY/LEGAL: an unresolved tension between compliance duties and
anonymity that **requires qualified Botswana legal review** (A-LEG-01/02/04) · **Implication:**
this is a flagged legal-review item, not something engineering can resolve alone.

---

## 2.7 Threat → asset coverage summary

| Asset | Primary threats |
|-------|-----------------|
| A1 Anonymity/identity | S-1, I-1, I-2, I-3, I-5, E-1, L-1, ID-1, ID-2, NR-1, DT-1, U-1, U-2, NC-2 |
| A2 Report content | T-1, I-1, I-4, DD-1 |
| A3 Evidence integrity | T-1, I-1, I-4, DD-1 |
| A4 Metadata | I-2, I-5, L-1, ID-2, DT-1, DT-2, DD-1 |
| A5 Case data | S-3, T-4, R-1, I-4, D-3 |
| A6 Keys/secrets | S-3, T-3, I-1, E-1, E-2 |
| A7 Audit logs | T-2, R-2 |
| A8 Availability | S-4, D-1, D-2, D-3 |
| A9 Staff safety | S-3, TA-8 (physical) |
| A10 Public trust | S-1, R-1, I-4, DD-2, U-1, NC-1 |

## 2.8 Residual risks that no design fully removes (stated honestly)

1. **Compromised reporter device** (A-TEC-05) — malware, spyware, forensic seizure,
   shoulder-surfing. The platform cannot see or fix this. (DT-1, I-3, U-1.)
2. **Content-based self-identification** (I-3, U-2) — the reporter controls what they write.
3. **Physical coercion** (TA-8) of reporters, operators, or governance members.
4. **Global passive network adversary** (TA-6) correlation attacks (I-2, DT-1).
5. **Compelled disclosure that succeeds anyway** (I-1, NC-2) — if minimization/threshold
   controls are circumvented, mis-implemented, or a threshold of custodians is compelled and
   complies.
6. **Governance capture** (A-GOV-01) — if the "independent" oversight is not truly
   independent, split-trust controls are theater.
7. **Detection of mere usage** (DT-1, ID-2) — in some threat models, being seen to use the
   platform *at all* is the harm; transport anonymity mitigates but does not eliminate this.

These are not defects to be "fixed later" — they are the honestly-stated boundary of what
software can do, and they shape the UX (U-1), governance (A-GOV-01), and legal (NC-2)
requirements downstream.

## 2.9 Ecosystem / Zone-O threats (Modes 2–4: identified official workflows)

These add to (do not replace) the Zone-R core above. New assets in play: **A5 case data**,
**A11 adjudication integrity** (correctness/independence of the judicial record), **A12
cross-agency data-sharing surface**, **A13 AI-assistance integrity** (bias/manipulation of
assistive models), **A14 due-process fairness** (equality of arms, defence access). New/
amplified actors: **TA-1** now also as an insider *within* investigation/prosecution/courts;
**TA-2** insider across any arm; **TA-10 external litigant/party** seeking improper access to
the other side's data.

### Spoofing / Authentication (Zone O)
**S-5 — Impersonation of an official to write to case/adjudication data.**
· Assets: A5, A11 · L3 × I5 = **15 High** · Mitigations: phishing-resistant MFA (FIDO2) for
all officials; per-arm identity federation; step-up + dual control for high-impact writes
(orders, sealing, disclosure); every write audited (T-2) · Residual: coerced legitimate
official → dual control + anomaly detection · **Implication:** Zone-O identity is as strict as
Zone-R is anonymous — opposite requirement, same rigor.

### Tampering / Integrity (Zone O)
**T-5 — Case-fixing: unauthorized alteration of case status, orders, or judgments.**
· Assets: A11, A10 · L3 × I5 = **15 High** · Mitigations: judiciary-owned write zone
(A-JUS-03); append-only, hash-chained case-event log; four-eyes on sensitive transitions;
immutable judgments once delivered; external anchoring of the judicial event digest ·
Residual: collusion within the judiciary + registrar · **Implication:** adjudication integrity
gets the same tamper-evidence as evidence custody (T-1/T-2).

**T-6 — Improper sealing/unsealing to hide or expose a matter.**
· Assets: A11, A14, privacy · L2 × I4 = **8 Medium** · Mitigations: sealing as an audited,
reason-coded, authority-checked action; oversight visibility of sealing *rates* (not contents)
· Residual: authorized-but-improper sealing · **Implication:** sealing is a governed action,
not a silent flag.

**T-7 — Manipulation of AI-assistance to bias triage/prioritization/redaction.**
· Assets: A13, A14 · L2 × I4 = **8 Medium** · Mitigations: AI is advisory only (A-AI-01);
human-in-the-loop for anything consequential; model/version pinning; audit of AI inputs/
outputs; bias evaluation; no AI in the write path of a decision · Residual: subtle bias in
advisory output · **Implication:** AI integrity and explainability are controls, and AI is
architecturally kept out of decisions. 🔒 HUMAN-EXPERT-REVIEW-REQUIRED.

### Repudiation (Zone O)
**R-3 — An official denies an action (issued order, made disclosure, accessed a record).**
· Assets: A7, A11 · L3 × I4 = **12 High** · Mitigations: non-repudiable, signed, audited
official actions (the deliberate inverse of reporter deniability, NR-1) · Residual: covered by
T-2 · **Implication:** Zone O is **non-repudiation-positive**; Zone R is **non-repudiation-
negative**. The two must not share an identity/audit model.

### Information Disclosure (Zone O)
**I-6 — Cross-arm over-reach: one arm reads another's data without lawful basis** (executive
reading judiciary internals, or vice-versa). · Assets: A11, A12, separation of powers · L3 ×
I5 = **15 High** · Mitigations: arm-owned data zones; no central pool; access only via
purpose-bound, audited events/APIs behind ACLs; ABAC enforcing arm + matter + role · Residual:
lawful-but-broad access grants · **Implication:** separation of powers is an **access-control
invariant**, encoded in IAM, not a policy aspiration (A-JUS-03).

**I-7 — Improper party access: a litigant/defendant accesses the other side's protected data
or a victim/witness's protected details.** · Assets: A14, witness safety · L3 × I5 = **15
High** · Mitigations: matter-scoped ABAC; disclosure limited to lawfully disclosable subset;
witness-protection redaction; open-justice exceptions (A-JUS-04) · Residual: lawful disclosure
that still endangers a witness · **Implication:** disclosure is a scoped projection, never raw
record access; witness protection is a first-class redaction rule.

**I-8 — Re-identification from "aggregated" transparency data** (small cells, linkage). ·
Assets: A1, privacy of parties · L3 × I5 = **15 High** · Mitigations: k-anonymity / minimum
cell thresholds; suppression; differential-privacy-style noise where appropriate; governance
sign-off on each published dataset · Residual: linkage with external datasets ·
**Implication:** disclosure control is an engineered gate on the Transparency boundary (J5,
L-1/ID-1).

### Denial of Service (Zone O)
**D-4 — Loss of availability of justice-critical services** (scheduling, case status,
evidence access at hearing time). · Assets: A8, due process · L3 × I4 = **12 High** ·
Mitigations: HA design, graceful degradation, offline/read-only fallback for court operations,
tested DR/RTO/RPO · Residual: sustained infrastructure failure · **Implication:** availability
NFRs for Zone O are due-process requirements, not just SRE targets.

### Elevation of Privilege (Zone O)
**E-3 — Insider escalates to case-fixing or cross-arm access.**
· Assets: A5, A11, A12 · L3 × I5 = **15 High** · Mitigations: zero standing privilege; JIT +
dual control for sensitive writes; SoD so no single role can both investigate and adjudicate,
or both disclose and seal; anomaly detection · Residual: multi-party collusion ·
**Implication:** the Zone-R "de-anonymization requires collusion" principle has a Zone-O twin:
"case-fixing requires collusion across separated duties."

### LINDDUN (Zone O additions)
**L-2 — Linking a person across investigation, prosecution, adjudication, and corrections to
build an unauthorized profile.** · Assets: A12, privacy · L3 × I4 = **12 High** ·
Mitigations: purpose limitation; per-context identifiers with governed linkage; audit of
cross-context correlation; data minimization in events · Residual: authorized-but-excessive
linkage · **Implication:** cross-arm linkage is deliberate, governed, and audited — not a
default of "one big case record."

**DD-3 — Function creep of official data into surveillance or unrelated use.**
· Assets: privacy, A10 · L3 × I4 = **12 High** · Mitigations: purpose limitation enforced in
IAM/policy engine; new uses require DPIA + governance approval; expansion to new domains gated
· Residual: governance capture · **Implication:** the same DD-2 discipline extends to official
data; especially critical as the platform scales to new domains.

**NC-3 — Publishing/handling that breaches open-justice exceptions** (juveniles, sexual
offences, protected witnesses, sealed/national-security matters). · Assets: A14, legal
standing · L3 × I5 = **15 High** · Mitigations: exception-aware publication engine; default-
deny publication; registrar-controlled sealing; legal review of publication rules (A-JUS-04)
· Residual: mis-coded exception · **Implication:** open-justice compliance is automated and
default-deny, with human/legal oversight.

### Zone-O asset/threat additions summary
| Asset | Threats |
|-------|---------|
| A5 Case data | S-5, T-5, I-6, E-3, L-2 |
| A11 Adjudication integrity | T-5, T-6, R-3, I-6, E-3 |
| A12 Cross-agency surface | I-6, E-3, L-2, DD-3 |
| A13 AI-assistance integrity | T-7 |
| A14 Due-process fairness | T-6, I-7, NC-3 |

### Zone-O residual risks (added to §2.8)
8. **Collusion across separated duties** (E-3, T-5) — SoD raises the bar to multi-party
   collusion but cannot make it impossible.
9. **Lawful-but-improper action** (T-6, L-2, I-7) — authorized actors misusing legitimate
   access; mitigated by audit + oversight, not prevented.
10. **Institutional non-participation** (A-JUS-05) — if arms don't adopt, Zone O degrades to a
    partial system; a program risk more than a technical one (see `10-risk-register.md`).

## 2.10 Definition-of-Done for this section

- [x] Assets ranked by consequence; threat actors enumerated with capability/motivation;
  trust assumptions stated; **two trust zones (R and O) distinguished**.
- [x] Full STRIDE + LINDDUN catalogue for Zone R with L×I ratings, mitigations, residual risk,
  and architectural implications.
- [x] **Ecosystem/Zone-O threats added** (S-5, T-5..T-7, R-3, I-6..I-8, D-4, E-3, L-2, DD-3,
  NC-3) with the deliberate reporter-deniability vs official-non-repudiation asymmetry made
  explicit.
- [x] Threat→asset coverage matrices and an explicit, expanded residual-risk statement.
- [x] Anonymity-, crypto-, evidence-, metadata-, and AI-critical threats flagged 🔒; cost/
  honesty tensions marked ⚠️.
- **Required specialist review:** cryptography engineer (I-1, I-2, T-1, T-3, T-5, L-1, ID-1),
  privacy engineer (all LINDDUN, I-8), digital forensics (T-1, T-2, T-5, evidence), Botswana
  legal/judicial counsel (NC-1..NC-3, I-1, I-6, A-JUS-03/04), governance advisor (E-1, E-3,
  A-GOV-01), AI systems/ethics (T-7, A-AI-*), safety-critical UX writer (U-1, U-2).

*Next: `09-trust-model.md`.*
