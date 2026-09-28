# Local AI Review: model evaluation

Status: 2026-09-28. **Decision: the engine is Transformers.js (ONNX Runtime Web on WebGPU);
Recommended = Gemma 4 E4B, Compact = Qwen3-4B-Instruct-2507** (see
[Gemma 4](#gemma-4-transformersjs)). WebLLM was dropped; its sections below are history.
One device, synthetic fixtures, sentence-sized inputs, each fixture run once. This is a regression gate and a model-selection input, not
evidence of population-wide accuracy. Design context: [local-ai-review.md](local-ai-review.md).

## How it was measured

Harness: `scripts/local-ai-bench/` (opt-in, real GPU only). It now drives only the product
engine, Transformers.js:

```sh
bun run bench:local-ai --real [--models=standard,compact,<tjsModels id>,…] [--ids=…] [--tag=name]
bun run bench:local-ai:report                  # per-model Markdown/JSON + table
bun scripts/local-ai-bench/recall.ts <results>.json …   # word-level recall / FP screening table
```

- By default it runs the registry's models (`src/core/domain/localAi/modelRegistry.ts`: repo,
  revision, dtype, loader, `disableThinking`), so it measures exactly what ships; it records the
  pinned-revision files the page fetched and warns about any file not in the record's `files`.
  Extra candidates live in `scripts/local-ai-bench/tjsModels.ts`.
- Puppeteer's Chrome for Testing with `--enable-unsafe-webgpu`, a persistent profile and
  results under `.cache/local-ai-bench/` (git-ignored); page served from
  `http://localhost:47811`, ONNX Runtime Web's WASM served locally (never from a CDN).
- Exits non-zero without `--real`; fails (exit 1) without a WebGPU adapter with
  `shader-f16`; no CPU or mock fallback. Hard limits: load ≤ 10 min, generation ≤ 90 s
  (interrupted, counted as a timeout), model run ≤ 20 min.
- Generation: the model's chat template (`enable_thinking: false` where the template has the
  switch), greedy for Correct, temperature 0.4 sampling for Rewrite, `max_new_tokens =
aiMaxOutputTokens(request)`; the product's `buildAiMessages`, `parseAiResponse`,
  `correctionFindings`/`rewriteProposal` and the Domain scorer, as before.

### Earlier WebLLM runs (history)

The sections marked WebLLM below used this setup (harness code since removed):

- Puppeteer's Chrome for Testing with `--enable-unsafe-webgpu`, a persistent profile and
  results under `.cache/local-ai-bench/` (git-ignored). The page is served from
  `http://localhost:47811` (secure context; fixed port so the per-origin weight cache hits).
- The run exits non-zero without `--real`, and fails loudly (`no usable WebGPU adapter`,
  exit 1) when there is no adapter or no `shader-f16`; verified by launching Chrome with
  WebGPU disabled. There is no CPU or mock fallback.
- The page bundles the **real** `@mlc-ai/web-llm` and the product's `buildAiMessages`
  (shipped templates only since `review-ai-2`),
  `aiMaxOutputTokens` and `parseAiResponse`. The model record is built like the product's:
  `https://huggingface.co/<repo>/resolve/<pinned revision>/`, `model_lib` served locally,
  `integrity.model_lib` SRI (sha384, `onFailure: "error"`), `required_features:
["shader-f16"]`, WebLLM's prebuilt overrides plus `context_window_size: 4096`.
- Generation: `n: 1`, `stream: true` with `include_usage`, `seed: 42`, temperature 0
  (Correct) / 0.4 (Rewrite), `max_tokens = aiMaxOutputTokens(request)`,
  `extra_body.enable_thinking: false` for Qwen3 and Qwen3.5 (omitted for Qwen2.5),
  `resetChat()` before every request, and `response_format: { type: "json_object", schema:
AI_RESPONSE_SCHEMA }`, as the product worker sends it (see runtime finding 1).
- Requests are built exactly like the product: whole fixture text as a textarea snapshot
  (`fixturePrepared` from `scripts/local-ai-eval/score.ts`) → `buildAiChunks` →
  `aiRequestForChunk`. Outputs are scored by the Domain scorer (`scoreCorrectCase`,
  `scoreRewriteCase`), i.e. the shipped `parseAiResponse` + `correctionFindings` /
  `rewriteProposal`. Only streams that finish with `stop` count.
- Latency = request start to parsed result (in page) + validation (driver), summed over a
  fixture's chunks. The engine runs on the page's main thread, not in the product's
  offscreen worker; GPU work is identical, message-hop overhead is not measured.
- Cancel-to-settle: the longest rewrite fixture, `interruptGenerate()` 300 ms after the
  request starts, time from the interrupt call until the stream settles; 5 runs.

| Environment    | Value                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | `@mlc-ai/web-llm` 0.2.85, model-lib ABI `v0_2_84/base`                                                                                               |
| Browser        | Chrome for Testing 154.0.8037.57, headless, `--enable-unsafe-webgpu`                                                                                 |
| OS / device    | macOS 27.0 (26A428), Apple M2 Max                                                                                                                    |
| GPU (adapter)  | `apple` / `metal-3` (Metal), `shader-f16` available                                                                                                  |
| Context window | 4096                                                                                                                                                 |
| Prompt         | final: `review-ai-2` (shipped); history: `review-ai-1` and the harness-only `v2` it was derived from                                                 |
| Fixtures       | 157 Correct (87 expected unchanged, 70 expected corrections; 16 Polish), 34 Rewrite (8 keep-voice, 9 professional, 7 concise, 6 clearer, 4 friendly) |
| Samples        | each fixture ran **once** per model and prompt (157 Correct + 34 Rewrite = 191 fixture runs per model); 5 cancel runs per model                      |

