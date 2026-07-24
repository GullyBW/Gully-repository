# NJTIP — Kubernetes Reference Manifests (v1.2)

**Reference** manifests that realise the platform's non-functional requirements — high
availability, horizontal scaling, and **constitutional zone isolation** — on Kubernetes.
They deploy the zero-dependency app image built by [`../../Dockerfile`](../../Dockerfile).

> **Reference, not a turnkey production config.** Values (replica counts, resource limits,
> image registry, hostnames) are placeholders to review. **Secrets come from a secrets
> manager / External Secrets — never commit real secrets** (`secret.example.yaml` is a
> documented shape only). 🔒 The KMS/HSM and key custody remain human-built and are wired
> at the platform layer, not by these manifests. **Evidence ≠ authorization; go-live is a
> recorded human decision** (`npm run readiness`).

## What each file provides

| File | NFR | Purpose |
|---|---|---|
| `namespace.yaml` | Zone isolation | One namespace per constitutional zone (independent/executive/judiciary) + a shared app namespace, each labelled. |
| `configmap.yaml` | Config mgmt | Non-secret 12-factor config (mode, persistence, log level, OIDC issuer/audience). |
| `secret.example.yaml` | Secrets mgmt | **Shape only.** In production, replace with ExternalSecret / sealed-secret sourced from Vault/KMS. |
| `deployment.yaml` | HA | 3 replicas, non-root, read-only rootfs, liveness `/healthz`, readiness `/readyz`, resource requests/limits, topology spread. |
| `service.yaml` | Networking | ClusterIP fronting the pods. |
| `hpa.yaml` | Horizontal scaling | CPU/target autoscaling 3→12. |
| `pdb.yaml` | Resilience | PodDisruptionBudget keeps ≥2 pods during disruptions. |
| `networkpolicy.yaml` | Zone isolation | Default-deny ingress/egress; only the explicitly allowed cross-zone paths (which carry PII-free events via the broker) are permitted. |

## Apply (against a review cluster only)

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml -f secret.example.yaml   # replace secret with a real ExternalSecret
kubectl apply -f deployment.yaml -f service.yaml -f hpa.yaml -f pdb.yaml -f networkpolicy.yaml
```

## How these map to the invariants

- **No shared database across zones** — persistence is per-zone (`NJTIP_PERSISTENCE=sql` →
  per-zone Postgres schemas/roles, [`../../db/migrations/001_init.sql`](../../db/migrations/001_init.sql)).
  A zone's DB role cannot read another zone's schema.
- **PII-free cross-zone traffic** — the only permitted cross-zone egress is to the broker, which
  refuses identity/content by construction (app fitness `APP-FIT-PII-FREE-EVENTS`).
- **Fail-closed** — default-deny NetworkPolicy; readiness/liveness gate traffic; the container only
  starts if the assurance gate passes (see the Dockerfile).
