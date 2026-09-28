# Local AI Review: design note

Status: implemented on branch `feat/local-ai-review`, not released; see
[local-ai-implementation-report.md](local-ai-implementation-report.md) for evidence and
remaining release blockers. This note records the boundaries and decisions; [review-mode.md](review-mode.md) remains the user-facing
Review documentation.

## Promise

> Fix my mistakes without changing my voice. Rewrite only when I ask. Keep my text on my device.

Local AI enriches the **existing Review panel** with an optional on-device model
(Transformers.js on ONNX Runtime Web, WebGPU). It never runs while typing: popup and inline predictions stay
Presage-only in every build.

## Two modes

| Mode              | Starts                                                             | Output                                                                                                       | Applies                                                                   |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Correct (default) | automatically when a Review opens, once setup is complete          | conservative spelling/grammar/punctuation findings merged into the existing list/card, provenance "Local AI" | one finding at a time, or "Apply selected AI corrections" after a preview |
| Rewrite           | only from the panel's mode switch + Generate, in an explicit style | one proposal for the scope, shown as a diff                                                                  | only via Apply on a complete, validated proposal                          |

A new Review always opens in Correct. AI findings never enter **Fix all safe**.

## Defaults and consent

| Concept                                           | Storage key                  | Default                                 |
| ------------------------------------------------- | ---------------------------- | --------------------------------------- |
| Preference "Local AI corrections in Review"       | `localAiReviewEnabled`       | on (absent = on; an explicit off stays) |
| Selected tier                                     | `localAiReviewTier`          | `standard`                              |
| Download consent (set only by the Install action) | `localAiReviewConsent`       | absent                                  |
| One-time panel offer declined                     | `localAiSetupOfferDismissed` | absent                                  |
| Cached artifacts / hardware support               | not stored; probed           | —                                       |
| AI autocomplete routing                           | none in production           | forced off regardless of old settings   |

The legacy predictor keys (`aiPredictorEnabled`, `aiModelId`, …) are never read as
consent, never migrated into the new keys, and never enable anything in production.
Nothing downloads, loads a model or creates the runtime host at browser start or when
Review opens without consent. Deleting a model keeps consent/preference but never
re-downloads silently; the user must press Install again.

## Runtime host

- **Chrome/Edge:** an offscreen document (`local-ai/offscreen.html`, reason `WORKERS`)
  hosting one dedicated worker that owns the only Transformers.js model. Needs the `offscreen`
  permission (no install-time warning). The background creates it only when a Review opens
  with consent + preference on, or for an explicit install/delete/probe, and closes it as
  soon as the host reports `idle`.
- **GPU memory is held only while a Review with Local AI is open.** When the last Review
  port closes, or an install ends (success, failure or cancel) with no Review open, the
  host releases the GPU at once, with no grace period: running work is cancelled and
  allowed to settle, the model is disposed, the worker is terminated (a disposed model may
  leave its WebGPU device alive; terminating the worker frees it), and the host sends `idle` so
  the background closes the document. A Review that stays open without jobs releases the
  same way after 5 minutes but keeps the document. The next Review starts a fresh worker
  and loads the model from cache, a cold load of about 10 s for Gemma 4 E4B on an M2 Max. An ENSURE_HOST that races
  a close waits for it and recreates the document (single-flight).
- **Firefox:** no offscreen API; the feature reports `host-unsupported`, and Review stays
  exactly as today. Not validated for WebGPU.
- Transport: the content script opens a `chrome.runtime` **port** straight to the
  offscreen document (`ft-local-ai-review`). The port is the session: every job is bound
  to its port and `port.sender` (tab/frame); a disconnect cancels its work. The background
  is the settings/consent authority and talks to the offscreen document over its own port
  (`ft-local-ai-host`, sender URL verified). Offscreen documents have no `chrome.storage`,
  so the background pushes `configure`.
- Lifecycle state machine: `unconfigured → checking-support → download-required →
downloading → loading → ready ⇄ generating → unloading`, plus `unavailable` / `error`.
  Single-flight load keyed by model id; an epoch disposes a load that completes after
  disable/unload/model switch. Cancellation interrupts through Transformers.js's
  `InterruptableStoppingCriteria` (stops at the next token; the prompt prefill cannot be
  interrupted, so a cancel settles in about 1.3–1.5 s) and waits for the generation to
  settle; if it does not settle within 3 s, the worker is terminated and recreated. One
  generation at a time, a bounded queue, round-robin across ports, latest wins within a
  port. Every generation is independent: fresh input ids from the chat template, greedy
  decoding (`do_sample: false`), `max_new_tokens` from the request budget; no chat
  history, no KV-cache reuse across jobs.

