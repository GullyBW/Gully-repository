# ADR-0005: Replace "nothing is cached" with signed, revocable, policy-versioned authorization decisions

- **Status:** Accepted · **Date:** 2026-08-02
- **Deciders:** Chief Architect, Cybersecurity Architect, SRE Lead, ARB, ISRB
- **Review required:** ARB + ISRB (this changes the authorization path)

## Context

Phase 10 shipped a Zero Trust PDP with a deliberately absolute rule: **no decision is ever cached**.
That rule is correct about the threat — a cached decision that outlives its justification is a
privilege escalation waiting to happen — but it is not scalable, and it is stricter than the
guarantee actually requires. Full evaluation on every request means policy evaluation and trust
scoring run for every read of a case list, which at national volume is real cost for no additional
security.

The security property that matters is narrower and checkable: **a decision may only be reused while
every condition that produced it still holds.**

## Decision

Replace the blanket rule with short-lived, cryptographically signed authorization decisions, reusable
only when **all** of the following hold, re-checked on every reuse:

1. **Signature and digest verify** — tampering with any field invalidates the decision.
2. **Unexpired** — TTL ≤ 30 seconds, refused at construction if longer.
3. **Policy-current** — the decision names the policy version it was issued under; publishing a new
   policy set invalidates the whole cache immediately.
4. **Un-revoked** — session, credential and subject revocation are checked **first on every request**,
   before anything can permit.
5. **Same security context** — the cache key binds role, MFA assurance, subject kind, zone, device and
   resource; a different context is a different decision.
6. **Session-bound** — a decision issued for one session is not reusable by another.
7. **Not a sensitive action** — `read-evidence`, `admit-evidence`, `record-governance-decision`,
   `break-glass` and `cross-agency-share` are never served from cache, whatever the TTL says.
8. **No re-evaluation trigger** — elevated risk, device posture change, geo denial, step-up
   requirement or an explicit request forces full evaluation.

Caching sits **after** revocation, continuous authentication and credential validation — all
time-dependent and cheap — so it only ever skips policy evaluation and scoring.

Cross-region: a region whose policy version lags the authoritative version **may not serve
authorization at all**.

## Consequences

- **Backward compatibility:** preserved. `pdp.decide(request)` keeps its signature; the second
  argument (`{ allowCache }`) is optional and `allowCache: false` reproduces the Phase 10 behaviour
  exactly. Every existing test and fitness function still passes.
- **Twin impact:** `APP-FIT-ZERO-TRUST-ARCHITECTURE` updated (the "nothing cached" assertion becomes
  "no request bypasses the PDP, and an unseen context is always fully evaluated"); new
  `APP-FIT-ZERO-TRUST-CACHE` covers all eight conditions plus revocation, replay and policy sync.
- **Threats/risks:** reduces TH-AVAILABILITY (evaluation cost at load). TH-PRIV-ESCALATION is held
  by conditions 4 and 5 — and the first implementation of this ADR **failed** that check: keying the
  cache on the principal alone let a cached investigator permit be reused with `role: citizen`. The
  fitness function caught it before commit, which is why condition 5 is stated as a binding of the
  full security context rather than "the request".
- **Trade-offs (named):** the reasoning a reviewer must do is larger — "nothing is cached" is easier
  to audit than eight conditions. Mitigated by making all eight executable and by keeping
  `allowCache: false` available as the simple mode for any path that wants it.

## Alternatives considered

- **Keep "nothing cached"** — rejected: it does not scale, and the guarantee it buys is available
  more cheaply.
- **Cache with a plain TTL, no signature or policy version** — rejected: a decision that survives a
  policy change or a revocation is precisely the failure this must prevent.
- **Cache negative decisions too** — rejected: a denial that outlives the condition that caused it
  locks a legitimate user out, and re-evaluating a denial is cheap.
- **Distributed cache shared across regions** — rejected for now: it would make revocation latency a
  cross-region concern. Regions synchronise **policy**, not decisions.

## Business justification