| Model                               | Pinned revision                            | Lib sha256 (first 16) | Weights download |
| ----------------------------------- | ------------------------------------------ | --------------------- | ---------------: |
| `Qwen3-1.7B-q4f16_1-MLC`            | `80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc` | `8161aaa4b40bccf1`    |          0.97 GB |
| `Qwen3.5-2B-q4f16_1-MLC`            | `dd74e9c8a20c4546df85c844103bff87b6dcacad` | `b0f951d411e4fd59`    |          1.06 GB |
| `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | `9bd564b064631febf14deadcac492efb761d60c3` | `0fceb50bbaf47efd`    |          0.87 GB |
| `Qwen3-4B-q4f16_1-MLC`              | `a5c9fab855e3ccbdfed2e7e69683d75f30332161` | `a986a53c92579714`    |          2.26 GB |
| `Qwen3.5-4B-q4f16_1-MLC`            | `44b42469f9e192814bfd90440e3b377d89ba7a13` | `7e8f9895daa710a8`    |          2.37 GB |

Download bytes are the pinned revisions' weight shards (registry / probe), not measured
transfer. Memory was not measured (registry VRAM estimates only).

## Gemma 4 (Transformers.js)

Screening set (112 fixtures, 122 requests: dense, held-out, correct-text controls and traps;
see [model screening](#model-screening-and-prompt-experiments-webllm-review-ai-3--not-adopted-product-prompt-unchanged)),
Correct mode, prompt `review-ai-3`, JSON contract (unconstrained), greedy, Transformers.js
4.3.0 / onnxruntime-web 1.31.0-dev.20260914, Chrome for Testing 154, Apple M2 Max. **Each
sentence ran once.** Gemma 4 uses the multimodal ONNX export
(`Gemma4ForConditionalGeneration`, text only; the audio/vision encoders are downloaded and
loaded but unused). Recall denominators: dense 91, held-out 45 expected word-level fixes.

| Model (repo @ revision)                                                                   | Download | Invalid | Recall dense / held-out (model) | Accepted dense / held-out | Fully / partly fixed (of 41) | Correct text changed (model)                                                        | Correct text changed (accepted)           | p50 / p90 ms per sentence | First token p50 | Cold load |
| ----------------------------------------------------------------------------------------- | -------: | ------- | ------------------------------- | ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------- | --------------- | --------- |
| **Gemma 4 E4B** (`onnx-community/gemma-4-E4B-it-ONNX` @ `843f250f`)                       |  5.20 GB | 0/122   | 85% / 89%                       | **78% / 84%**             | **28 / 12**                  | 6 (spec-08, ambiguous-08, -10, -11, -16, dense-ok-17)                               | 2: ambiguous-16, dense-ok-17              | 1921 / 2190               | 1094            | 9.6 s     |
| Gemma 4 E2B (`onnx-community/gemma-4-E2B-it-ONNX` @ `9f4bef82`)                           |  3.38 GB | 3/122   | 76% / 78%                       | 69% / 76%                 | 22 / 18                      | 11 (spec-07, -08, -10, tech-02, -03, -04, ambiguous-10, -11, -16, dense-ok-15, -17) | 3: ambiguous-16, dense-ok-15, dense-ok-17 | 1838 / 2053               | 573             | 6.5 s     |
| **Qwen3-4B-Instruct-2507** (`onnx-community/Qwen3-4B-Instruct-2507-ONNX` @ `41a4dd4d`)    |  2.90 GB | 0/122   | 63% / 60%                       | 63% / 58%                 | 18 / 19                      | 1 (ambiguous-16)                                                                    | 1: ambiguous-16                           | 1570 / 1747               | 1052            | 4.5 s     |
| Qwen3-4B (`onnx-community/Qwen3-4B-ONNX` @ `98ddba15`), previous engine default's weights |  2.83 GB | 0/122   | 49% / 42%                       | 49% / 42%                 | 11 / 21                      | 1 (ambiguous-16)                                                                    | 1: ambiguous-16                           | 1719 / 1881               | 1189            | 6.4 s     |

Accepted changes to correct text, human-checked: `ambiguous-16` (`If I was you` → `were`,
every model); `dense-ok-17` `The data are stored locally and never leave the device.` →
Gemma 4 E4B `The data is stored … never leaves` (consistent, singular _data_; a style choice,
not a meaning change) and E2B `The data is stored … never leave` (breaks agreement);
`dense-ok-15` (E2B) `fewer settings means` → `mean`. No golden spec fixture was changed after
validation by any of the four. Accepted edits on correction fixtures that differ from the
expected text (valid alternatives or partial fixes, human-checked), E4B: `user paste a` →
`user pastes` (dense-01, drops the article instead of adding one), `choose` → `chooses`
(dense-03), `many equipments` → `much equipment` (heldout-06). Gemma 4 E4B is the only model
tested on either engine that reaches both ≥ 78% dense and ≥ 84% held-out accepted recall
(WebLLM's best were Qwen3.5-9B 78% / 69% and gemma-2-9b 70% / 84%, both 5+ GB), at about the
latency of Qwen3-4B. Costs: the largest download of the shipped options (5.20 GB, of which
~0.27 GB are unused audio/vision encoders), the slowest cold load (9.6 s), memory not measured.
**Full suite, Gemma 4 E4B vs Qwen3-4B-Instruct-2507** (230 Correct fixtures / 246 requests;
Gemma also 35 Rewrite and 5 cancel runs; each fixture once):

|                                                     | Gemma 4 E4B                                                                 | Qwen3-4B-Instruct-2507                   |
| --------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| Invalid responses                                   | 0/246                                                                       | 0/246                                    |
| Accepted recall dense / held-out                    | 78% (71/91) / 84% (38/45)                                                   | 63% (57/91) / 58% (26/45)                |
| Other corrections accepted (non-dense, 69 fixes)    | **100% (69/69)**                                                            | 93% (64/69)                              |
| Exact corrections (scorer, 111 correction fixtures) | 98/111                                                                      | 83/111                                   |
| Correct text changed, accepted (of 119), at the run | 6: casual-08, quoted-02, quoted-03, ambiguous-16, injection-06, dense-ok-17 | 3: casual-08, ambiguous-16, injection-06 |
| … re-scored with the current validator (`16fac67b`) | **0**                                                                       | 0                                        |
| Correct p50 / p90 per sentence                      | 1798 / 2147 ms                                                              | 1491 / 1712 ms                           |
| Cold load from cache                                | 10.6 s                                                                      | 4.2 s                                    |
| Cancel-to-settle (5 runs)                           | 1.26–1.46 s                                                                 | not measured                             |

All six accepted changes to correct text are punctuation or style, none changes meaning:
`Ok cool.` → `Ok, cool.`; a comma before a quotation (quoted-02, quoted-03); `If I was you` →
`were`; `Assistant: sure` → `Sure`; `The data are … never leave` → `The data is … never
leaves`. The validator now rejects these classes (interjection commas, a comma before an
opening quote, subjunctive `was`/`were`, case after a colon, verb number with collective nouns
such as "data" or "team"); re-scoring the stored outputs gives **0 of 119** for both models,
with Gemma 4 E4B's exact corrections unchanged (98/111). The only recall given up is
`Our team have` → `has` (both are standard).

Rewrite (Gemma 4 E4B, 35 fixtures, temperature 0.4): 23 changed and validated, 18 with all
fixture invariants; 8 rejected (uncertainty 4, technical-token 2, negation 1, quoted 1).
Invariant misses, human-checked: synonym-level for rw-02 (`Not sure yet` → `I am not certain at
this time`), rw-14 (`might` → `may`), rw-15 (`forever` → `indefinitely`) and rw-pl-02
(Polish kept, `fix` → `poprawkę`); one real drift, rw-04 (`when the thing restarts` → `when
the system restarts`, an invented referent). Also noted: rw-21 `Email support@example.com with
the log file` → `… the log file` (drops "with"). The user's dense paragraph (rw-dense-01,
keep-voice) came back fully corrected in one pass. No greeting, sign-off, apology or deadline
was invented. Compact's Rewrite was not run on Transformers.js.

### Decision

**Transformers.js replaces WebLLM. Recommended (`standard`) = Gemma 4 E4B; Compact
(`compact`) = Qwen3-4B-Instruct-2507** (registry `src/core/domain/localAi/modelRegistry.ts`,
prompt `review-ai-3`). Gemma 4 E4B finds the most errors of every model tested; with the current validator it changes no correct text on the full suite (0 of 119, re-scored),
the same as Compact. Compact has the fewest changes to
correct text at 56% of the download and ~40% of the cold-load time. The WebLLM recommendations further down are superseded.

## Error-dense text (user report, prompt `review-ai-3`)

A user reviewed a 10-sentence paragraph with 27 listed mistakes (now fixtures
`dense-01`…`dense-10` and `dense-para-01`, plus 10 synthetic dense sentences and 22
correct-prose controls `dense-ok-*`). With `review-ai-2`, Correct found almost nothing and
Rewrite was discarded. Three causes, all fixed:

1. **The model copied dense sentences back.** The generic "conservative proofreader"
   prompt made Qwen3 return error-dense sentences unchanged. `review-ai-3` names the error
   classes to fix and shows a multi-error example. Several sentences per request made it
   fix only the first, so Correct now sends one sentence per request (neighbours as
   read-only context).
2. **The validator was all-or-nothing per sentence** and lacked agreement and
   double-negative rules: even a perfect answer was rejected for 7 of 20 dense sentences.
   Changes are now checked one unit at a time (see `validate.ts`).
3. **Rewrite discarded everything for one sentence** (`before Friday` → `by Friday`,
   a changed deadline). A failing sentence is now kept as written.

Model-level recall on the 20 dense sentences (expected word-level fixes made by the raw
model output, before validation), Qwen3 4B: **11/57 with `review-ai-2` → 32/57 with
`review-ai-3`**, controls untouched in both.

| Qwen3 4B (Recommended)                       | `review-ai-2`  | `review-ai-3`                                                  |
| -------------------------------------------- | -------------- | -------------------------------------------------------------- |
| False positives on correct text (full suite) | 0/87           | 1/109 (`If I was you` → `were`: subjunctive, a dialect choice) |
| Exact corrections (full suite)               | 46/70          | 62/91                                                          |
| Dense sentences fully fixed / partly fixed   | 3/20 / 7       | 6/21 / 13                                                      |
| Correct-prose controls changed               | 0/22           | 0/22                                                           |
| Correct latency p50 / p90 (one sentence)     | 1173 / 1379 ms | 1514 / 1838 ms (longer prompt)                                 |

| Qwen3 1.7B (Compact)            | `review-ai-2` | `review-ai-3` |
| ------------------------------- | ------------- | ------------- |
| False positives on correct text | 0/87          | 0/109         |
| Exact corrections               | 21/70         | 48/91         |
| Correct latency p50 / p90       | 644 / 746 ms  | 687 / 801 ms  |

The user's paragraph in the **real extension** (production build, Qwen3 4B,
`bun run test:local-ai:real` step ii-b): 13 findings, 8 of them Local AI (`work → works`,
`was → were`, `find several issue → found several issues`, `sometime it choose →
sometimes it chooses`, `finished → finish`, `have → has`, `click → clicks`, `is saved
immediatly → are saved immediately`) and 5 from rules and the dictionary, plus `doesn't`
offered as the Local AI option on the rule's `dont → don't`. First Local AI finding after
2.7 s, check complete after 19.7 s. Still missed by the model: `user paste`, `too many
informations`, `since three years`, `more slower then`, `however`, `it still miss`,
`discussed about`, `to not change nothing`; left alone by design: `Me and my colleague`
(a reorder). Rewrite proposals rejected (Qwen3 4B, 35 cases): 5 → 4 after per-sentence
acceptance. Every fixture ran once.

## Model screening and prompt experiments (WebLLM, `review-ai-3`) — not adopted; product prompt unchanged

Run 2026-09-28 on the same device (Apple M2 Max, Chrome for Testing 154, WebLLM 0.2.85),
Correct mode only, one sentence per request, **each fixture ran once** (temperature 0,
seed 42). Nothing here changed the product: registry, shipped prompt (`review-ai-3`) and
validator are as committed; the prompt variants live only in
`scripts/local-ai-bench/promptVariants.ts`. Commands:
`bun run bench:local-ai --real --modes=correct --tag=<t> --ids=<set> [--prompt=<variant>]`,
then `bun scripts/local-ai-bench/recall.ts <results>.json`.

**Screening set (112 fixtures, 122 requests):** `dense-01…20` + `dense-para-01` (user report,
91 expected word-level fixes), `heldout-01…20` (45 fixes, measurement only), and 108
correct-text fixtures that must stay unchanged: `dense-ok-*` (22), `heldout-ok-*` (10),
`spec-*` (12), `ambiguous-*` (16), `tech-*` (11). Recall = expected word-level fixes (LCS
token-diff hunks between fixture and expected text) that the output also makes; "model" is the
raw proposal (placeholders restored), "accepted" is what the validator let through. FP model =
unchanged fixtures the raw proposal changed (the validator blocks most); FP accepted = what a
user would be shown. Candidate libraries were downloaded from `mlc-ai/binary-mlc-llm-libs` at
commit `025bcaf3780fa8254f5e5efd3bfea0a5397248f4` and each verified against that commit's git
blob SHA-1 before use (SHA-256/SRI recorded in the probe file); weights from each repo's
pinned revision. Every model's weights and the profile's HTTP cache were deleted after it
ran, except Qwen3-4B and Qwen3-1.7B.

### Models (shipped prompt `review-ai-3`)

| Model                            | Download / VRAM est. | Recall dense (model) | Recall held-out (model) | Dense accepted  | Held-out accepted | Fully / partly fixed (of 41) | FP model | FP accepted (ids)                                             | p50 / p90 ms per sentence | Cold load |
| -------------------------------- | -------------------- | -------------------- | ----------------------- | --------------- | ----------------- | ---------------------------- | -------- | ------------------------------------------------------------- | ------------------------- | --------- |
| **Qwen3-4B** (Recommended today) | 2.26 GB / 3.4 GB     | 49% (45/91)          | 47% (21/45)             | 49% (45/91)     | 47% (21/45)       | 11 / 21                      | 1        | ambiguous-16                                                  | 1793 / 2087               | 3.4 s     |
| Qwen3.5-4B                       | 2.37 GB / 3.9 GB     | 78% (71/91)          | 76% (34/45)             | 71% (65/91)     | 71% (32/45)       | 20 / 18                      | 3        | **spec-06**, ambiguous-16                                     | 2566 / 2834               | 2.9 s     |
| Phi-4-mini-instruct              | 2.16 GB / 3.4 GB     | 75% (68/91)          | 62% (28/45)             | 68% (62/91)     | 62% (28/45)       | 16 / 23                      | 10       | ambiguous-16                                                  | 1550 / 1750               | 3.0 s     |
| Llama-3.2-3B-Instruct            | 1.81 GB / 2.3 GB     | 57% (52/91)          | 49% (22/45)             | 57% (52/91)     | 49% (22/45)       | 10 / 24                      | 7        | **spec-06**, tech-01, ambiguous-16                            | 1181 / 1356               | 2.2 s     |
| Qwen2.5-3B-Instruct              | 1.74 GB / 2.5 GB     | 68% (62/91)          | 49% (22/45)             | 68% (62/91)     | 49% (22/45)       | 16 / 20                      | 14       | ambiguous-02, ambiguous-16                                    | 1472 / 1730               | 2.7 s     |
| gemma-2-2b-it                    | 1.47 GB / 1.9 GB     | 77% (70/91)          | 71% (32/45)             | 70% (64/91)     | 67% (30/45)       | 16 / 22                      | 9        | **spec-07**, ambiguous-16                                     | 1091 / 1251               | 2.4 s     |
| Ministral-3-3B-Instruct-2512     | 1.93 GB / 2.9 GB     | 29% (26/91)          | 31% (14/45)             | 24% (22/91)     | 27% (12/45)       | 5 / 14                       | 55       | ambiguous-09, ambiguous-12, dense-ok-02, -03, -04             | 1297 / 1506               | 2.5 s     |
| Qwen3-8B                         | 4.61 GB / 5.7 GB     | 54% (49/91)          | 58% (26/45)             | 54% (49/91)     | 58% (26/45)       | 15 / 20                      | 1        | ambiguous-16                                                  | 2656 / 2929               | 5.6 s     |
| Llama-3.1-8B-Instruct            | 4.52 GB / 5.0 GB     | 77% (70/91)          | 64% (29/45)             | 73% (66/91)     | 64% (29/45)       | 20 / 17                      | 14       | **spec-09**, ambiguous-04, -06, -16, dense-ok-07, dense-ok-17 | 2492 / 2699               | 5.0 s     |
| Qwen2.5-7B-Instruct              | 4.28 GB / 5.1 GB     | 73% (66/91)          | 69% (31/45)             | 69% (63/91)     | 67% (30/45)       | 19 / 18                      | 9        | ambiguous-16, dense-ok-17                                     | 2343 / 2594               | 4.5 s     |
| Mistral-7B-Instruct-v0.3         | 4.08 GB / 4.6 GB     | 71% (65/91)          | 71% (32/45)             | 67% (61/91)     | 71% (32/45)       | 17 / 22                      | 23       | **spec-07, spec-09, spec-11**, 8 more                         | 2866 / 3192               | 4.2 s     |
| gemma-2-9b-it                    | 5.20 GB / 6.4 GB     | 77% (70/91)          | **89% (40/45)**         | 70% (64/91)     | **84% (38/45)**   | 24 / 17                      | 13       | ambiguous-16, dense-ok-17                                     | 4365 / 7032               | 6.8 s     |
| Qwen3.5-9B                       | 5.04 GB / 6.4 GB     | **85% (77/91)**      | 76% (34/45)             | **78% (71/91)** | 69% (31/45)       | 21 / 17                      | 4        | ambiguous-07, ambiguous-16, dense-ok-15                       | 3360 / 3647               | 5.7 s     |

Download = the pinned revision's weight shards; VRAM = WebLLM's registry estimate (not
measured; the machine has 32 GB unified memory, so every 7–9B model fit). First download took
28–95 s here. `ambiguous-16` (`If I was you` → `were`) is changed by every model; the fixture
treats the indicative as a dialect choice. Accepted changes to golden spec fixtures (bold):
Qwen3.5-4B and Llama-3.2-3B `cant` → `cante` (spec-06), gemma-2-2b drops the final period of
spec-07, Llama-3.1-8B and Mistral change spec-09 (`rtpjitterbuffer latency=200 …`).
Ministral-3-3B wraps words in Markdown `**bold**` (55 of 108 correct fixtures changed before
validation); its chat template was used as shipped, no workaround tried. gemma-2-9b's
dense-ok-17 change (`The data are stored … never leave` → `The data is stored … never
leave`) breaks agreement.

**Full Correct suite (230 fixtures, 246 requests) for the three best new candidates and the
baseline:**

| Model               | Correct text changed (accepted, of 119)                                                                                               | Other corrections accepted (non-dense, 69 fixes) | Wrong edits accepted on correction fixtures (human-checked)                                                                                                                                          | p50 / p90 ms |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Qwen3-4B            | 1: ambiguous-16                                                                                                                       | 84% (58/69)                                      | none (7 extra edits, all valid alternatives or partial fixes)                                                                                                                                        | 1627 / 1886  |
| Qwen3.5-9B          | 3: ambiguous-07 (`None of the tests are` → `is`), ambiguous-16, dense-ok-15 (`fewer settings means` → `mean`)                         | 88% (61/69)                                      | fix-14 `She walk` → `She walked` (tense changed; expected `walks`)                                                                                                                                   | 3216 / 3691  |
| Phi-4-mini-instruct | 2: mixed-01 (adds quotes around `merci beaucoup`), ambiguous-16                                                                       | 80% (55/69)                                      | fix-40 `a wierd bug` → `weird bug` (drops the article), fix-55 `The the report` → `the report` (lower-case start), pl-15 `plik` → `plac` (different word), dense-05 `There are too many information` | 1403 / 1787  |
| gemma-2-2b-it       | 4: spec-07 (drops the period), **casual-05 `see you then` → `see you than`** (meaning broken), casual-08 (adds a comma), ambiguous-16 | 86% (59/69)                                      | none beyond partial fixes                                                                                                                                                                            | 992 / 1204   |

Screening verdict against the precision-first criteria: no candidate beats Qwen3-4B on
precision. Qwen3.5-9B has the best recall of the models without golden-fixture or meaning
changes (+36 dense / +29 held-out points over Qwen3-4B) but its three accepted changes to
correct text are prescriptive rewrites of acceptable usage, and it costs 2.2× the download,
~1.9× the VRAM estimate and ~1.8× the latency. Phi-4-mini is the only candidate faster than
Qwen3-4B with clearly higher recall, but on the full suite it produced four wrong accepted
edits (validator gaps: article deletion, capitalization loss, a same-language word swap in
Polish). gemma-2-2b is the fastest and smallest with good recall but broke a meaning
(casual-05) and a golden fixture; it is also under the Gemma terms, not Apache/MIT. Licenses
(upstream cards): Qwen Apache-2.0, Phi-4-mini MIT, Llama 3.x community license, Gemma terms.

### Prompt variants (not adopted)

Variants edit only the Correct system prompt of `review-ai-3`: **classes** names seven more
error classes, each with an example in new words (uncountable nouns, duration prepositions,
redundant prepositions after verbs, articles on singular countable nouns, _however_
punctuation, _look forward to_ + -ing, than/then); **soft** allows deleting a wrong/redundant
word or adding a missing one while still forbidding synonyms and rephrasing; **twoex** adds a
second worked example; **combo** is all three. Thinking ON (Qwen3, bounded budget) was
prepared in the harness (`--think-budget`, harness-only stripping of the think block) but
**not run** (parked for the engine experiment).

| Model / prompt           | Recall dense (model) | Recall held-out (model) | Held-out accepted | FP model (ids)                                        | FP accepted      | p50 / p90 ms |
| ------------------------ | -------------------- | ----------------------- | ----------------- | ----------------------------------------------------- | ---------------- | ------------ |
| Qwen3-4B `review-ai-3`   | 49% (45/91)          | 47% (21/45)             | 47% (21/45)       | 1 (ambiguous-16)                                      | 1 (ambiguous-16) | 1793 / 2087  |
| Qwen3-4B classes         | 52% (47/91)          | 42% (19/45)             | 42% (19/45)       | 0                                                     | 0                | 2182 / 2427  |
| Qwen3-4B soft            | 48% (44/91)          | 40% (18/45)             | 40% (18/45)       | 0                                                     | 0                | 1838 / 2072  |
| Qwen3-4B twoex           | 47% (43/91)          | 42% (19/45)             | 42% (19/45)       | 1 (ambiguous-16)                                      | 1                | 2020 / 2255  |
| Qwen3-4B **combo**       | 53% (48/91)          | **56% (25/45)**         | **56% (25/45)**   | 0                                                     | 0                | 2556 / 2808  |
| Qwen3.5-9B `review-ai-3` | 85% (77/91)          | 76% (34/45)             | 69% (31/45)       | 5 (ambiguous-07, -11, -16, injection-02, dense-ok-15) | 3                | 3216 / 3691  |
| Qwen3.5-9B **classes**   | 85% (77/91)          | **84% (38/45)**         | **78% (35/45)**   | 5 (+spec-07, blocked)                                 | 3 (same)         | 4315 / 4634  |
| Qwen3.5-9B soft          | 85% (77/91)          | 71% (32/45)             | 67% (30/45)       | 5 (+ambiguous-01, blocked)                            | 3 (same)         | 3749 / 4101  |
| Qwen3.5-9B twoex         | 86% (78/91)          | 78% (35/45)             | 71% (32/45)       | 6 (+spec-07, ambiguous-01, blocked)                   | 3 (same)         | 4219 / 4553  |
| Qwen3.5-9B combo         | 85% (77/91)          | 82% (37/45)             | 78% (35/45)       | 4 (+spec-07, blocked)                                 | 3 (same)         | 4863 / 5272  |

(The Qwen3.5-9B baseline row is from its full-suite run on the same prompt; screening and
full-suite recall and changed ids on the shared fixtures were identical; latency and the
injection-02 entry come from the full run.)

Reading: **soft** and **twoex** alone do not help (held-out down or flat). **combo** is the
only variant that raises Qwen3-4B's held-out recall (+4 fixes: `discuss about … since` →
`discussing … for`, `however` punctuation, `explained to us`, an indirect question, `then` →
`than`; one lost: `If customer open`) with no correct text changed, at +43% latency (~85 more
prompt tokens per request and a second example). For Qwen3.5-9B, **classes** gives the largest
held-out gain (+4 accepted) with no new accepted FP (one new model-level change to spec-07,
blocked by the validator). **Caveat that blocks adoption:** the seven named classes were chosen
after seeing the held-out errors (three of Qwen3-4B's four new held-out fixes are in those
classes), so the held-out set is no longer a clean measure for `classes`/`combo`; each fixture
ran once and the gains are 4 of 45 fixes. Before adopting `combo`, measure it on a fresh
held-out set written without reference to these classes.

## Engine comparison: WebLLM vs Transformers.js (benchmark only)

Question: can Transformers.js (Hugging Face, ONNX Runtime Web on WebGPU) replace WebLLM, whose
per-model compiled libraries from `mlc-ai/binary-mlc-llm-libs` carry no license (the release
blocker)? Product code, registry and the shipped prompt are unchanged; the engine exists only in
`scripts/local-ai-bench/` (`--engine=transformers`, `tjsPage.ts`, `tjsWorker.ts`,
`tjsModels.ts`).

**Setup.** `@huggingface/transformers` **4.3.0** (devDependency only, Apache-2.0), which pulls
`onnxruntime-web` **1.31.0-dev.20260914-8d85527a0** (MIT; a dev pre-release pinned by 4.3.0),
`@huggingface/jinja` 0.5.10 (MIT) and `@huggingface/tokenizers` 0.2.0 (Apache-2.0). Same
harness page, Chrome for Testing 154 with `--enable-unsafe-webgpu`, same persistent profile,
same M2 Max. Requests, `buildAiMessages` (`review-ai-3`), `parseAiResponse`,
`correctionFindings` and scoring are identical to the WebLLM runs; the model's own chat template
(`apply_chat_template`, `enable_thinking: false` for Qwen3/SmolLM3), `device: "webgpu"`,
`dtype: "q4f16"`, greedy decoding (`do_sample: false`), `max_new_tokens =
aiMaxOutputTokens(request)`. Transformers.js 4.3.0 has **no grammar-constrained decoding** (no
JSON-schema/grammar code in the package), so option (a) is our JSON contract unconstrained.
Option (b) is a benchmark-only plain-text contract (`textContractMessages` /
`parseTextContract` in `promptVariants.ts`): same rules and example content, the model answers
with only the corrected sentence (Correct sends one sentence per request), bounded one-line
parse, then the same `correctionFindings`. Cancellation uses `InterruptableStoppingCriteria`.
Screening set as above (112 fixtures, 122 requests), Correct mode, **each sentence ran once**.
Hard limits: load ≤ 10 min, generation ≤ 90 s, model ≤ 20 min (added after the Qwen3-1.7B
hang). Every model's weights (CacheStorage and the profile's HTTP cache) were deleted after it ran.

### Same model, both engines (same prompt, same sentences)

| Model / engine / contract              | Invalid                                                                                                                                                             | Recall dense / held-out (model) | Accepted dense / held-out | Fully / partly fixed (41) | FP model | FP accepted                                                    | p50 / p90 ms | First token p50 | Cold load | Download | Cancel p50 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------- | ------------------------- | -------- | -------------------------------------------------------------- | ------------ | --------------- | --------- | -------- | ---------- |
| Qwen3-4B · WebLLM · JSON (grammar)     | 0/122                                                                                                                                                               | 49% / 47%                       | 49% / 47%                 | 11 / 21                   | 1        | ambiguous-16                                                   | 1793 / 2087  | 1018            | 3.4 s     | 2.26 GB  | 1.0 s      |
| Qwen3-4B · Transformers.js · JSON      | 0/122                                                                                                                                                               | 49% / 42%                       | 49% / 42%                 | 11 / 21                   | 1        | ambiguous-16                                                   | 1719 / 1881  | 1189            | 6.4 s     | 2.83 GB  | 1.3 s      |
| Qwen3-4B · WebLLM · text               | 0/122                                                                                                                                                               | 41% / 27%                       | 41% / 27%                 | 7 / 19                    | 2        | none                                                           | 1148 / 1368  | 781             | 2.3 s     | 2.26 GB  | —          |
| Qwen3-4B · Transformers.js · text      | 0/122                                                                                                                                                               | 44% / 38%                       | 44% / 38%                 | 10 / 21                   | 1        | none                                                           | 1192 / 1372  | 933             | 6.6 s     | 2.83 GB  | —          |
| Phi-4-mini · WebLLM · JSON (grammar)   | 0/122                                                                                                                                                               | 75% / 62%                       | 68% / 62%                 | 16 / 23                   | 10       | ambiguous-16                                                   | 1550 / 1750  | 878             | 3.0 s     | 2.16 GB  | —          |
| Phi-4-mini · Transformers.js · JSON    | 0/122                                                                                                                                                               | 71% / 62%                       | 70% / 62%                 | 15 / 23                   | 13       | ambiguous-16, dense-ok-15                                      | 1601 / 1773  | 1124            | 3.5 s     | 2.55 GB  | 1.2 s      |
| Phi-4-mini · Transformers.js · text    | 0/122                                                                                                                                                               | 65% / 60%                       | 65% / 58%                 | 14 / 24                   | 9        | ambiguous-16, dense-ok-07                                      | 1003 / 1208  | 794             | 3.5 s     | 2.55 GB  | —          |
| Llama-3.2-3B · WebLLM · JSON (grammar) | 3/122                                                                                                                                                               | 57% / 49%                       | 57% / 49%                 | 10 / 24                   | 7        | spec-06, tech-01, ambiguous-16                                 | 1181 / 1356  | 690             | 2.2 s     | 1.81 GB  | —          |
| Llama-3.2-3B · Transformers.js · JSON  | 6/122                                                                                                                                                               | 47% / 51%                       | 47% / 51%                 | 11 / 23                   | 6        | spec-06, ambiguous-16, heldout-ok-03, heldout-ok-09            | 1244 / 1376  | 843             | 5.5 s     | 2.41 GB  | 0.8 s      |
| Llama-3.2-3B · Transformers.js · text  | 0/122                                                                                                                                                               | 62% / 56%                       | 62% / 56%                 | 14 / 22                   | 18       | spec-11, ambiguous-16, dense-ok-02, dense-ok-07, heldout-ok-09 | 844 / 971    | 653             | 6.5 s     | 2.41 GB  | —          |
| Qwen2.5-3B-Instruct · Transformers.js  | not run: no onnx-community or official ONNX export (only third-party repos)                                                                                         |                                 |                           |                           |          |                                                                |              |                 |           |          |            |
| Qwen3-1.7B · Transformers.js           | failed: `std::bad_alloc` creating the session (single 1.4 GB `.onnx` file, no external data), after which the run stopped progressing (35 min, killed); not retried |                                 |                           |                           |          |                                                                |              |                 |           |          |            |

Recall denominators: dense 91, held-out 45 expected fixes. Cancel: longest rewrite fixture
(`rw-dense-01`), `interrupt` 300 ms after start, five runs; WebLLM was measured for Qwen3-4B
only on this fixture. Download = pinned files of the q4f16 variant (Transformers.js exports are
larger: 2.83 vs 2.26 GB for Qwen3-4B). First download took 53 s (Qwen3-4B), 129 s (Phi-4-mini),
63 s (Llama) here.

### Transformers.js-only models

| Model (repo @ revision)                                                               | Contract           | Invalid                                                                      | Recall dense / held-out (model) | Accepted dense / held-out | Fully / partly | FP model | FP accepted                                                    | p50 / p90 ms | First token | Cold load | Download | License               |
| ------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- | ------------------------------- | ------------------------- | -------------- | -------- | -------------------------------------------------------------- | ------------ | ----------- | --------- | -------- | --------------------- |
| **Qwen3-4B-Instruct-2507** (`onnx-community/Qwen3-4B-Instruct-2507-ONNX` @ `41a4dd4`) | JSON               | 0/122                                                                        | **63% / 60%**                   | **63% / 58%**             | 18 / 19        | 1        | ambiguous-16                                                   | 1570 / 1747  | 1052        | 4.5 s     | 2.89 GB  | Apache-2.0            |
| same                                                                                  | text               | 0/122                                                                        | 63% / 60%                       | 63% / 56%                 | 17 / 19        | 2        | ambiguous-16                                                   | 1060 / 1225  | 808         | 3.8 s     |          |                       |
| granite-4.0-micro (`onnx-community/granite-4.0-micro-ONNX-web` @ `33934a2`)           | JSON               | 107/122                                                                      | 2% / 7%                         | 2% / 7%                   | 1 / 1          | 2        | none                                                           | 1274 / 1614  | 794         | 2.4 s     | 2.30 GB  | Apache-2.0            |
| same                                                                                  | text               | 0/122                                                                        | 65% / 69%                       | 65% / 67%                 | 17 / 20        | 4        | ambiguous-16                                                   | 872 / 1005   | 627         | 2.5 s     |          |                       |
| LFM2-2.6B (`onnx-community/LFM2-2.6B-ONNX` @ `9655cd4`)                               | JSON               | 1/122                                                                        | 69% / 69%                       | 62% / 69%                 | 20 / 19        | 12       | **spec-06**, tech-11, ambiguous-16, dense-ok-15, heldout-ok-09 | 942 / 1037   | 605         | 2.3 s     | 1.65 GB  | LFM Open License v1.0 |
| same                                                                                  | text               | 5/122                                                                        | 68% / 53%                       | 68% / 53%                 | 15 / 21        | 27       | tech-11, ambiguous-16, dense-ok-15, heldout-ok-09              | 616 / 763    | 449         | 2.3 s     |          |                       |
| SmolLM2-1.7B-Instruct (`HuggingFaceTB/SmolLM2-1.7B-Instruct` @ `31b70e2`)             | JSON               | 54/122                                                                       | 29% / 22%                       | 29% / 20%                 | 9 / 5          | 5        | none                                                           | 815 / 1089   | 480         | 1.6 s     | 1.11 GB  | Apache-2.0            |
| same                                                                                  | text               | 0/122                                                                        | 63% / 58%                       | 58% / 51%                 | 10 / 26        | 15       | spec-11, ambiguous-16, dense-ok-02                             | 516 / 601    | 388         | 1.7 s     |          |                       |
| gemma-3-1b-it (`onnx-community/gemma-3-1b-it-ONNX` @ `a58439f`)                       | JSON               | 39/122                                                                       | 25% / 11%                       | 25% / 11%                 | 7 / 4          | 5        | **spec-06**, dense-ok-09, dense-ok-14                          | 930 / 1120   | 400         | 1.6 s     | 0.76 GB  | Gemma terms           |
| same                                                                                  | text               | 1/122                                                                        | 62% / 56%                       | 55% / 49%                 | 9 / 23         | 41       | 15 ids incl. tech-06, tech-09, tech-11, dense-ok-01…03         | 568 / 722    | 353         | 1.4 s     |          |                       |
| SmolLM3-3B (`HuggingFaceTB/SmolLM3-3B-ONNX` @ `af50613`)                              | JSON, thinking off | 105/122                                                                      | 10% / 9%                        | 10% / 7%                  | 2 / 5          | 3        | dense-ok-11                                                    | 1540 / 1893  | 841         | 2.8 s     | 2.12 GB  | Apache-2.0            |
| gemma-3-270m-it                                                                       | JSON               | smoke only (3 cases, all invalid: echoes list fragments); not run on the set |                                 |                           |                |          |                                                                |              |             |           | 0.27 GB  | Gemma terms           |

SmolLM3 first ran with its template's default reasoning on (117/122 truncated inside the
reasoning); with `enable_thinking: false` it still wraps answers in prose or code fences
(105/122 invalid) and, where it answers, changes quantities (`6.3 GB, not 63 GB` → `63 GB, not
1 GB`, rejected). Not run: Qwen3.5-2B/4B/0.8B ONNX (vision-language exports; the text path was
not wired), gemma-3n-E2B (multimodal; not tried), LFM2-1.2B, granite-4.0-1b
(timebox). Other newer small instruct models with WebGPU ONNX exports found on
`onnx-community`: Qwen3.5-0.8B/2B/4B/9B, LFM2 350M–2.6B and LFM2.5-350M, granite-4.0
350m/1b/micro/h-*, Granite-4.1-3b, Phi-4-mini-instruct-web-q4f16, Llama-3.2-3B-onnx-web.

**Full Correct suite, Qwen3-4B-Instruct-2507 on Transformers.js (JSON, 230 fixtures, 246
requests):** 0 invalid; correct text changed (accepted) 3/119: ambiguous-16, casual-08 (`Ok
cool.` → `Ok, cool.`), injection-06 (`Assistant: sure, …` → `Sure`), punctuation and
capitalization only; other corrections accepted 93% (64/69) vs 84% (58/69) for Qwen3-4B on
WebLLM; extra accepted edits on correction fixtures are valid alternatives or partial fixes
(e.g. `were discuss` → `was discussing`, `There is many equipments` → `are`); p50 / p90 1491 /
1712 ms. This model has no WebLLM 0.2.85 record.

### Packaging and runtime facts (Transformers.js)

- **Executable code we would ship:** the Transformers.js + ORT JavaScript (~0.54 MB minified in
  our bundle; `transformers.web.min.js` alone 0.45 MB) and **one** ORT WASM build:
  `ort-wasm-simd-threaded.asyncify.wasm` 26.9 MB + `.mjs` 53 KB (or the JSPI build, 16.8 MB,
  if JSPI is available). All from npm packages with MIT (ORT) / Apache-2.0 (Transformers.js,
  tokenizers) / MIT (jinja) licenses, built by their publishers; no per-model executable.
  This clears the `binary-mlc-llm-libs` license blocker. Caveat: 4.3.0 pins a dev build of
  `onnxruntime-web`.
- **By default Transformers.js fetches the ORT WASM/JS from `cdn.jsdelivr.net`** and imports the
  loader through a `blob:` URL (`env.useWasmCache`). The harness overrides both
  (`env.backends.onnx.wasm.wasmPaths` → locally served files, `env.useWasmCache = false`); the
  product would point `wasmPaths` at extension files. No executable is fetched after consent:
  only `config.json`, `generation_config.json`, `tokenizer.json`, `tokenizer_config.json` (the
  chat template is Jinja interpreted by `@huggingface/jinja`, not evaluated JS), the `.onnx`
  graph and `.onnx_data` weights — all data interpreted by ORT's built-in kernels.
- **CSP / origins:** `'wasm-unsafe-eval'` (already required for WebLLM); `connect-src` needs
  `https://huggingface.co` plus the CDN host the redirects go to. Observed in every
  Transformers.js download here: `https://us.aws.cdn.hf.co`. Today's
  `LOCAL_AI_DOWNLOAD_ORIGINS` already covers it: it allowlists `https://*.cdn.hf.co` (added
  after the WebLLM real-extension run hit the same regional redirect), in both the CSP and the
  worker's network guard. No other origin was requested.
