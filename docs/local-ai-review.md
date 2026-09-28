# Local AI Review: design note

Status: in implementation (branch `feat/local-ai-review`). This note records the
boundaries and decisions; [review-mode.md](review-mode.md) remains the user-facing
Review documentation.

## Promise

> Fix my mistakes without changing my voice. Rewrite only when I ask. Keep my text on my device.

Local AI enriches the **existing Review panel** with an optional on-device model
(WebLLM on WebGPU). It never runs while typing: popup and inline predictions stay
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
  hosting one dedicated worker that owns the only WebLLM engine. Needs the `offscreen`
  permission (no install-time warning). The background creates it only when a Review opens
  with consent + preference on, or for an explicit install/delete; it closes it after the
  engine idles out.
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
  Single-flight load keyed by model id; an epoch guards late completion after
  disable/unload/model switch. Cancellation calls `interruptGenerate()` and waits for the
  generation to settle; if it does not settle within a bound, the worker is terminated and
  recreated. One generation at a time, a bounded queue, round-robin across ports, latest
  wins within a port. `resetChat()` between every job; no chat history, no resumable
  generation (not present in 0.2.85; re-audit on upgrade).

## Packaging (release gate)

- Model **libraries** (executable WASM) ship inside the extension under `local-ai/libs/`,
  fetched at build time by `scripts/fetch-local-ai-assets.ts` from the pinned
  `binary-mlc-llm-libs` ABI directory and verified by SHA-256; WebLLM also checks the SRI.
  The model record's `model_lib` is an extension-local URL, which WebLLM fetches without
  the network. Tokenizer and grammar WASM are embedded in the WebLLM bundle.
- Model **weights, tokenizer and config** are data, downloaded only after explicit consent
  from the pinned Hugging Face revision. `connect-src` allows only the Hugging Face origins
  in `LOCAL_AI_DOWNLOAD_ORIGINS`. No host permission is requested.
- `__FT_DEV_BUILD__` and runtime test hooks are decoupled from WebLLM inclusion:
  production contains the review runtime but keeps `__FT_DEV_BUILD__ = false` and the
  no-op test hooks. The legacy predictor keeps its stub in production.

## Models

Curated registry: `src/core/domain/localAi/modelRegistry.ts`, pinned to WebLLM 0.2.85 /
model-lib ABI `v0_2_84/base`. Two tiers, chosen from the real-GPU evaluation
([local-ai-evaluation.md](local-ai-evaluation.md)): **Recommended = Qwen3 4B** (default)
and **Compact = Qwen3 1.7B** (smaller download, equally conservative, far fewer
corrections). Both q4f16_1, 4k context, `enable_thinking: false`. No higher-quality tier:
the stronger candidate (Qwen3.5 4B) changed correct text and meaning in the evaluation.
Local AI runs only for review languages listed in the model record (`languages: ["en"]`);
both models damaged a Polish rewrite in the evaluation. Requests use
`response_format: {type: "json_object", schema}`; WebLLM 0.2.85 fails a
bare `json_object` request.

## Pipeline (pure domain, `src/core/domain/grammar/review/ai/`)

1. `buildAiChunks(prepared)`: sentence/paragraph chunks of editable prose, host ids,
   placeholders for protected tokens, bounded read-only context from the same scope.
2. `buildAiMessages(request)`: versioned templates (`AI_PROMPT_VERSION`); editor text is
   JSON data, never instructions.
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
