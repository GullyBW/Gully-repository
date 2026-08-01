# Architecture Baseline v1.7 (FROZEN)

**Status:** BASELINED · **Supersedes:** `ARCHITECTURE-BASELINE-v1.0.md` (which remains in force for
every invariant it froze) · **Change control:** ADR-only (`architecture-governance.md`) ·
**Verification:** the Digital Engineering Twin must stay green for any change to anything below.

The architecture reached sufficient maturity at v1.7. **v1.8 added capabilities inside the frozen
structure; v1.9 adds no architecture at all** — it stabilizes, integrates and operationalizes what
exists. This baseline is therefore the architecture-of-record for the platform as it stands, and the
reference against which every future change is judged.

> **The rule after this baseline:** no new high-level government domain and no new major bounded
> context is introduced unless *implementation* demonstrates a measured architectural need. Future
> value comes from depth — integration, usability, operability, governance maturity — not breadth.

## What is frozen

### 1. Constitutional invariants (unchanged from v1.0, non-negotiable)

Three non-collapsible data zones · no reporter identity collected or stored · operator-in-threat-model
with M-of-N custody · default-deny with zero standing privilege · envelope encryption and a
hash-chained chain of custody · append-only anchored audit · PII-free cross-zone events · dual-control
break-glass · human accountability for every authoritative decision. Enforced by the Twin's 14
architecture fitness functions; changing any of them requires an Oversight Board super-majority.

### 2. The bounded-context map

The 29 bounded contexts plus the composition root recorded in
[`context-map.md`](./context-map.md) and enforced as data by `src/architecture/context-map.js`. Frozen
elements: each context's **purpose**, its **module ownership**, its **declared dependencies**, the
**relationship pattern and mechanism** of every interaction, the **anti-corruption layers**, and the
four **shared kernels**. Adding, removing, merging or re-pointing a context is an ADR-level change and
fails `APP-FIT-CONTEXT-MAP` until the map is updated in the same commit.

### 3. Ports and the composition root

Every production concern sits behind a **stable port**; `src/app.js` is the only place a synthetic
reference driver may be exchanged for a production driver. Business logic never names a driver. An
unbundled production driver **fails closed**. Ports frozen at this baseline: persistence, cache,
object store, messaging, KMS/HSM, secrets, certificates, identity/OIDC, search, notifications,
outbound integration.

### 4. Integration contracts

The API contracts, event contracts, canonical data schemas, canonical error model, authentication and
authorization declarations recorded in [`integration-contracts.md`](./integration-contracts.md) and
enforced by `src/contracts/integration-contracts.js`. **Interfaces are stable while internals evolve:**
a breaking change requires a new major version plus a documented dual-run and sunset.

### 5. Assurance model

The Twin is permanent. Architecture violations are failing tests: `npm run twin` runs
**twin + application + infrastructure** fitness as one gate, the container refuses to start unless it
passes, the default workflow must be formally proven, the access-control policy set must validate, and
no deployment may bypass supply-chain governance.

### 6. Governance and accountability

Institutional ownership for every context — responsible authority, approving authority, operational
owner, data steward, governance board, escalation path — recorded in
[`governance-ownership.md`](./governance-ownership.md) and enforced by `APP-FIT-GOVERNANCE-OWNERSHIP`,
including structural separation of duties (nobody approves their own subsystem).

## What is explicitly NOT frozen

Implementation *inside* a context (algorithms, data structures, storage engines, driver internals),
user interface and interaction design, dashboards, new features that compose existing contexts,
performance work, test depth, documentation, and the delivery roadmap. These evolve freely provided
the Twin stays green and published contracts hold.

## Change control

```
Measured need from implementation
  → ADR (docs/adr/000-template.md)
  → Twin green (twin + app + infra fitness)
  → context map + contracts updated in the SAME commit
  → ARB review  [constitutional invariant? → Oversight Board super-majority]
  → Accepted → merge
```

Backward compatibility is preserved or a deprecation path (dual-run + sunset) is documented. Drift
between this baseline and the code is detected by `APP-FIT-CONTEXT-MAP`,
`APP-FIT-INTEGRATION-CONTRACTS` and `INFRA-FIT-DRIFT`, not by review alone.

## Evidence ≠ authorization

Nothing in this baseline — no fitness result, evidence package, readiness score, maturity grade,
dashboard or projection — authorizes a deployment. Go-live is a recorded decision by a named human
authority acting through the board named in the ownership model.
