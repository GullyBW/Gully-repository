# AI Governance Framework (Phase 10, Part 9)

Model, dataset and prompt registries; human approval; explainability; bias monitoring;
hallucination safeguards; model versioning; inference audit trail; risk classification; human
override; evidence preservation (`src/ai/ai-lifecycle.js`).

Gated by `APP-FIT-AI-LIFECYCLE`. Live: `GET /api/ai/lifecycle` · `GET /api/ai/pending-decisions` ·
`POST /api/ai/inferences/{id}/decide`.

> **The invariant, enforced structurally rather than promised:** AI output is an input to a human
> decision and nothing else. **There is no `apply()`.** The only exit from an inference is a
> recorded human decision, and a human may always override — including after acceptance.

## Risk classification

| Class | Human approval | Bias monitoring | Explainability | Scope |
|---|---|---|---|---|
| `minimal` | — | — | — | No effect on any person or decision |
| `limited` | ✅ | — | ✅ | Informs staff workflow, not case outcomes |
| `high` | ✅ | ✅ | ✅ | Touches a case, a person or a governance outcome |
| `prohibited` | — | — | — | **Registration is refused** |

## Prohibited uses — named, not merely unimplemented

| Use | Why |
|---|---|
| `automated-case-decision` | A case outcome is a human decision. No model may produce one. |
| `reporter-identification` | Any attempt to identify an anonymous reporter is prohibited absolutely. |
| `predictive-policing` | Predicting individual criminality is outside every permitted purpose. |
| `social-scoring` | Scoring persons or communities is prohibited. |
| `emotion-inference` | Inferring emotional state from case content is prohibited. |

A prohibition that exists only as an omission is one feature request away from gone.

## The inference path

```
register(model|dataset|prompt)   → risk class, purpose, owner; identity fields refused
approve(by, rationale)           → required above minimal risk, PER VERSION
infer(...)                       → refused unless: approved · explained (if the class requires) ·
                                   identity-free input · approved prompt · named requester
                                   → status: advisory, authorizes: false
decide(by, decision, rationale)  → the ONLY exit. accepted | rejected | modified
override(by, rationale)          → always available, including after acceptance
```

**Approval does not inherit across versions.** Registering v2 of a model resets its approval, because
"we approved the model" is not the same statement as "we approved this model".

## Evidence preservation

Every inference is fixed by a digest over its model, version, prompt, input summary, output and
explanation. `verifyEvidence()` recomputes it — altering the output after the fact breaks the record,
and the fitness function proves that by tampering with one.

## Bias monitoring and hallucination safeguards

Bias is observed over **non-identifying** group aggregates with small-sample suppression; the report
gives disparity, the worst-served group and how many groups were suppressed — as a signal for human
review, never a conclusion about causation.

Grounding checks withhold output that cites no evidence, falls below the confidence floor, or uses
terms outside a permitted vocabulary. Withheld output never reaches the human queue as a
"suggestion", because a suggestion is exactly how an ungrounded output becomes a decision.
