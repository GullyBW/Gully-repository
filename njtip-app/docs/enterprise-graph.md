# Enterprise Knowledge Graph (Phase 12, Part 20)

`src/graph/enterprise-graph.js` extends the graph bounded context from the *investigation* graph to a
graph of the **platform itself**.

Gated by `APP-FIT-ENTERPRISE-GRAPH`. Live: `GET /api/graph/enterprise` ·
`GET /api/graph/enterprise/impact/:key`.

## Why this is not `KnowledgeGraph`

`src/graph/graph.js` is the investigation graph: undirected, typed to
Person/Organization/Evidence/…, and it refuses identifying properties on add. Widening its type set
to admit ADRs and bounded contexts would let investigation code create architecture nodes and vice
versa — a coupling defect dressed up as reuse. This is a separate graph in the same bounded context:
directed, with its own types, and holding no personal data at all because none of its node kinds is a
person.

## Thirteen node kinds, each read from a registry

| Kind | Read from |
|---|---|
| `adr` | `docs/adr/*.md` |
| `bounded-context` | `src/architecture/context-map.js` |
| `service` | `src/observability/telemetry.js` |
| `api` | `src/contracts/integration-contracts.js` |
| `risk` | `src/security/threat-model.js` |
| `control` · `evidence` | the fitness identifiers and results that actually ran |
| `policy` | `src/twin2/multi-region.js` |
| `dataset` | the governed data estate |
| `metric` | `src/observability/business.js` |
| `owner` | `src/governance/ownership.js` |
| `readiness-dimension` | `src/assurance/evidence-confidence.js` |
| `compliance-obligation` | `src/legislation/registry.js` |

Built on each construction, never maintained beside them; the composition root builds one per call
for that reason. Two graphs from the same registries produce the same digest.

**Every edge kind states what it means.** An edge whose meaning is not written down is a line on a
diagram, and a graph of those answers questions confidently and wrongly. `_link()` refuses a
relationship it has no declared meaning for.

`governs` and `verified-by` are not redundant: they are the same relationship read for two different
questions — *"what does this control cover?"* and *"what shows this context is what it claims?"* —
and traceability follows only the second.

## Traceability

> A graph where everything is connected to everything proves nothing.

So `traceability()` asks a **narrow** question of each node: is there a path from here to a piece of
**evidence**, meaning an executable check that actually ran and **held**? Consequences:

- **A path to a failing check is not traceability** — it is a demonstrated defect. `requireHolding`
  defaults to true and the note says so.
- **Untraceable entities are named**, per kind and individually. That is the useful output; a green
  tick over the whole graph would not be.
- **Aggregation is to the weakest kind**, tie-broken on kind name so the answer is deterministic.
- **A graph with no evidence traces nothing** — coverage 0, not "complete".

As composed, coverage is ~0.92. The two kinds at zero are a real finding, not a bug: `service` and
`metric` reach no executable check, because the platform's controls are attached to **bounded
contexts**, not to individual services. An obligation mapping to no control also stays untraceable —
which is precisely the Part 19 compliance gap, surfacing here as well.

## Impact analysis

`impactOf(key)` walks **both** directions:

| Field | Question it answers |
|---|---|
| `dependsOn` | What is this standing on? |
| `dependents` | What breaks if this changes? |

A single-direction traversal quietly answers only one of them. Depth is bounded and the bound is
reported; the caveat states that traversal is over **declared** edges, so the result is a lower
bound. An entity the graph does not contain returns `known: false` with *"absence of a node is not
absence of the thing"* rather than an empty result that reads like safety.
