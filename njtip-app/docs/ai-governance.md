# AI Governance Framework (Phase 10, Part 9 · Phase 11, Part 9)

Model, dataset and prompt registries; human approval; explainability; bias monitoring;
hallucination safeguards; model versioning; inference audit trail; risk classification; human
override; evidence preservation (`src/ai/ai-lifecycle.js`).

Gated by `APP-FIT-AI-LIFECYCLE` and `APP-FIT-AI-ASSURANCE`. Live: `GET /api/ai/lifecycle` ·
`GET /api/ai/pending-decisions` · `POST /api/ai/inferences/{id}/decide` · `GET /api/ai/monitoring`.

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

---

# Comprehensive AI Governance (Phase 11, Part 9)

## Prompt approval workflow

```
register → submitForApproval(by, rationale, evaluation) → approve / reject
```

Two structural rules, both enforced rather than documented:

- **The owner may never approve or reject their own artifact.** An approval you can grant yourself
  is a formality, not a control.
- **A prompt edited after submission cannot be approved.** The submission records the text digest
  the reviewer actually saw; if it changed, approval is refused. Registering a new version resets
  approval, as it always did — approving v1 never approves v2.

A rejected high-risk artifact must be **resubmitted** before it can be approved.

## Dataset lineage and quality

A training dataset must declare its **sources**, its **lawful basis**, and that it is
**synthetic-only** — all three, or the lineage record is refused. Quality is measured across five
dimensions (completeness, balance, label accuracy, representativeness, freshness) against a floor of
**0.8**, and *partially* measured is not measured: an unscored dimension fails the dataset.

`trainingDataAcceptable(model)` is the gate: every declared dataset must be **registered, traced,
independently approved and within quality**. It lives in the module rather than in a checklist so it
cannot be skipped, and estate-level `validate()` reports a model whose training data fails it.

## Confidence thresholds

| Risk class | Minimum confidence |
|---|---|
| minimal | — |
| limited | 0.60 |
| high | **0.80** |

Below the floor the output is **withheld**, not shown with a caveat. A low-confidence suggestion
still anchors the person reading it, and an anchor you did not intend to set is worse than no
suggestion at all — the matter goes to a human with nothing attached.

## Hallucination monitoring

Grounding is recorded per inference, per model — a rate averaged across models tells you nothing
about which one to stop using. Above **5%** ungrounded the model is `elevated`; above 15%,
`critical`.

> **An under-sampled rate reports `null`, not "fine."** Below 20 samples there is no rate and no
> verdict. A number you cannot trust must not read as safe.

## Drift detection

Population Stability Index between a baseline period and the latest, over recorded feature
distributions. Deterministic, append-only (a period cannot be rewritten), with the standard bands:

```
PSI < 0.10   stable        no action
PSI 0.10–0.25 moderate     investigate; schedule re-evaluation
PSI > 0.25   significant   suspend the model and re-approve it against current data
```

PSI weights *proportional* change, so a bucket collapsing 0.50 → 0.05 contributes more than one
rising 0.20 → 0.80. The report orders contributions by magnitude and names the largest.

## Monitoring posture

`monitoringPosture(model)` combines hallucination rate, drift and training-data acceptability.
Significant drift or a critical hallucination rate sets `requiresReApproval: true` — a model must
not keep running on an approval granted against data that no longer exists.

As everywhere in this module: `advisoryOnly: true`, `authorizes: false`. Monitoring can **require**
a re-approval. It can never grant one.

---

# Fairness, Calibration & Retirement (Phase 12, Part 9)

## The platform will not choose a fairness criterion for you

Demographic parity, equal opportunity, equalised odds and predictive parity are **mutually
incompatible** in general — outside degenerate cases you cannot satisfy them simultaneously. A
module that reports "fair: true" without saying *which* of them it checked has hidden the only part
of the question that carries consequences for real people.

So `FAIRNESS_CRITERIA` declares all four with what each one buys and when it applies:

| Criterion | Equalises | Suits when |
|---|---|---|
| `demographic-parity` | Outcome rates across groups | The outcome should not depend on group membership at all |
| `equal-opportunity` | True-positive rates | Missing a real case matters more than a false alarm |
| `equalised-odds` | True-positive **and** false-positive rates | Both kinds of error carry consequences for the person |
| `predictive-parity` | Precision | The output is acted on directly by a human who cannot see the group |

`declareFairnessCriterion()` requires a named human and a rationale, and refuses an unknown
criterion. Until one is declared, `fairnessReport()` returns `assessed: false` — *"fair" means
several different things and the platform will not pick one silently*.

Once declared, fairness is assessed against **that** criterion and **that** threshold. The same 0.4
disparity is unfair at a 0.2 threshold and acceptable at 0.5 — which is precisely why the threshold
is a recorded decision rather than a constant.

## Confidence calibration

Every confidence floor elsewhere in this module — the advisory threshold, the hallucination rate,
the human-review trigger — assumes that a model saying 0.9 is right about 90% of the time. A model
that says 0.9 and is right 60% of the time is not "usually right"; it is **miscalibrated**, and it
makes every one of those floors useless.

`calibrationReport()` bins observations into confidence buckets and reports, per bucket, mean
confidence against observed accuracy, plus the **expected calibration error** across all of them.
Two design choices:

- **Overconfidence is named separately from ECE.** It is the dangerous direction; underconfidence
  wastes a model, overconfidence gets a wrong answer acted on.
- **Too few observations produces `assessed: false`,** not a curve. A calibration curve drawn from
  too few points is a shape, not a measurement.

## Retirement

A model that is no longer used but was never retired keeps its approval — and an approval nobody
revisits is how a superseded model quietly stays in production.

`retire()` requires a named human and a rationale, optionally records what supersedes it, and is
irreversible. A retired artifact:

- **loses its approval** — `isApproved()` returns false with the retiring authority named;
- **cannot be inferred from** — `infer()` fails closed;
- **does not break estate validation.** A retired high-risk artifact is not an unapproved one, and
  conflating the two would push operators to leave things approved rather than retire them.

Live: `GET /api/ai/fairness` (oversight-board) · `GET /api/ai/calibration` (admin).
