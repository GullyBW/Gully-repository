# MVP Definition (Part 2)

## Selection — greatest architectural coverage, lowest complexity

| Candidate | Subsystems exercised | Complexity | Coverage |
|-----------|----------------------|-----------|----------|
| **Anonymous reporting → governance (SELECTED)** | policy, reporting, CoI routing, evidence+custody, audit, IAM, analytics, governance ledger | Low–Med | **Highest** — one thin path touches every major subsystem |
| Secure evidence submission only | evidence, custody, audit | Low | Narrow (no intake/governance) |
| Chain-of-custody management | evidence, audit | Low | Narrow |
| Case lifecycle tracking | case mgmt, courts | High (multi-institution) | Med, high dependency (MoUs) |
| Oversight review workflow | analytics, oversight | Med | Med, no intake |
| Governance decision recording | governance ledger | Low | Narrow |

**Decision (ADR-0001):** the anonymous-reporting → governance vertical slice. It is the *smallest
end-to-end feature that demonstrates the complete value of NJTIP* and validates the most architecture
per unit of effort.

## Scope (in / out)
- **In:** anonymous report intake (no identity), policy validation, CoI routing, evidence + chain of
  custody, append-only audit, investigator review (JIT/FIDO2/matter-scoped), oversight aggregates,
  human governance decision, deterministic evidence, Twin validation, REST API + UI prototype.
- **Out (later phases):** full case lifecycle across courts, multi-institution integration, production
  crypto/IAM/storage (see transition matrix), notifications, low-end channels (USSD/SMS), i18n beyond
  EN/TN placeholders, public transparency dashboard.

## Functional requirements
FR-1 submit anonymous report, no identity accepted (400 on identity). FR-2 status by case code only.
FR-3 attach evidence with verifiable custody. FR-4 CoI-aware routing (never to the subject unit).
FR-5 investigator review requires JIT + phishing-resistant + matter-scoped auth. FR-6 oversight shows
non-attributable aggregates only. FR-7 governance decisions require an accountable human + rationale;
never automated. FR-8 generate deterministic, signed evidence. FR-9 running product validates against
the Twin.

## Non-functional requirements
NFR-perf: sub-ms policy/routing on the hot path (Twin perf harness). NFR-security: default-deny, zero
standing privilege, fail-closed. NFR-privacy: no identity/IP/content in logs or aggregates.
NFR-auditability: every action append-only + hash-chained. NFR-reproducibility: deterministic evidence
given seeded inputs. NFR-availability: intake degrades to minimal, never loses accepted data.
NFR-accessibility: keyboard-navigable, theme-aware UI. (Continuous validation in `nfr-validation.md`.)

## Success criteria (met)
- ✅ Complete vertical slice operational (10 tests + live server).
- ✅ Every architectural invariant passes the Twin (14/14) from the running product.
- ✅ Identity rejection, CoI routing, custody integrity, human-only governance all enforced + tested.
- ✅ Deterministic evidence; architecture changes are the exception.

## Development roadmap (implementation-driven)
1. **v1.0 (done):** vertical slice + API + UI + Twin-in-CI.
2. **v1.1:** production IAM (OIDC+FIDO2) + secrets manager (transition matrix rows 1–2).
3. **v1.2:** production storage + KMS/HSM envelope encryption (🔒 expert-built).
4. **v1.3:** notification service + investigator queue + appeals.
5. **v1.4:** case-lifecycle context behind institutional MoUs.
Each increment is gated by the Twin and the readiness gates; go-live remains a human decision.
