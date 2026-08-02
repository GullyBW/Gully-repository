# Zero Trust Architecture (Phase 10, Part 1)

The platform's existing pieces — trust scoring, device registry, break-glass, policy-as-data,
RBAC/ABAC — are assembled into the named NIST SP 800-207 components, so "zero trust" is a structure
you can point at rather than an adjective (`src/iam/zero-trust-architecture.js`).

Gated by `APP-FIT-ZERO-TRUST-ARCHITECTURE`. Live: `GET /api/security/zero-trust` ·
`POST /api/security/zero-trust/decide`.

> **The rule: every access request is evaluated dynamically against live signals.** There is no
> implicit trust — not from network position, not from a prior decision, not from a role alone.
>
> **Phase 11 refinement ([ADR-0005](./adr/0005-authorization-decision-caching.md)):** the blanket
> "nothing is cached" rule is replaced by a stricter, checkable one — a decision may be reused only
> while *every* condition that produced it still holds. See **Authorization decision caching** below.

## Components

| Component | Role | Responsibility | It never… |
|---|---|---|---|
| **PAP** | Policy Administration Point | Author, version and publish policy. Publication requires a named human and a rationale. | …evaluates a request |
| **PDP** | Policy Decision Point | Evaluate every request against live signals; return a decision **and its reasoning trace**. | …reuses a decision whose conditions changed |
| **PEP** | Policy Enforcement Point (identity-aware proxy) | Enforce and audit the decision at the resource boundary. | …decides |
| **Workload identity** | Service / workload identity | SPIFFE-shaped ids with attestation and short-lived credentials. | …trusts an unattested workload |
| **Trust boundaries** | Microservice trust boundaries | Declared, mutually authenticated, action-scoped flows. | …permit an undeclared crossing |
| **Device trust** | Device posture | Contributes to the trust score. | …grant access on its own |

## Authorization decision caching (Phase 11, Part 1)

A permit issues a **signed, short-lived decision token**. It may be reused only when all eight of
these hold, **re-checked on every reuse**:

| # | Condition | Rejected as |
|---|---|---|
| 1 | Signature and digest verify | `tampered` / `bad-signature` |
| 2 | Unexpired (TTL ≤ 30s, refused at construction if longer) | `expired` |
| 3 | Issued under the **current** policy version | `stale-policy-version` |
| 4 | Session, credential and subject **un-revoked** | `revoked-session` / `revoked-credential` / `revoked-subject` |
| 5 | Identical **security context** (role, MFA, kind, zone, device, resource, geo) | `context-changed` |
| 6 | Same session | key miss |
| 7 | Action is cacheable at all | `action-never-cached` |
| 8 | No re-evaluation trigger fired | full evaluation |

Caching sits **after** revocation, continuous authentication and credential validation — all
time-dependent and cheap — so it only ever skips policy evaluation and trust scoring.

**Never cached:** `read-evidence`, `admit-evidence`, `record-governance-decision`, `break-glass`,
`cross-agency-share`. **Re-evaluation triggers:** sensitive action, elevated risk, device posture
change, geo denial, step-up required, explicit request.

**Revocation** (`RevocationRegistry`) is checked *first on every request*, before anything can
permit, and revoking a session or subject also drops their cached decisions. **Policy publication**
invalidates the entire cache. **Cross-region:** a region whose policy version lags the authoritative
version may not serve authorization at all.

> **A flaw worth recording.** The first implementation keyed the cache on the principal alone — so a
> cached investigator permit could be reused with `role: citizen`. `APP-FIT-ZERO-TRUST-ARCHITECTURE`
> caught it before commit. Condition 5 exists because of that, and is why the key binds a digest of
> the full security context rather than the request identity.

`allowCache: false` on any `decide()` call restores the Phase 10 behaviour exactly, and is the
rollback path in ADR-0005.

## The decision pipeline

Every request runs all six stages; the first denial wins and the trace shows which stages ran, so a
denial is explainable to the person who hit it.

```
1. continuous-authentication   principal present? authentication fresher than 30 min?
2. workload-identity           credential valid, unexpired, unrevoked, audience-matched?
3. trust-boundary              is this zone→zone crossing declared, mTLS, action-scoped?
4. least-privilege             RBAC matrix is the CEILING — policy may narrow it, never widen it
5. policy-decision             PAP-published policy, evaluated live (default-deny, deny-overrides)
6. continuous-authorization    live trust score vs the action's floor → permit / step-up / deny

   with, between 2 and 3:  revocation check (stage 0, always first) · policy-sync check ·
                           decision-cache lookup (only if no trigger fired)
```

## Identity trust model

| Identity kind | Form | Lifetime | Verified |
|---|---|---|---|
| Human principal | Role-coded principal id + session or federated token | Session TTL; **re-authentication forced after 30 minutes** | Every request |
| Workload / service | `spiffe://njtip/zone/{zone}/sa/{service}` | Credential ≤ **15 minutes** | Every request, at use |
| Device | Opaque device id + posture | Registry state, revocable | Every request |
| Reporter | **No identity at all** | — | The anonymity boundary is unaffected by any of this |

Short-lived credentials are enforced, not encouraged: a TTL beyond the maximum is **refused**, not
silently clamped — a caller asking for a long-lived token has a design problem worth surfacing.
Revoking a workload immediately invalidates every credential it issued.

## Trust boundaries

```
                     ┌──────────────── declared, mTLS, action-scoped ────────────────┐
                     ▼                                                               ▼
   ┌─────────────────────────┐   review-case, transition-case   ┌──────────────────────┐
   │  independent zone       │ ───────────────────────────────► │  executive zone      │
   │  intake · reporting     │                                  │  investigation       │
   └─────────────────────────┘                                  └──────────┬───────────┘
                                                                            │ admit-evidence
                                                                            ▼
                                                                 ┌──────────────────────┐
                                                                 │  judiciary zone      │
                                                                 └──────────────────────┘

   Any crossing not drawn above is DENIED by default — including independent → judiciary.
```

## Access policy registry

Policy lives at the PAP as data. `publish(policies, { by, rationale })` validates the set, increments
the version and records who published it and why. The PDP reads the current set on **every**
evaluation, so a policy change takes effect immediately with no code change and no redeploy — which
is also why publication requires accountability.

## What the fitness gate proves

`APP-FIT-ZERO-TRUST-ARCHITECTURE` verifies on every build that: a workload cannot register without an
attestation; an over-long credential TTL is refused; a credential expires, is audience-bound and dies
with its workload; an unauthenticated or stale request is denied *before* anything else; an
undeclared boundary crossing is denied; the RBAC ceiling holds; a sensitive action without step-up
MFA is not permitted; a workload request without a credential is denied; **two identical requests are
each evaluated** (nothing cached); a PAP publication without a named human is refused; a published
policy change reaches the PDP; and the PEP enforces and audits without leaking identity.