Anonymous reporting must stay available under national load, and every request currently pays for a
full policy evaluation and trust scoring. Caching the part that provably cannot have changed removes
that cost without weakening the guarantee — which is the only way to scale an authorization path that
a constitutional service depends on. The alternative (raising latency objectives) would trade a
citizen-facing guarantee for an engineering convenience.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A cached decision outlives its justification | medium | **critical** | Eight conditions re-checked on every reuse; revocation checked first; 30s TTL ceiling |
| Cache key omits an attribute that changes the outcome | **realised in development** | critical | Key binds the full security context digest; the fitness function proved the flaw and now guards it |
| A decision survives a policy change | low | critical | Publication invalidates the cache wholesale and the token carries its policy version |
| Reviewers can no longer audit the rule by reading it | medium | medium | All eight conditions are executable; `allowCache: false` preserves the simple mode |
| Cross-region cache divergence | low | high | Regions synchronise policy, never decisions; a lagging region may not serve authorization |

## Performance impact

Positive and the reason for the change: repeated requests in the same security context skip policy
evaluation and trust scoring. Revocation, authentication freshness and credential validation still
run on every request, so the saving is bounded and the security-relevant work is not skipped. Latency
objectives in the SRE release gate would catch any regression.

## Security impact

Net neutral-to-positive, and ISRB sign-off is required. The reuse conditions are collectively
stricter than "evaluate every time" in one respect: revocation is now checked **before** anything can
permit, on every request, which was not previously guaranteed as an ordered first step. No control
was relaxed; sensitive actions remain fully evaluated always.

## Operational impact

Operators gain three new levers — session/credential/subject revocation, cache statistics, and
cross-region policy sync state — and one new obligation: a region added to the estate must be
registered with the policy sync registry or it cannot serve authorization. Runbook updated.

## Compliance impact

None negative. Authorization soundness, separation of duties, zone confinement and step-up MFA remain
formally verified and are unaffected by caching, because a cached decision is only reused within an
identical security context.

## Rollback strategy

Two levels, both immediate: pass `allowCache: false` at the call site to restore Phase 10 behaviour
for a specific path, or construct the platform without a cache (`makeZeroTrust` wires one by default;
`PolicyDecisionPoint` accepts `cache: null`) to disable it entirely. No data migration, no schema
change, no consumer impact.

## Migration strategy

Delivered in one commit with the fitness functions that guard it. Existing callers are unaffected —
`decide(request)` behaves identically except that a repeat within 30 seconds in an unchanged context
returns `stage: 'cached'`. Regions are registered with the sync registry as they are provisioned.

## Estimated implementation cost

Reference implementation: under a day, including the flaw found and fixed. Production realisation
adds the cost of a shared revocation signal across instances (the reference registry is in-process);
estimated at 1–2 engineer-weeks alongside the identity migration item.

## Success metrics

| Metric | Baseline | Target | Where measured |
|---|---|---|---|
| Full evaluations per repeated request in an unchanged context | 1.0 | < 1.0 | `pdp.fullEvaluations()` vs `decisionsEvaluated()` |
| Requests bypassing the PDP | 0 | **0** | `APP-FIT-ZERO-TRUST-ARCHITECTURE` |
| Cached decisions surviving revocation | — | **0** | `APP-FIT-ZERO-TRUST-CACHE` |
| Cached decisions surviving a policy change | — | **0** | `APP-FIT-ZERO-TRUST-CACHE` |
| Sensitive actions served from cache | — | **0** | `APP-FIT-ZERO-TRUST-CACHE` |

## Decision owner

**National Identity Authority** (responsible for `identity-access`), approved by the **ISRB**.
Operational ownership sits with Platform Security Operations; escalation follows the ownership model.

## Approval history

| Date | Body | Outcome | Basis |
|---|---|---|---|
| 2026-08-02 | ARB | Accepted | Backward compatible; no context or contract changed; gate green |
| 2026-08-02 | ISRB | Sign-off | Revocation-first ordering, signed decisions, 30s ceiling, sensitive actions never cached |

## Human review

Publishing a policy set, revoking a session, credential or subject, and accepting any residual risk
from this change remain human decisions. Nothing in this ADR authorizes a deployment.