- **Cache backend:** CacheStorage (`caches.open("transformers-cache")`), keyed by resolved file
  URL; a model is evicted by deleting its entries (the harness does this by URL prefix);
  `env.customCache` exists for a product-owned store. Downloads also leave a copy in Chrome's HTTP
  cache unless fetched with `cache: "no-store"`, as the product's WebLLM worker now does.
- **Workers:** a dedicated worker (module worker) has WebGPU and ran load + generation
  (gemma-3-1b-it: load 3.4 s, 8 tokens in 0.4 s; `--worker-check`). Not tested inside an MV3
  offscreen document or under the extension CSP.
- **Cancellation:** `InterruptableStoppingCriteria.interrupt()` stops at the next token;
  settle 0.3–1.3 s after `interrupt`, dominated by the prompt prefill that cannot be interrupted
  (WebLLM, same fixture, Qwen3-4B: 1.0 s).
- **Failure modes seen:** a single-file 1.4 GB ONNX graph (Qwen3-1.7B) cannot be loaded
  (`std::bad_alloc` in ORT WASM) and the run then hung; models whose exports use external data
  files loaded fine. Without grammar constraints, JSON validity depends on the model (0/122
  invalid for Qwen3-4B, Qwen3-4B-2507 and Phi-4-mini; 39–117/122 for gemma-3-1b, granite,
  SmolLM2/3).
