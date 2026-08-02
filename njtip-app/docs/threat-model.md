# Enterprise Threat Model (Phase 10, Part 2)

Security analysis beyond STRIDE and LINDDUN: attack trees, abuse cases, adversary playbooks,
kill-chain and MITRE ATT&CK / CAPEC mapping, and threat classes for insider, supply-chain,
third-party, cloud and AI risk (`src/security/threat-model.js`).

Gated by `APP-FIT-THREAT-MODEL`. Live: `GET /api/security/threat-model`.

> The point of the model is the **trace**. For every threat the platform answers, mechanically:
> **Threat → Control → Evidence → Verification → Responsible Owner.** A threat with no control, a
> control naming a fitness function that does not exist, or an owner that is not a real bounded
> context all fail the build.

## Modelled threats

| ID | Threat | Class | Kill chain | Severity | Owner |
|---|---|---|---|---|---|
| `TH-DEANON` | De-anonymisation of a reporter | LINDDUN | actions-on-objectives | **critical** | privacy |
| `TH-EVIDENCE-TAMPER` | Tampering with evidence or its custody record | STRIDE | actions-on-objectives | **critical** | custody |
| `TH-PRIV-ESCALATION` | Privilege escalation through identity federation | STRIDE | exploitation | high | identity-access |
| `TH-INSIDER-SOD` | Insider drives a case end to end unilaterally | insider | actions-on-objectives | high | governance-oversight |
| `TH-SUPPLY-CHAIN` | Compromised dependency or build artifact | supply-chain | delivery | **critical** | supply-chain |
| `TH-THIRD-PARTY` | A partner agency abuses an integration | third-party | exploitation | high | data-exchange |
| `TH-CLOUD-MISCONFIG` | Misconfiguration exposes data or breaks residency | cloud | installation | high | infrastructure |
| `TH-AI-OVERREACH` | An AI recommendation becomes a decision | AI | actions-on-objectives | high | ai-advisory |
| `TH-AVAILABILITY` | Denial of the reporting channel | STRIDE | actions-on-objectives | high | resilience |
| `TH-AUDIT-SUPPRESSION` | Suppressing or rewriting the audit trail | insider | actions-on-objectives | **critical** | assurance |

Each carries: abuse cases in operational language, an **attack tree** with AND/OR decomposition, MITRE
ATT&CK technique ids, CAPEC pattern ids, the controls that mitigate it, and the evidence statement
that says what those controls actually do.

## Example — the attack tree that matters most

```
TH-DEANON  Identify an anonymous reporter                                  [OR]
├── Read a stored identity                                                 [OR]
│   ├── Query an identity column          → blocked: APP-FIT-NO-IDENTITY-COLUMN
│   └── Recover identity from a backup    → blocked: FIT-IDENTITY-MINIMIZATION (never written)
├── Infer identity from metadata                                           [AND]
│   ├── Obtain case metadata              → constrained: APP-FIT-ANALYTICS-PRIVACY (k-anonymity)
│   └── Obtain an external dataset to join → blocked: APP-FIT-CORRELATION-GOVERNANCE
└── Observe the reporting channel                                          [OR]
    ├── Correlate submission timing       → constrained: APP-FIT-ANONYMITY-BOUNDARY
    └── Read network-level source data    → out of platform scope (documented, not claimed)
```

The AND node is the useful part: metadata inference needs **both** legs, so breaking either one
breaks the path — which is why the correlation prohibition is worth as much as the suppression rule.

## Adversary playbooks

| Playbook | Adversary | Sequence (technique → breaking control) |
|---|---|---|
| `PB-INSIDER-EXFIL` | Privileged insider seeking a reporter identity | T1213 → `APP-FIT-ANALYTICS-PRIVACY` · T1078 → `APP-FIT-AUTHZ-DEFAULT-DENY` · T1565 → `FIT-IDENTITY-MINIMIZATION` |
| `PB-SUPPLY-CHAIN` | Upstream supply-chain attacker | T1195 → `INFRA-FIT-DEVSECOPS` · T1554 → `APP-FIT-SUPPLY-CHAIN-GOVERNANCE` · T1543 → `INFRA-FIT-K8S-HARDENING` |
| `PB-EXTERNAL-INTRUSION` | External actor with a stolen credential | T1550 → `APP-FIT-CREDENTIAL-HYGIENE` · T1078 → `APP-FIT-ZERO-TRUST-ARCHITECTURE` · T1565 → `APP-FIT-CUSTODY-SIGNED-CHAIN` |

Every step names the control that breaks the chain there, so a playbook doubles as a test of whether
the platform has defence in depth or a single point of reliance.

## Residual risk

`residualRisk(fitnessResults)` scores exposure per threat: `(unimplemented + 2 × failing) × severity`.
A **failing** control counts double a **missing** one — because it was relied upon. With every control
green the residual is clean; drop one and the affected threats surface immediately, ranked.

## Traceability

`traceability()` resolves each threat's controls against the live fitness gate and its owner against
the [ownership model](./governance-ownership.md), producing the responsible authority, approving
authority and governance board for every threat. A threat is never "accepted" in prose — it is either
controlled by something the build verifies, or it is visible as residual risk with a name attached.
