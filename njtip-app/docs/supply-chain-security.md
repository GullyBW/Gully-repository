# Secure Software Supply Chain (Phase 10, Part 8 · Phase 11, Part 8)

SLSA-shaped build integrity: in-toto provenance attestation, signed builds and artifacts, container
and image provenance, dependency verification, reproducible builds, package integrity and release
verification (`src/supplychain/slsa.js`).

Gated by `APP-FIT-SUPPLY-CHAIN-ATTESTATION` and `APP-FIT-SUPPLY-CHAIN-TRUST`. Live:
`GET /api/supply-chain/attestations`.

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

---

# Advanced Supply Chain Security (Phase 11, Part 8)

## Keyless signing (Sigstore-shaped)

Keyless signing inverts the usual problem. Instead of protecting a long-lived private key forever,
you get a certificate that lives for **ten minutes**, bound to a workflow identity from an OIDC
issuer, and you publish the signature to an **append-only transparency log**. The key being
worthless afterwards is the security property, not a limitation.

```
keylessSign({ digest, identity, issuer })
  → certificate  (identity, issuer, notBefore, notAfter ≤ 10 min)
  → signature    over sha256(digest ‖ identity ‖ issuer ‖ validity)
  → logEntry     appended to the hash-chained transparency log
```

A TTL beyond the maximum is **refused, not clamped** — asking for a long-lived signing certificate
is a design problem worth surfacing.

### Verification, and why the order matters

| # | Check | Rejected as |
|---|---|---|
| 1 | Bundle payload matches its digest | `bundle was altered` |
| 2 | Signature verifies | `signature does not verify` |
| 3 | Identity is the **expected** workflow identity | `signed by 'X', expected 'Y'` |
| 4 | Issuer is the **expected** OIDC issuer | `issued by 'X', expected 'Y'` |
| 5 | Present in the transparency log, with a valid inclusion proof | `not present in the transparency log` |
| 6 | Logged **inside** the certificate validity window | `logged outside the certificate validity window` |

Checks 3 and 4 exist because a signature that verifies but was made by the wrong identity is
exactly what an attacker with access to a build runner can produce. Check 6 is the keyless model
itself: the certificate is *expected* to be expired by the time anyone verifies, and the log is what
proves the signature was made while it was live.

**Cosign-shaped image signing** uses the same bundle bound to an image digest.

## License policy

`allowed` MIT · Apache-2.0 · BSD · ISC · CC0 · Unlicense
`review-required` MPL-2.0 · LGPL · EPL-2.0 — weak copyleft, legal review before embedding
`forbidden` AGPL-3.0 · SSPL · BUSL · Commons-Clause · proprietary · **UNKNOWN**

An unknown license is forbidden, not tolerated. Nobody can accept terms they have not read.

## Dependency risk and package integrity

Risk per package, 0–100, from facts rather than judgement: unpinned (+30), unapproved supplier
(+20), forbidden license (+25) or review-required (+10), known vulnerabilities (+10 each, cap 30),
unmaintained > 2 years (+15) or ageing > 1 year (+7), no publication date (+10), transitive depth
> 3 (+5). Bands: `critical ≥ 60 · high ≥ 35 · moderate ≥ 15 · low`.

`packageIntegrity()` compares lockfile digests against what was actually fetched. A mismatch, a
missing digest, or a package fetched but absent from the lockfile is **critical** — there is no
benign explanation for a substituted package.

## Artifact trust score — and the deployment gate

| Component | Weight |
|---|---|
| Build provenance | 25 |
| Keyless signature (bound to **this** digest) | 20 |
| Transparency-log presence | 10 |
| Dependency risk acceptable | 15 |
| License compliance | 10 |
| SBOM · container signature · reproducible build · package integrity | 5 each |

**Threshold 80.** Below it the artifact is not deployable, and `verifyRelease()` fails closed. The
signature component checks the bundle signs *this* artifact digest — without that, a genuine bundle
could be pasted onto any digest and the score would not notice.

> **Phase 11 raised the bar for "fully attested."** A release that verified under Phase 10 now also
> needs a keyless signature in the transparency log, a demonstrated reproducible build and a
> lockfile that matches. The Phase 10 assertions were updated to supply that evidence rather than
> the gate being relaxed to accept less.

---

# Trusted Builders, Vulnerability Trends & Deployability (Phase 12, Part 8)

## Naming the builder

"Built by CI" means nothing if any runner can call itself CI. `registerBuilder()` records a builder
as trusted only with an **operating authority**, a **named human** and a **rationale** — trusting a
builder is a decision, and an undocumented one fails closed.

`verifyBuilder()` checks the four SLSA builder properties **separately**, so a partially hardened
builder reads as partially hardened rather than as untrusted-for-unclear-reasons:

| Property | What it buys |
|---|---|
| `hardened` | The build environment resists tampering by the build itself |
| `isolated` | Builds cannot influence one another |
| `ephemeral` | The environment is destroyed afterwards, so nothing persists between builds |
| `attestsProvenance` | The **builder** — not the build — signs the provenance |

An unregistered builder is not trusted, and an artifact of unknown origin is not deployable.

## Vulnerability trends

A count is a snapshot; the signal is the **direction** and whether anything is ageing past the
window it was given. `recordVulnerabilityScan()` is append-only by timestamp — a scan cannot be
overwritten, because a history you can edit is not a history.

`vulnerabilityTrend()` fits a slope over weighted exposure (`critical×4 + high×2 + medium`) and
reports `improving` · `flat` · `worsening`, plus SLA breach against the remediation window
(critical 7 days, high 30). The two are independent on purpose: **a flat count with a critical
finding open for 40 days is not a stable posture**, it is one unfixed critical and a chart that
cannot see it.

With fewer than two scans the direction is `insufficient-data` — a single point has no slope, and
drawing one is worse than saying so.

## Deployability

`deployabilityReport()` is the one verdict, fail-closed, every input traceable:

```
release verification (trust score ≥ 80, provenance, signature, transparency log, SBOM, licenses)
+ trusted builder
+ vulnerability posture
= deployable | blockers[]
```

Two blockers are worth calling out because they are the ones a permissive gate omits:

- **No builder identified.** An artifact of unknown origin is not deployable, whatever else verifies.
- **No vulnerability scan has ever been recorded.** *Zero scans is not zero findings.* An unscanned
  artifact must not read like a clean one.

A blocked report says `NOT DEPLOYABLE` in as many words, and `authorizes: false` throughout —
passing the gate makes an artifact deployable *on supply-chain grounds*. Deployment itself remains a
recorded decision by a named human authority.

Live: `GET /api/supply-chain/builders` · `POST /api/supply-chain/deployability` (admin).
