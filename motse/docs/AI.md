# AI Integration Guide (Phase 2, WS8)

Every AI request flows through `AiRegistry.run(capability, task, actor)`, which
enforces — before ANY provider sees content:

1. media flagged `no_derivatives_no_training` → the whole task is rejected
   (§6.4 derivative ban, fail closed);
2. heritage refs must be public and live — restricted/withdrawn content never
   reaches a provider;
3. the invocation lands on the audit chain (`ai:<provider>`).

**Protected heritage is never processed.** This is structural: the gate runs in
the registry, so no provider — local or cloud — can be reached around it.

## Shipped providers

| Capability | Provider (default) | Nature |
| --- | --- | --- |
| knowledge_search | `local-tfidf` | real TF-IDF + cosine, in-process |
| summarization | `local-extractive` | frequency-scored extractive summary |
| tagging | `local-tagger` | keyword + known-entity extraction |
| recommendation | `local-cooccurrence` | item-item co-occurrence, popularity cold-start |
| translation | `local-phrase-translator` | curated tn↔en phrase table — returns `quality:"baseline"` and an honest `coverage_pct` |
| translation (cloud) | `cloud-translate` | GCP-shaped adapter, set `MOTSE_AI_TRANSLATE_KEY` |
| transcription (cloud) | `cloud-speech` | GCP-shaped adapter, set `MOTSE_AI_SPEECH_KEY` |

Local providers run in-process — no cultural content leaves the platform.
Cloud adapters are transport-injected (tests use fakes) and register only when
credentials exist; registering a cloud provider for a capability supersedes the
local one.

## API

```
GET  /v1/ai/capabilities          → [{capability, configured}]
POST /v1/ai/{capability}          → provider result (auth required)
```

Task shapes: `knowledge_search {query, documents[]}` ·
`summarization {text, max_sentences?}` · `tagging {text, max_tags?}` ·
`recommendation {interactions?, for_user?|for_item?, limit?}` ·
`translation {text, from, to}` · `transcription {audio_base64, language?}`.
Any task may carry `media_refs[]` / `heritage_refs[]` — they are what the
safety gate checks.

## Writing a provider

```js
const { AiProvider } = require('motse/src/ai/registry');
class MyAsr extends AiProvider {
  constructor() { super('my-asr', 'transcription'); }
  run(task) { /* return { transcript, confidence, language } */ }
}
platform.ai.register(new MyAsr());
```

Keep providers stateless per-call where possible, throw `INVALID_ARGUMENT` on
bad tasks, and never fetch platform data inside a provider — the caller passes
exactly what was cleared by the gate.