- **Build isolation:** `bun run build` + `bun run check:local-ai:artifact` pass for chrome,
  edge and firefox with the devDependency installed; no Transformers.js/ORT markers
  (`InterruptableStoppingCriteria`, `onnxruntime`, `ort-wasm-simd`, `transformers-cache`) in
  any build output.

### Recommendation: engine

**Decided:** switch to Transformers.js; Recommended = Gemma 4 E4B, Compact =
Qwen3-4B-Instruct-2507 (see [decision](#decision)).

Criteria: no more correct-text changes than today, no new meaning changes, speed within ~1.5×
of WebLLM for the same model, packaging that clears the license blocker.

- **Switching is justified on these measurements: Transformers.js with Qwen3-4B-Instruct-2507,
  JSON contract.** Same-model speed is at parity (Qwen3-4B 1719 vs 1793 ms p50; Phi-4-mini 1601
  vs 1550; Llama-3.2-3B 1244 vs 1181), cold load is slower (4–6.5 s vs 2–3.4 s) and cancel
  settles ~0.3 s later. Same model, same prompt: identical correct-text changes (ambiguous-16
  only) and near-identical recall (held-out 42% vs 47%, two fixes, single runs). The packaged
  runtime is MIT/Apache and generic, so the license blocker goes away. The model available only
  on Transformers.js, Qwen3-4B-Instruct-2507 (Apache-2.0, 2.89 GB), raises recall (held-out 58%
  vs 47% accepted, dense 63% vs 49%, other corrections 93% vs 84%) at the same latency. Its
  full-suite correct-text changes are 3 vs 1 (a comma, a capital after a colon and the shared
  subjunctive), none meaning-changing; that is a small regression against the "no more
  correct-text changes" criterion to be accepted or tightened (e.g. validator rule for
  capitalization after a colon) before switching.
- The text contract is ~30–40% faster but raised correct-text changes for most models and
  lowered Qwen3-4B's recall; keep the JSON contract (validity was 100% for the candidates that
  matter, without a grammar). Hybrid (both engines) is not worth it: it would keep the
  unlicensed libraries in the package.
