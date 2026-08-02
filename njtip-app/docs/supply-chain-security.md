# Secure Software Supply Chain (Phase 10, Part 8)

SLSA-shaped build integrity: in-toto provenance attestation, signed builds and artifacts, container
and image provenance, dependency verification, reproducible builds, package integrity and release
verification (`src/supplychain/slsa.js`).

Gated by `APP-FIT-SUPPLY-CHAIN-ATTESTATION`. Live: `GET /api/supply-chain/attestations`.

> 🔒 Signing uses the platform's **synthetic** signing identity, clearly labelled. Production
> signing keys are human-built and HSM-custodied (Sigstore/cosign or an internal CA are the
> documented drop-ins). This module governs the **attestation structure and its verification** —
> the part that has to be right regardless of who holds the key.

## SLSA posture — claimed level 2, with the gaps stated

| Level | Requirement | Met | Evidence / why not |
|---|---|---|---|
| 1 | Provenance exists | ✅ | Build is fully scripted; provenance generated on every release |
| 2 | Signed provenance, hosted build, version-controlled source | ✅ | Provenance is signed; the container build is reproducible from the repo root |
| 3 | Hardened, isolated build platform, non-forgeable provenance | ❌ | An infrastructure commitment, not a code change — tracked in the migration roadmap |
| 4 | Hermetic, reproducible, two-person review | ❌ | Reproducibility is already demonstrable (zero third-party dependencies); hermeticity and review enforcement are organisational |

The claimed level is the level the **evidence supports**. Levels 3 and 4 are recorded as gaps with
reasons rather than claimed — a supply-chain posture that claims everything is the least credible
kind.

## Attestation structure

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "njtip-app", "digest": { "sha256": "…" } }],
  "predicateType": "https://slsa.dev/provenance/v1",
  "predicate": {
    "builder": { "id": "njtip-reference-builder" },
    "invocation": { "configSource": { "uri": "git+njtip", "digest": { "sha256": "…" } } },
    "materials": [ /* every dependency, pinned to a digest */ ],
    "metadata": { "reproducible": true, "completeness": { "parameters": true, "environment": true, "materials": true } }
  }
}
```

Verification recomputes the digest **over the statement** before checking the signature, so altering
any field — builder, source, materials — breaks verification even if the signature is intact. The
fitness function proves this by tampering with `builder.id` and requiring the verdict to flip.

## Release verification (fail-closed)

| Check | Blocks the release when |
|---|---|
| build-provenance | No attestation exists for this artifact digest |
| dependency-verification | Any dependency is unpinned or from an unapproved supplier |
| sbom-attestation | No SBOM accompanies the artifact |
| artifact-signature | The signature does not verify |
| container-signature | The image is unsigned |

`verifyRelease()` names every failed check. An unattested artifact is **not deployable** — and, as
everywhere, a verified supply chain does not authorize deployment; go-live is a recorded human
decision.

## Reproducible builds

`verifyReproducible(buildFn)` builds twice and compares digests. With zero third-party dependencies
the source digest is stable by construction, which is the strongest form of this property the
platform can hold — and the fitness function also proves the check can **fail**, by feeding it a
counter.
