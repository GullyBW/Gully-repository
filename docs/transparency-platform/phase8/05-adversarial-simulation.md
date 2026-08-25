# Phase 8 · WS5 — Adversarial Simulation

**Traces:** Threat Model `../08`, Security Validation `../phase3/03`, Trust Model `../09`. **Purpose:**
run the threat model *as executable scenarios* in the twin — attacking the platform's own promises on
synthetic data — with documented expected behavior and success criteria. This is where "we designed
it to resist X" becomes "the twin shows it resists X."

---

## 1. Simulation scenarios (each: attack · expected behavior · success criteria)

| # | Scenario | Threat | Expected behavior | Success criteria |
|---|----------|--------|-------------------|------------------|
| SIM-1 | **Insider/compromised operator** tries to read/link a synthetic reporter's identity | E-1, I-1 | No single operator can; de-anon needs M-of-N | Attempt blocked; no identity exists to read; audited |
| SIM-2 | **Compromised zone-admin** tries to reach another zone's data | I-6, E-3 | Cross-zone DB path denied; only audited events cross | Access denied + alert; 0 cross-zone raw read |
| SIM-3 | **Network failure** of a downstream service during intake | D-4 | Degrade-to-minimal-intake; reports still accepted (queued) | Intake stays available; no data loss |
| SIM-4 | **DoS/flood** on intake (Sybil/volumetric) | S-4, D-1, D-3 | Anonymity-preserving rate limit; triage robust | Intake survives; anonymity intact; real reports not dropped |
| SIM-5 | **Phishing/fake intake** clone harvests submissions | S-1 | Signed builds + fingerprints + pinning defeat clone | Clone detectable; users can verify authenticity |
| SIM-6 | **Metadata correlation** attempt across sessions/telemetry | I-2, ID-2, L-1, DT-1 | No IP retained; unlinkable per-report; minimal intake signal | No correlation possible from platform-held data |
| SIM-7 | **Evidence tampering** on a synthetic evidence object | T-1, T-5 | Integrity re-verify fails on access; alert | Tamper detected ≤ immediate; custody chain proves it |
| SIM-8 | **Disaster** (zone loss) | D-1, RK-13 | DR restore; ciphertext-only offshore; key≠ciphertext | RTO/RPO met; no plaintext exposure |
| SIM-9 | **Governance escalation** (threshold custodian unavailable / coercion) | RK-03/24 | Succession/substitute custodians; no single-party override | Threshold still requires M; escalation path works |
| SIM-10 | **Compelled-disclosure** simulation (order served to twin operator) | I-1, NC-2 | Operator holds ciphertext + insufficient shares → cannot de-anon | Technical inability demonstrated on synthetic data |

## 2. Honest boundaries of simulation

⚠️ SIM-6 and SIM-10 validate that **platform-held data and single-party compulsion** cannot
de-anonymize — they do **not** prove safety against a **global passive network adversary** (TA-6) or a
**compromised reporter device**, which are outside the twin's and platform's control (`../08 §2.8`).
The twin narrows the risk to the honestly-stated residuals; it cannot certify them away.

## 3. Cadence & integration

- Adversarial simulations run **pre-certification** and on a schedule (F3 fidelity, `01`), plus after
  major change; they complement independent red-team (`../phase3/03 A2`) — the twin lets red-teamers
  rehearse and regression-test attacks continuously on safe data.
- Results become evidence (`06`) and feed the Public Trust Index (security posture) and threat-model
  refresh (`10`, `../phase3/03 A7`).

## 4. Quality gate

- **Traces to:** `../08` (all), `../phase3/03`, `../09`; RK-01/02/06/09/13.
- **Preserves:** honest residual boundaries; synthetic-only attacks.
- **Threats validated:** E-1/E-3, I-1/I-2/I-6, S-1/S-4, T-1/T-5, D-1/D-4, NC-2 — under simulation.
- **Residual risks:** simulation ≠ real world (global adversary, device); novel/0-day attacks
  (mitigated: independent red team, continuous refresh).
- **Trade-offs:** ⚠️ maintaining a scenario library is effort — bought for continuous adversarial
  assurance and regression protection.
- **Acceptance criteria:** SIM-1..10 pass in the twin with documented expected behavior; residuals
  labelled honestly; results packaged as evidence.
- **🔒 Required review:** ISRB + external red team (scenarios/results), cryptographer (SIM-1/10),
  forensics (SIM-7).

*Next: `06-compliance-evidence-automation.md`.*