- Not verified: extension packaging (offscreen document + worker under the MV3 CSP), memory,
  other GPUs, run-to-run variance (each sentence ran once), Rewrite quality on Transformers.js.

**Migration outline (not implemented):** replace the worker engine
(`local-ai` offscreen worker: WebLLM `MLCEngine` → `AutoTokenizer` + `AutoModelForCausalLM` +
`TextStreamer`/`InterruptableStoppingCriteria`, `env.backends.onnx.wasm.wasmPaths` pointing at
packaged ORT files, `env.useWasmCache = false`, `env.allowLocalModels = false`); the model
registry records repo + revision + dtype + per-file SHA-256 of the ONNX/tokenizer files instead
of model-lib path/SRI (the downloaded files are data; verify hashes after download since
Transformers.js has no SRI option); build/packaging ships the ORT WASM + loader instead of
`local-ai/libs/*.wasm` and drops `scripts/fetch-local-ai-assets.ts`' lib step; CSP keeps
`'wasm-unsafe-eval'` and today's `connect-src` (`huggingface.co` + `*.cdn.hf.co`) already
covers the downloads; the artifact check
swaps the WebLLM markers for ORT/Transformers.js markers. Unchanged: prompts, parse, validator,
segments, session, consent/UI, port protocol, cache-deletion UX (different cache name).

