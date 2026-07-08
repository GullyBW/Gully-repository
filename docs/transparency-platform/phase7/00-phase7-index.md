# NJTIP — Phase 7: Engineering Factory, Internal Developer Platform & Autonomous Delivery (Index)

**Status:** DRAFT — Engineering Factory framework. **No production application code; synthetic data
only.** **Do not redesign approved architecture/governance/engineering specs.**
**Immutable baseline:** Discovery `../01`–`../12`, Design `../design/*`, Phases 2–6 `../phase2..6/*`.
**Last updated:** 2026-07-07

> Phase 7 builds the **engineering ecosystem** — the Internal Developer Platform, golden paths,
> governance automation, AI guardrails, developer experience, and the quality/observability/SRE
> platforms — that lets multiple teams build, test, secure, deploy, observe, and maintain NJTIP
> **consistently and safely**. Focus is **engineering capability**, not application functionality.
> The approved guarantees (Constitutional Architecture, no-identity, operator-in-threat-model,
> chain of custody, fail-closed) are **baked into the platform as defaults** so teams "fall into
> the pit of success."

## Design intent: make the safe path the easy path

**[REC]** The factory's core principle: a team using the golden paths (`02`) on the IDP (`01`)
should get zone isolation, ABAC, minimization, audit, observability, and CI gates **for free** —
and it should be *hard* to build something that violates the invariants (governance automation `03`
rejects it). Security/privacy by design becomes the default, not a discipline each team re-derives.

## Documents (10 workstreams)

| WS | File | Scope |
|----|------|-------|
| 1 | [Internal Developer Platform](./01-internal-developer-platform.md) | Templates, scaffolding, local envs, secrets, provisioning, self-service |
| 2 | [Golden Paths & Reference Patterns](./02-golden-paths.md) | Approved patterns: REST, events, authN/Z, messaging, observability, persistence, files, infra, testing |
| 3 | [Engineering Governance Automation](./03-governance-automation.md) | Governance-as-code: conformance, policy-as-code, supply chain, SBOM, license, release gates |
| 4 | [AI Engineering Guardrails](./04-ai-engineering-guardrails.md) | Activity classification, provenance, approval, audit for AI-generated artifacts |
| 5 | [Developer Experience](./05-developer-experience.md) | Docs portal, API/event catalogs, arch repo, synthetic data, mocks, onboarding, playbooks |
| 6 | [Quality Engineering Platform](./06-quality-engineering-platform.md) | Reusable test frameworks across all test types + quality metrics |
| 7 | [Observability Platform](./07-observability-platform.md) | Logging, metrics, tracing, dashboards, alerting, SLOs — privacy-aligned |
| 8 | [SRE Practices](./08-sre-practices.md) | Incident, on-call, PIR, capacity, resilience, DR, runbooks (zero standing privilege) |
| 9 | [Engineering Metrics & Improvement](./09-engineering-metrics.md) | DORA + posture/debt/conformance/DX; team-improvement (not individual eval) |
| 10 | [Enterprise Engineering Knowledge Platform](./10-knowledge-platform.md) | Searchable, versioned, traceable knowledge graph |

## Non-negotiables (inherited, enforced by the platform)

Preserve approved architecture/governance/specs · security & privacy by design · Zero Trust ·
fail-closed for security-critical controls · **synthetic-data-only** until gates approved · enterprise
traceability (`../phase5/11`, `../phase6/01`) · **human approval for production-impacting decisions**.

## 🔒 Human-review boundaries (the factory never automates these)

Cryptography · anonymity mechanisms · evidence integrity · legal compliance · constitutional
interpretation · judicial procedure · production approvals · governance policy · procurement ·
cross-border data. **[FACT]** AI/automation *supports* these; it never replaces human authority.
The IDP's CI **HUMAN gate** enforces it for 🔒 code paths (`../design/07 §6`, `../phase6/10`).

## Reusability note

**[REC]** The factory is designed to be **reusable across future national DPI initiatives** — the
patterns, governance automation, and platforms generalize; only the NJTIP-specific invariants
(three zones, no-identity, chain of custody) are configured in, and can be re-configured for another
programme without rebuilding the factory.

*Read `01`→`10`.*
