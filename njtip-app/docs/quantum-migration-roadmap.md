# Quantum Migration Roadmap (Stabilization Part 11)

The platform must be able to migrate to post-quantum cryptography **without an architectural
redesign**. That is achieved by algorithm independence: selection is *data* in the crypto policy
registry, and no other module is permitted to name an algorithm.

Verified by `APP-FIT-CRYPTO-ALGORITHM-INDEPENDENCE` (`src/adapters/quantum-transition.js`,
`src/adapters/crypto-agility.js`). Live view: `GET /api/admin/quantum-transition`.

> 🔒 **Interface-declared only.** No post-quantum cryptography is implemented here and no key
> material is generated. Production keys are human-built under ISRB sign-off. Cutover is a recorded
> human decision — readiness never authorizes it.

## Algorithm independence (the load-bearing guarantee)

`algorithmIndependence()` scans the source tree and fails the build if any module outside
`adapters/crypto-agility.js` and `adapters/quantum-transition.js` **selects** an algorithm — that is,
contains a quoted literal whose entire value is an algorithm identifier (`ed25519`, `ecdsa-p256`,
`rsa-2048`, `ml-dsa-*`, `ml-kem-*`, `x25519`, `dilithium`, `kyber`). Prose in comments and
documentation strings is not selection; the scan strips comments before matching.

Current result: **independent, zero leaks.** Every context reaches cryptography through
`encrypt`/`decrypt`/`sign`/`verify` ports and knows no algorithm at all.

## Abstraction layers — what each may know

| Layer | Module | Knows | Never knows |
|---|---|---|---|
| Policy | `CryptoPolicyRegistry` | permitted / deprecated / candidate algorithms per purpose | key material, ciphertext |
| Provider | `CryptoProvider` | the primary algorithm and the legacy set accepted during overlap | *why* an algorithm was chosen — that is policy |
| Key lifecycle | `KeyLifecycleGovernance` | key **references** and their state (active/rotating/retired) | 🔒 key material — it never leaves the HSM |
| Migration | `QuantumMigrationRegistry` | phase, compatibility and readiness per migration | how to perform cryptography |
| Domain | every bounded context | `encrypt`/`decrypt`/`sign`/`verify` through a port | any algorithm name at all |

## Migration assumptions

Written down because an unstated assumption is the usual reason a cryptographic migration plan fails
years later.

| Assumption | Consequence for the design |
|---|---|
| **Harvest now, decrypt later** — long-lived confidential material may already be captured | Confidentiality migrates before authentication; key establishment moves first |
| **Standards will change** after first adoption | No algorithm named outside the policy registry; selection stays data |
| **Hybrid first** — a PQ algorithm alone is not yet trusted for sole reliance | Hybrid is a mandatory phase; you may not advance past it until hybrid verification is tested |
| 🔒 **Human key custody** under ISRB sign-off | The registry governs policy and phase only; it never generates or holds key material |
| **Long retention** — evidence outlives several crypto generations | Verification accepts legacy algorithms for the full retention window; re-signing is planned, not assumed |
| **Partners migrate on their own timelines** | Overlap windows are governed per interface; a partner cannot force a downgrade |

## Compatibility requirements

Any future implementation must satisfy all six for migration to be possible at all:

1. **Algorithm independence** — business logic never names an algorithm.
2. **Dual verification window** — during overlap, artifacts signed under the legacy *or* the new
   algorithm verify (`CryptoProvider.accepts`).
3. **Algorithm recorded with the artifact** — verification never guesses which algorithm applies.
4. **Larger keys and signatures tolerated** — PQ size growth must not require a schema change.
5. **Policy-driven selection** — promotion and deprecation are data changes, not redeploys.
6. **Fail-closed on an unknown algorithm** — planning a migration to a non-post-quantum or unknown
   target throws.

## Transition phases

| # | Phase | Intent | Exit criterion |
|---|---|---|---|
| 1 | `assess` | Inventory every cryptographic use and its retention horizon | Every purpose has a named PQ candidate |
| 2 | `hybrid-deploy` | Deploy classical + PQ together; verify both | Hybrid verification tested (`markHybridTested`) |
| 3 | `migrate` | Make PQ primary; keep classical valid for verification | All new artifacts produced under the PQ primary |
| 4 | `retire-classical` | Remove classical from the permitted set | No artifact inside the retention window verifies only under classical |

Advancing from `hybrid-deploy` to `migrate` without tested hybrid verification is **refused**.

## Current posture

| Purpose | Active | PQ candidate (interface-declared) |
|---|---|---|
| signature | `ed25519`, `ecdsa-p256` (`rsa-2048` deprecated) | ML-DSA |
| key establishment | `x25519` | ML-KEM |

No migration is in flight. The roadmap exists so that when the standards settle, the change is a
policy update and a governed phase transition — not a redesign.