## Previous configuration (prompt `review-ai-2`)

Run 2026-09-28 against the committed product code (df79cf37): prompt `review-ai-2`,
`response_format` with `AI_RESPONSE_SCHEMA`, `seed: 42`, temperature 0 (Correct) / 0.4
(Rewrite), `enable_thinking: false` for Qwen3, and the updated validator. Registry:
**Recommended (`standard`) = Qwen3-4B**, **Compact (`compact`) = Qwen3-1.7B**. Qwen2.5-1.5B
is a non-registry reference only.

Samples: 157 Correct fixtures (87 expected unchanged, 70 expected corrections, 16 of them
Polish) and 34 Rewrite fixtures, **each run once** per model (no repeats, so no run-to-run
variance estimate); 5 cancel runs per model.

Columns: FP = a finding offered on an expected-unchanged fixture; Corrected = applying the
offered findings yields exactly the expected text; Wrong/partial = findings on a correction
fixture that do not yield the expected text; Rewrite changed / inv. ok = a validated,
non-identical proposal / and the fixture's must-keep and forbidden-word invariants hold.
Latency is per fixture (one sentence each: ~400 prompt tokens, ~20 completion tokens at p50),
request start to validated result.

| Model                                 | Valid   | FP on unchanged | Corrected       | Wrong/partial | Correct p50 / p90 | Rewrite changed / inv. ok | Rewrite p50 / p90 | Cold load | 1st gen | Cancel p50 / max |
| ------------------------------------- | ------- | --------------- | --------------- | ------------- | ----------------- | ------------------------- | ----------------- | --------- | ------- | ---------------- |
| **Qwen3-4B** (Recommended)            | 157/157 | **0/87**        | **46/70 (66%)** | 1/70          | 1173 / 1379 ms    | 12/34 / 11/34             | 1749 / 1874 ms    | 2.6 s     | 0.95 s  | 812 / 855 ms     |
| **Qwen3-1.7B** (Compact)              | 157/157 | **0/87**        | 21/70 (30%)     | 1/70          | 644 / 746 ms      | 12/34 / 11/34             | 748 / 951 ms      | 1.4 s     | 0.50 s  | 76 / 141 ms      |
| Qwen2.5-1.5B (reference, not shipped) | 157/157 | 3/87 (3.4%)     | 51/70 (73%)     | 1/70          | 690 / 847 ms      | 12/34 / 11/34             | 856 / 975 ms      | 2.1 s     | 0.72 s  | 39 / 71 ms       |

The one wrong/partial fix for both Qwen3 models is fix-02 (`She dont know` → `She don't
know`, expected `doesn't`): an incomplete but not meaning-changing correction. Qwen3-4B still
returned 23/70 correction fixtures verbatim (Qwen3-1.7B: 48/70), i.e. it abstains rather than
guesses. Polish (not advertised): Qwen3-4B corrected 4/16, Qwen3-1.7B 0/16, no false positives.

Rewrite by style (changed / invariants ok): Qwen3-4B keep-voice 1/8, professional 6/9 (5),
concise 2/7, clearer 3/6, friendly 0/4. Qwen3-1.7B keep-voice 2/8, professional 4/9 (3),
concise 2/7, clearer 4/6, friendly 0/4. The single invariant miss for both is rw-22
(`about 40%` → `approximately 40%`, a synonym; the number is kept).

Validator rejections: Qwen3-4B rewrite: uncertainty 2 (rw-23, rw-28), technical-token 1
(rw-29, `retries=3` → `retries to 3`), negation 1 (rw-31). Qwen3-1.7B Correct: length 2;
rewrite: placeholder 2, uncertainty 2, technical-token 1, negation 1, name 1, quoted 1.
Qwen2.5-1.5B Correct: drift 8, placeholder 7, quoted 2, shape 1; rewrite: placeholder 3,
technical-token 2, shape 1.

### Meaning changes that still reached the user (human-checked, final run)

| Model        | Correct mode                                                                                                         | Rewrite                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Qwen3-4B     | none                                                                                                                 | **rw-pl-02** (Polish, professional): `wrzuciłem` → `Włoniłem`, a non-word replacing the verb |
| Qwen3-1.7B   | none                                                                                                                 | **rw-pl-02**: `wrzuciłem` ("I pushed") → `Wyśliję` (malformed "I will send"; tense changed)  |
| Qwen2.5-1.5B | **tech-11** `--dry-run` → `-- dry-run` (breaks a CLI flag); mixed-04 adds `.` after `!`; ambiguous-16 `was` → `were` | rw-04 `the thing` → `the system` (invented referent); rw-27 `14 May` → `May 14`              |

No accepted change on the golden spec-12.2 fixtures, and no accepted change to a number,
negation or hedge in English, for either shipped model. Residual validator gaps for Domain:
(a) in-place corruption of a Polish verb in Rewrite (both shipped models, rw-pl-02): the
translation guard does not catch a same-language wrong word; either restrict Rewrite to
advertised languages or add a changed-word check for non-English text; (b) whitespace inserted
inside a `--flag` token (tech-11, Qwen2.5 only); (c) doubled terminal punctuation `!.`
(mixed-04, Qwen2.5 only).