## Packaging (release gate)

- **Executable code ships in the extension:** the Transformers.js/ONNX Runtime JavaScript
  is bundled into `local-ai/worker.js`, and ONNX Runtime's WASM + `.mjs` loader are copied
  to `local-ai/ort/`; the worker points `env.backends.onnx.wasm.wasmPaths` there and turns
  off `env.useWasmCache` (no CDN, no `blob:` copy). Single-threaded (no cross-origin
  isolation). There is no per-model executable.
- **A model is data:** each registry record pins a Hugging Face revision and lists every
  file the loader reads, with size and SHA-256. Only an explicit install downloads, and
  only those exact URLs (redirects must land on `LOCAL_AI_DOWNLOAD_ORIGINS`, which is also
  the CSP `connect-src`), without credentials, referrer or HTTP caching. Each file is
  hashed while it streams into Transformers.js's cache (`transformers-cache`, keyed by
  the pinned URL); a size or hash mismatch deletes the model's files and fails the install
  (`integrity-failed`). The install then loads the model once from the cache with the
  network denied and records a verified marker (in FluentTyper's own cache). A model is
  `complete` only with every file present and the marker; anything else is `partial`.
  A resumed install re-hashes cached files instead of downloading them again.
- **Review-time loads never use the network:** the worker's fetch (also Transformers.js's
  `env.fetch`) refuses every network URL outside an install, so a missing file fails as
  `cache-failed` (shown as not installed) instead of downloading. A loader request for a
  file missing from the registry fails the install and is logged with its path (no text).
- **Delete** removes exactly the record's file URLs and its marker.
- No host permission is requested. `__FT_DEV_BUILD__` and runtime test hooks stay
  decoupled from Local AI inclusion: production keeps `__FT_DEV_BUILD__ = false` and the
  no-op test hooks.

## Models

Curated registry: `src/core/domain/localAi/modelRegistry.ts`, pinned to Transformers.js
4.3.0. Two tiers, chosen from the real-GPU evaluation
([local-ai-evaluation.md](local-ai-evaluation.md)): **Recommended = Gemma 4 E4B** (default;
found the most errors, loaded as `Gemma4ForConditionalGeneration` and used for text only,
`enable_thinking: false` in its chat template) and **Compact = Qwen3 4B Instruct 2507**
(smaller, fewest changes to correct text; no thinking switch). Both ONNX `q4f16`.
Local AI runs only for review languages listed in the model record (`languages: ["en"]`).
Transformers.js 4.3.0 has no JSON-schema constraint; the parser accepts the model's JSON
(also inside a fenced block) and rejects anything else.

## Pipeline (pure domain, `src/core/domain/grammar/review/ai/`)

1. `buildAiChunks(prepared)`: sentence/paragraph chunks of editable prose, host ids,
   placeholders for protected tokens, bounded read-only context from the same scope.
2. `buildAiMessages(request)`: versioned templates (`AI_PROMPT_VERSION`, now
   `review-ai-3`); editor text is JSON data, never instructions. Correct sends one
   sentence per request.
3. `parseAiResponse(raw, request)`: strict JSON `{"segments":[{"id","text"}]}`, every id
   once, in order; truncation/cancel/extra content ⇒ failure.
4. `correctionFindings` / `rewriteProposal`: word-level diff mapped to snapshot offsets,
   placeholder and protection checks, risk guards (numbers, technical tokens, names,
   negation, uncertainty, quoted text), Correct-mode drift rejection, sentence-grouped
   atomic hunks, reconstruction check.

The session (`ReviewSession`) owns staleness: a result applies only to the generation and
snapshot it was requested for; the cache key covers everything the model consumed.
Writes go only through `ReviewTargetPort.apply`.

## Privacy

No cloud endpoint or fallback, no telemetry, no text in logs/storage/debug views/errors.
Dependency errors are mapped to bounded codes. The download host sees ordinary
connection metadata (IP address, requested model files), never reviewed text.
