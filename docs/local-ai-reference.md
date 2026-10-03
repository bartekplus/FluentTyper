# Local AI engineering reference

[FluentTyper](../README.md) / [User guide](local-ai-review.md) / Technical reference

This development reference retains implementation decisions and measured release blockers. For availability, setup, and privacy, use the [Local AI guide](local-ai-review.md).

Status: implemented, not released (see [release blockers](#release-blockers-and-limitations)).
This note records the boundaries and decisions; [review-mode.md](review-mode.md) is the
user-facing Review documentation and [local-ai-evaluation.md](local-ai-evaluation.md) the
measurements.

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

- **Chrome/Edge:** the engine runs inside the background service worker (no extra
  permission, no extra document or worker). Transformers.js and ONNX Runtime are part of
  `background.js`, but the engine does nothing (no GPU probe, no cache read, no load) until
  a Review opens with consent + preference on, or the options page probes, installs or
  deletes. The model loads on the first job.
- **Keepalive:** Chrome stops an idle service worker after 30 s, which would drop a
  multi-GB loaded model or cut an install short. While Local AI is in use (a Review port
  open, a job queued or running, an install/delete/probe running) the host calls
  `chrome.runtime.getPlatformInfo()` every 5 s, which resets that timer; the interval stops
  as soon as nothing is active, so the worker can idle out as before.
- **GPU memory is held only while a Review with Local AI is open.** When the last Review
  port closes, or an install ends (success, failure or cancel) with no Review open, the
  host unloads at once, with no grace period: running work is cancelled and allowed to
  settle, then the model is disposed and its tokenizer/model references dropped. A disposed
  model may leave ONNX Runtime's WebGPU device alive; it goes when Chrome stops the idle
  service worker (about 30 s after the keepalive ends). A Review that stays open without
  jobs unloads the same way after 5 minutes. The next job loads the model from cache, a
  cold load of about 10 s for Gemma 4 E4B on an M2 Max.
- **Firefox:** its MV3 background is an event page; the build ships no engine (build.ts
  swaps `engineRuntime.ts` for a no-op), the feature reports `host-unsupported`, and Review
  stays exactly as today.
- Transport: the content script opens a `chrome.runtime` **port** to the background
  (`ft-local-ai-review`), accepted only from this extension's content scripts (sender id,
  a tab, not an extension page). The port is the session: every job is bound to its port
  and `port.sender` (tab/frame); a disconnect cancels its work. The background is also the
  settings/consent authority, and configures the in-process host directly.
- **Trade-offs:** inference shares the service worker's thread with Presage (generation
  is mostly GPU-bound, but tokenizing and decoding run there); `background.js` grows by
  the runtime, from 407 KB to 977 KB minified on Chrome (Firefox: 419 KB); and an engine
  failure is contained by dispose-and-reload rather than a separate process.
- Lifecycle state machine: `unconfigured → checking-support → download-required →
downloading → loading → ready ⇄ generating → unloading`, plus `unavailable` / `error`.
  Single-flight load keyed by model id; an epoch disposes a load that completes after
  disable/unload/model switch. Cancellation interrupts through Transformers.js's
  `InterruptableStoppingCriteria` (stops at the next token; the prompt prefill cannot be
  interrupted, so a cancel settles in about 1.3–1.5 s) and waits for the generation to
  settle; if it does not settle within 3 s, it is abandoned and the model disposed (the
  next job reloads). A generation that throws (e.g. a lost GPU device) disposes the model
  too; after a second such failure the host stays in `error` until the next Review. One
  generation at a time, a bounded queue, round-robin across ports, latest wins within a
  port. Every generation is independent: fresh input ids from the chat template, greedy
  decoding (`do_sample: false`), `max_new_tokens` from the request budget; no chat
  history, no KV-cache reuse across jobs.

## Packaging (release gate)

- **Executable code ships in the extension:** the Transformers.js/ONNX Runtime JavaScript,
  including ONNX Runtime's WASM glue (its bundle build: a service worker cannot `import()`
  a separate `.mjs`), is bundled into `background.js` (an ES module), and only ONNX
  Runtime's `.wasm` is copied to `local-ai/ort/`; `env.backends.onnx.wasm.wasmPaths` names
  that file and `env.useWasmCache` is off (no CDN, no `blob:` copy). Single-threaded (no
  cross-origin isolation, no `Worker` in a service worker). There is no per-model executable.
- **A model is data:** each registry record pins a Hugging Face revision and lists every
  file the loader reads, with size and SHA-256. Only an explicit install downloads, and
  only those exact URLs (redirects must land on `LOCAL_AI_DOWNLOAD_ORIGINS`, which is also
  the CSP `connect-src`), without credentials, referrer or HTTP caching. Each file is
  hashed while it streams into Transformers.js's cache (`transformers-cache`, keyed by
  the pinned URL); a size or hash mismatch deletes the model's files and fails the install
  (`integrity-failed`). Cancel aborts the download; a file cut short is never stored. The
  install then loads the model once from the cache with the
  network denied and records a verified marker (in FluentTyper's own cache). A model is
  `complete` only with every file present and the marker; anything else is `partial`.
  A resumed install re-hashes cached files instead of downloading them again.
- **Review-time loads never use the network:** the engine's guarded fetch (Transformers.js's
  `env.fetch` and the install's downloads; the service worker's global `fetch` is left
  alone) refuses every network URL outside an install, so a missing file fails as
  `cache-failed` (shown as not installed) instead of downloading. A loader request for a
  file missing from the registry fails the install and is logged with its path (no text).
- **Delete** removes exactly the record's file URLs and its marker. A successful install
  deletes the other tier's files (consent names one model; the confirm step says so).
- No host permission is requested. `__FT_DEV_BUILD__` and runtime test hooks stay
  decoupled from Local AI inclusion: production keeps `__FT_DEV_BUILD__ = false` and the
  no-op test hooks.

## Models

Curated registry: `src/core/domain/localAi/modelRegistry.ts`, pinned to Transformers.js
4.3.0. Two tiers, chosen from the evaluation: **Recommended = Gemma 4 E4B** (default;
found the most errors, loaded as `Gemma4ForCausalLM` and used for text only,
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

## Release blockers and limitations

1. **ONNX Runtime Web is a dev pre-release** (`1.31.0-dev.20260914`, pinned exactly by
   Transformers.js 4.3.0); adopt a stable ORT with a compatible Transformers.js before a
   store release.
2. **Store review** is untested: nothing executable is downloaded (MV3 remote-code rules),
   but the package has not been submitted.
3. **Size and speed:** Recommended is a 4.9 GB download, and since the GPU is released after
   every Review, each Review waits ~8 s for the model before the first Local AI finding
   (rule findings still appear at once).
4. **Coverage:** one GPU and OS measured, memory not measured; Edge and Firefox not run in a
   browser (Firefox ships no engine, so Review works without AI there).
5. **Recall:** Gemma 4 E4B still misses about 1 in 5 errors on the dense fixtures; it
   abstains rather than guesses. English only.
6. **Validator limits:** hedge swaps in rewrites (`might` → `may`) pass because hedges are
   counted, not matched; a plausible wrong "correction" of a valid word would need a
   dictionary check.