### Rewrite quality (final, reading the accepted outputs)

Qwen3-4B stays close to the author and keeps facts and hedges: "The thing with the cache is
that it doesn't get cleared when the thing restarts." becomes "The cache isn't cleared when
the thing restarts."; "we didnt get the invoice for march, can u resend" becomes "We did not
receive the invoice for March; could you resend it" (the question mark is lost). It leaves
most keep-voice and all friendly fixtures unchanged, so those styles feel inert on short
text. Qwen3-1.7B cuts harder under concise ("I just wanted to quickly let you know that the
build is, as far as I can tell, probably broken again." → "The build is probably broken
again.") and shifts register under keep-voice ("hey, can you check…" → "Could you check…"),
which is outside "keep my voice". Neither model added greetings, sign-offs, apologies,
promises or deadlines.

## Recommendation (WebLLM, `review-ai-2`) — superseded

Superseded by the [decision](#decision): Transformers.js with Gemma 4 E4B (Recommended) and
Qwen3-4B-Instruct-2507 (Compact).

Criteria, in order: abstention / no false positives, zero meaning changes on golden
unchanged fixtures, correction usefulness, then latency.

- **Keep Recommended = Qwen3-4B with `review-ai-2`.** 0/87 false positives, no accepted
  English meaning change, 46/70 exact corrections, ~1.2 s p50 / 1.4 s p90 per sentence on this
  device. Costs: 2.26 GB download, ~3.4 GB registry VRAM estimate (not measured), cancel settles
  in ~0.8 s (prefill-bound), so the worker-teardown bound should stay well above 1.5 s.
- **Keep Compact = Qwen3-1.7B** for devices that cannot fit 4B: same 0/87 false positives at
  about half the latency, but fewer than half the corrections (21/70). Label it as giving fewer
  corrections.
- **No higher-quality tier.** Qwen3.5-4B (history below) had more recall but changed a golden
  fixture and grammatical number; it was not re-run on `review-ai-2`.
- Qwen2.5-1.5B has the best recall of the small models but still produced accepted false
  positives, including a broken CLI flag; not recommended.
- Rewrite: restrict to English (the advertised language) until gap (a) is closed; both shipped
  models damaged the Polish rewrite fixture.

### Not verified

Other GPUs, integrated/low-memory GPUs, Windows/Linux/ChromeOS, Edge; measured memory use;
the integrated extension path (offscreen document + worker, port transport, concurrent typing
and popup predictions while generating); multi-sentence paragraphs and multi-chunk requests at
realistic sizes; run-to-run variance (each fixture ran once); Qwen3.5-2B, Qwen3.5-4B and
Qwen2.5-1.5B were not re-run beyond what is listed; Firefox (no runtime host). Fixtures are
synthetic and finite: a regression gate, not proof of semantic safety. Polish is not advertised.

## Integrated extension run (real GPU)

`bun run test:local-ai:real` (`scripts/local-ai-e2e-real.ts`) drives the **production
Chrome build** end to end: offscreen document, worker, review port, options page, Review
panel. Run on 2026-09-28, commit `1985d948` + script fix, Apple M2 Max (Metal), headless
Chrome for Testing 154, Recommended tier (Qwen3 4B), one run (earlier runs of the same
script varied about ±5%).

| Step                                                                                                                                    | Result                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Install from the options page (explicit confirm)                                                                                        | pass: 154 requests, only `huggingface.co` and the `*.cdn.hf.co` CDN; none to `raw.githubusercontent.com` |
| Correct: rule finding, then a Local AI finding; accept from the card; native undo                                                       | pass                                                                                                     |
| Rewrite (Keep my voice): Apply disabled while generating; diff; Apply                                                                   | pass                                                                                                     |
| Sentinel text absent from extension storage, console and profile files (CacheStorage and Chrome's own form-restore `Sessions` excluded) | pass (before and after the offline phase)                                                                |
| Offline cold start (same profile, all external networking denied): AI finding from the cache                                            | pass, no external request attempted                                                                      |
| Partial cache (one weight shard deleted): honest "install again", rules intact, no network                                              | pass                                                                                                     |
| Delete from options: model cache empty, consent and preference kept, no download; HTTP cache 0 MB                                       | pass                                                                                                     |

| Timing                                                           |     ms |
| ---------------------------------------------------------------- | -----: |
| Install (confirm → available offline, 2.26 GB)                   | 37,015 |
| Review open → first rule finding                                 |     87 |
| Review open → first Local AI finding (engine warm after install) |  2,656 |
| Rewrite Generate → ready                                         |  2,650 |
| Offline cold Review → first Local AI finding (cold engine load)  |  5,743 |

This run found and fixed two release blockers: Hugging Face redirects weights and
tokenizer to a regional `*.cdn.hf.co` host (now allowlisted in both CSP and the network
guard), and downloads went through Chrome's HTTP cache, leaving a 1.1 GB copy after
Delete (downloads now use `cache: "no-store"`).

## Runtime findings (all runs)

1. **`response_format: { type: "json_object" }` without a schema always fails in WebLLM
   0.2.85** (`GrammarMatcherInitError: … Cannot pass non-string to std::string`): the engine
   passes the undefined schema to xgrammar's `compileJSONSchema`. Reproduced on all five
   models. The product now passes `schema: AI_RESPONSE_SCHEMA`; a fixed schema string is compiled
   once and reused across requests.
2. **Thinking switch.** `enable_thinking: false` makes WebLLM prepend `<think>\n\n</think>\n\n`
   to the output, for any model (it is not family-checked; on Qwen2.5 it would inject the
   markup too, so the harness omits it there). Qwen3 1.7B/4B without it spend the budget
   on real reasoning (63/64 tokens of `<think>…` on a one-sentence request). Qwen3.5 2B/4B
   emit an empty think block by themselves either way (this build's template defaults to
   non-thinking); with the flag the output is identical apart from 4 tokens. The parser's
   "empty leading think block" tolerance is required for every Qwen3/3.5 response.
3. **Grammar-constrained output can still be invalid or degenerate.** Qwen3.5-2B ended 8/157
   Correct outputs with a stray `\"` before `}]}` (unterminated string, `finish: stop`);
   Qwen2.5-1.5B twice spun on whitespace (the schema allows any whitespace) until the token
   budget, which the parser correctly treats as truncation. Keep treating these as failures.
4. **Cancel-to-settle is bounded by prefill, not decode.** 1.5–1.7B models: 1–22 ms first pass, 39–141 ms final. Qwen3-4B:
   270–720 ms (first pass), 812–855 ms (final); Qwen3.5-2B: 340–560 ms; Qwen3.5-4B: ~1.2 s. In every slow case only the
   injected think block had streamed: the interrupt lands after the (uninterruptible)
   prefill. The worker-teardown bound should be well above 1.5 s for 4B-class models.
5. The validator gaps found in the first pass (British/American spelling, edge whitespace,
   code-adjacent brackets, noun-number flips after determiners, rewrite translation) and the
   two over-strict rejections were addressed before the final run; residual gaps are listed
   under the final results.

## History: first pass (prompt `review-ai-1` and harness-only `v2`)

Earlier the same day, before the prompt change, the validator fixes and the tier rename. Same
fixtures, device and harness; each fixture ran once. These numbers are superseded by the
final section above and kept for the record.

### Prompt `review-ai-1` (shipped at the time)

| Model        | Valid   | FP on unchanged | Corrected   | Wrong/partial | Correct p50 / p90 | Rewrite changed / inv. ok | Rewrite p50 / p90 | Cold load | 1st gen | Cancel p50 |
| ------------ | ------- | --------------- | ----------- | ------------- | ----------------- | ------------------------- | ----------------- | --------- | ------- | ---------- |
| Qwen3-1.7B   | 157/157 | 0/87            | 0/70 (0%)   | 0/70          | 506 / 621 ms      | 1/34 / 1/34               | 636 / 733 ms      | 1.3 s     | 0.47 s  | 1 ms       |
| Qwen3.5-2B   | 149/157 | 0/87            | 0/70 (0%)   | 0/70          | 1021 / 1182 ms    | 0/34 / 0/34               | 1166 / 1345 ms    | 1.7 s     | 1.4 s   | 346 ms     |
| Qwen2.5-1.5B | 155/157 | 2/87 (2.3%)     | 41/70 (59%) | 2/70          | 599 / 787 ms      | 6/34 / 6/34               | 732 / 836 ms      | 1.3 s     | 0.46 s  | 16 ms      |
| Qwen3-4B     | 156/157 | 0/87            | 3/70 (4%)   | 1/70          | 1118 / 1361 ms    | 3/34 / 3/34               | 1374 / 1571 ms    | 2.3–5.3 s | 1.9 s   | 386 ms     |
| Qwen3.5-4B   | not run |                 |             |               |                   |                           |                   | 2.5 s     | 2.8 s   |            |

The Qwen3/3.5 models **echo the input** under the shipped prompt: the model returned every
correction fixture verbatim in 70/70 (1.7B), 68/70 (3.5-2B) and 66/70 (3-4B) cases, and
almost every rewrite. Zero false positives here is abstention, not skill.

### Experimental prompt `v2` (harness-only at the time; now `review-ai-2`)

| Model        | Valid   | FP on unchanged | Corrected       | Wrong/partial | Correct p50 / p90 | Rewrite changed / inv. ok | Rewrite p50 / p90 | Cancel p50 |
| ------------ | ------- | --------------- | --------------- | ------------- | ----------------- | ------------------------- | ----------------- | ---------- |
| Qwen3-1.7B   | 157/157 | 0/87            | 13/70 (19%)     | 1/70          | 601 / 704 ms      | 10/34 / 10/34             | 650 / 784 ms      | 12 ms      |
| Qwen3.5-2B   | 150/157 | 0/87            | 8/70 (11%)      | 1/70          | 1184 / 1352 ms    | 7/34 / 6/34               | 1363 / 1496 ms    | 563 ms     |
| Qwen2.5-1.5B | 157/157 | 5/87 (5.7%)     | 48/70 (69%)     | 3/70          | 673 / 835 ms      | 7/34 / 7/34               | 881 / 1052 ms     | 18 ms      |
| **Qwen3-4B** | 157/157 | **0/87**        | **44/70 (63%)** | 1/70          | 1268 / 1497 ms    | 11/34 / 10/34             | 1682 / 1907 ms    | 696 ms     |
| Qwen3.5-4B   | 157/157 | 4/87 (4.6%)     | 62/70 (89%)     | 2/70          | 2030 / 2237 ms    | 20/34 / 15/34             | 2268 / 2483 ms    | 1199 ms    |

Rewrite by style, v2 (changed / invariants ok): Qwen3-4B keep-voice 1/8, professional 5/9
(4), concise 2/7, clearer 3/6, friendly 0/4. Qwen3.5-4B keep-voice 3/8 (2), professional
7/9 (4), concise 3/7 (2), clearer 3/6, friendly 4/4.

First download + cache population (this network, first run only): 1.7B 18 s, 3.5-2B 21 s,
2.5-1.5B 15 s, 3-4B 40 s, 3.5-4B 44 s. Cold load from cache in a fresh browser process
varied between runs for Qwen3-4B (2.3, 4.4, 5.3 s); the others stayed within 1.2–2.8 s.

### Validator rejections by reason (Correct segments / Rewrite proposals)

- review-ai-1: Qwen3-1.7B rewrite:quoted 1. Qwen3.5-2B quoted 8 (the stray-quote artefact),
  rewrite:quoted 1. Qwen2.5-1.5B placeholder 8, drift 3, technical-token 1, length 1;
  rewrite:placeholder 3, rewrite:quoted 1. Qwen3-4B length 1.
- v2: Qwen3-1.7B length 2; rewrite: placeholder 2, quoted 2, uncertainty 2, negation 2,
  name 1. Qwen3.5-2B quoted 5; rewrite: placeholder 4, uncertainty 2, technical-token 1,
  negation 1. Qwen2.5-1.5B too-many-edits 7, placeholder 6, drift 5, quoted 2, name 1;
  rewrite: placeholder 3, shape 1, quoted 1, negation 1, uncertainty 1. Qwen3-4B rewrite:
  uncertainty 3, negation 1, technical-token 1, invented 1. Qwen3.5-4B quoted 3,
  too-many-edits 1, length 1; rewrite: uncertainty 3, negation 2, placeholder 2, quoted 2,
  technical-token 1.

Blocked by validation (examples): Qwen2.5 and Qwen3-1.7B rewrote `6.3 GB, not 63 GB` with
swapped or invented quantities (rw-08); Qwen2.5 rewrote `1.0.9 … 1.0.10` as `1 … 2` (rw-20);
several models deleted the hedge in `It seems like maybe the tests are flaky` (rw-23).

### Meaning-changing edits that reached the user (human-checked)

| Model / prompt    | Correct mode (case ids)                                                                                                        | Rewrite (case ids)                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Qwen3-1.7B        | none                                                                                                                           | none                                                                          |
| Qwen3-1.7B v2     | none (fix-02 partial: `dont` → `don't`)                                                                                        | rw-pl-02 translated + tense changed                                           |
| Qwen3.5-2B (both) | none (v2: fix-02 partial)                                                                                                      | v2: rw-pl-02 `wrzuciłem` → `Wróciłem` (verb changed)                          |
| Qwen2.5-1.5B      | dialect: ambiguous-11; drift: fix-49 (`to busy` → `busy`); whitespace: pl-06; partial: pl-11                                   | none observed                                                                 |
| Qwen2.5-1.5B v2   | code: tech-04; dialect: ambiguous-10, ambiguous-11; number: fix-08; drift: fix-49; also ambiguous-16, mixed-04, fix-47 partial | rw-pl-02 translated (meaning kept)                                            |
| Qwen3-4B (both)   | none (fix-02 partial)                                                                                                          | v2: rw-pl-02 translated (meaning kept)                                        |
| Qwen3.5-4B v2     | golden spec-06 (`cant` → `cante`); pl-07 (person/mood); number: fix-07, fix-08; also casual-08, ambiguous-16                   | rw-pl-02 translated; rw-10 adds "of the initiative"; hedge swaps rw-03, rw-14 |

Coarse automatic flags (numbers, negation, hedges, capitalized names, word drift) are in each
model's `.cache/local-ai-bench/results/<model>.md`; the "name" flag on rewrites is mostly
sentence-initial capitalization and was checked by hand.

### Rewrite quality (reading ~10 outputs per model, v2)

Qwen3-4B stays close to the author: it fixes casing and punctuation, trims filler
("Please note that the
meeting, which was originally planned for Tuesday, …" becomes "The meeting, originally planned
for Tuesday, has been moved to Thursday at 10."), and keeps quantities and hedges ("I might be
late; the train is stuck."). It returns half of the fixtures unchanged, including every
friendly one, so Rewrite feels inert on short text. Qwen3.5-4B produces the most noticeable
style shifts and the only real friendly rewrites ("Thanks! The fix is now in main."), but
drifts toward corporate padding under professional ("Please consult Priya regarding the
rollout, as she is the owner of the initiative.") and swaps hedges. Qwen3-1.7B v2 rewrites are
short and plausible but over-cut under concise ("Meeting moved to Thursday at 10." — rejected
by the name guard; "Tests are flaky on Windows." — rejected for dropped uncertainty). Qwen2.5-1.5B
mostly echoes. No model invented greetings, sign-offs, apologies or deadlines on these fixtures.

### First-pass recommendation (adopted)

Criteria, in order: abstention / no false positives, zero meaning changes on golden
unchanged fixtures, correction usefulness, then latency.

- **The current registry choice is contradicted.** Qwen3-1.7B as Standard returns nothing
  useful with the shipped prompt (0/70 corrections, 1/34 rewrites) and only 13/70 with the
  improved prompt. It is safe but not a successful default.
- **Standard: Qwen3-4B**, together with prompt changes like `v2`. It is the only candidate with
  0/87 false positives, no meaning-changing edit and useful recall (44/70 exact corrections,
  1 partial) at ~1.3 s p50 / 1.5 s p90 per sentence on this device. Cost: 2.26 GB download,
  ~3.4 GB registry VRAM estimate, 0.5–0.7 s cancel settle.
- **No higher-quality tier yet.** Qwen3.5-4B corrects more (62/70) and rewrites better, but it
  changed a golden spec fixture (spec-06), changed meaning in Polish (pl-07) and flipped
  grammatical number (fix-07/08), at ~1.6× the latency and ~1.2 s cancel settle. Re-evaluate
  after the validator gaps above are closed.
- **If a smaller option is needed** for devices that cannot fit 4B, Qwen3-1.7B (v2 prompt) is
  the safe choice (0 FP) and should be labelled as giving fewer corrections. Qwen2.5-1.5B has
  better recall but accepted dialect, code and number changes; not recommended. Qwen3.5-2B is
  slower than Qwen3-1.7B with no quality gain and emits malformed JSON 5% of the time.
- Not verified: other GPUs/OSes, memory use, the integrated extension (offscreen worker,
  concurrent typing), multi-sentence paragraphs, Firefox. Polish is not advertised and the
  Polish rows are indicative only.

### First-pass prompt proposal (adopted as `review-ai-2`)

Measured as `v2` vs `review-ai-1` with parse and contract unchanged:

1. Send editable text under a different key than the answer: input
   `{"id":"s0","original":"…"}`, output `{"id":"s0","text":"…"}`, and say so in one line
   ("Each input segment has "original"; return its corrected or rewritten version as "text"").
   With identical keys the Qwen3 models copy the input object.
2. Add one short synthetic worked example to the system prompt: for Correct, two segments
   where one is corrected and one is left unchanged; for Rewrite, one before/after pair.
3. Put the task verb in the user turn ("Proofread these segments." / "Rewrite these segments
   in the selected style (professional).") and repeat the style instruction after the example.

Effect: Qwen3-4B corrections 3 → 44 of 70 with false positives unchanged at 0/87; Qwen3-1.7B
0 → 13; rewrites changed 3 → 11 (Qwen3-4B). Cost: ~85 more prompt tokens and ~150 ms p50.
Also required in the adapter regardless of prompt: pass `response_format.schema` (finding 1).
