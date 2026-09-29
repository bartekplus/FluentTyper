# Local AI Review: model evaluation

Status: 2026-09-28. **Engine: Transformers.js 4.3.0 (ONNX Runtime Web
1.31.0-dev.20260914, WebGPU). Recommended = Gemma 4 E4B, Compact =
Qwen3-4B-Instruct-2507, prompt `review-ai-3`.** One device (Apple M2 Max, Metal, headless
Chrome for Testing 154 with `--enable-unsafe-webgpu`), synthetic fixtures, each fixture ran
once: a regression gate and a model-selection input, not evidence of population-wide
accuracy. Design context: [local-ai-review.md](local-ai-review.md).

## Method

- Fixtures: `tests/fixtures/local-ai/` (230 Correct: 119 expected unchanged, 111
  corrections; 35 Rewrite). Requests are built and outputs scored by the shipped code
  through `scripts/local-ai-eval/score.ts` (`buildAiChunks` → `aiRequestForChunk`;
  `parseAiResponse` → `correctionFindings` / `rewriteProposal`).
- The numbers were recorded on 2026-09-28 with the since-removed benchmark harness
  `scripts/local-ai-bench/` (commit `250a077b`): Puppeteer page running the registry models,
  the model's chat template (`enable_thinking: false` where it has the switch), greedy
  decoding for Correct, temperature 0.4 for Rewrite, `max_new_tokens =
aiMaxOutputTokens(request)`. The full per-model tables of earlier runs are in that commit's
  version of this file.
- Screening set (112 fixtures, 122 requests): `dense-01…20` + `dense-para-01` (a user report;
  91 expected word-level fixes), `heldout-01…20` (45 fixes, measurement only), and 108
  correct-text fixtures that must stay unchanged (`dense-ok-*`, `heldout-ok-*`, `spec-*`,
  `ambiguous-*`, `tech-*`). Recall = expected word-level fixes the output also makes;
  "model" is the raw proposal, "accepted" is what the validator let through.

## Results

Screening set, Correct mode:

| Model (repo @ revision)                                                                   | Download | Invalid | Recall dense / held-out (model) | Accepted dense / held-out | Fully / partly fixed (of 41) | Correct text changed (accepted)           | p50 / p90 ms per sentence | Cold load |
| ----------------------------------------------------------------------------------------- | -------: | ------- | ------------------------------- | ------------------------- | ---------------------------- | ----------------------------------------- | ------------------------- | --------- |
| **Gemma 4 E4B** (`onnx-community/gemma-4-E4B-it-ONNX` @ `843f250f`)                       |  5.20 GB | 0/122   | 85% / 89%                       | **78% / 84%**             | **28 / 12**                  | 2: ambiguous-16, dense-ok-17              | 1921 / 2190               | 9.6 s     |
| Gemma 4 E2B (`onnx-community/gemma-4-E2B-it-ONNX` @ `9f4bef82`)                           |  3.38 GB | 3/122   | 76% / 78%                       | 69% / 76%                 | 22 / 18                      | 3: ambiguous-16, dense-ok-15, dense-ok-17 | 1838 / 2053               | 6.5 s     |
| **Qwen3-4B-Instruct-2507** (`onnx-community/Qwen3-4B-Instruct-2507-ONNX` @ `41a4dd4d`)    |  2.90 GB | 0/122   | 63% / 60%                       | 63% / 58%                 | 18 / 19                      | 1: ambiguous-16                           | 1570 / 1747               | 4.5 s     |
| Qwen3-4B (`onnx-community/Qwen3-4B-ONNX` @ `98ddba15`), previous engine default's weights |  2.83 GB | 0/122   | 49% / 42%                       | 49% / 42%                 | 11 / 21                      | 1: ambiguous-16                           | 1719 / 1881               | 6.4 s     |

Gemma 4 uses the multimodal ONNX export (`Gemma4ForConditionalGeneration`, text only; ~0.27
GB of the download are unused audio/vision encoders).

Full suite (230 Correct fixtures / 246 requests; Gemma also 35 Rewrite and 5 cancel runs):

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

The six accepted changes to correct text were punctuation or style, none changed meaning
(`Ok cool.` → `Ok, cool.`; a comma before a quotation; `If I was you` → `were`; `Assistant:
sure` → `Sure`; `The data are … never leave` → `The data is … never leaves`). The validator
now rejects these classes (interjection commas, a comma before an opening quote, subjunctive
`was`/`were`, case after a colon, verb number with collective nouns); the only recall given
up is `Our team have` → `has`. No accepted English change to a number, negation, hedge or
name.

Rewrite (Gemma 4 E4B, 35 fixtures): 23 changed and validated, 18 with all fixture
invariants; 8 rejected (uncertainty 4, technical-token 2, negation 1, quoted 1). One real
drift: rw-04 (`when the thing restarts` → `when the system restarts`); the other invariant
misses are synonym-level (`might` → `may`, `forever` → `indefinitely`). rw-21 dropped a
"with". The user's dense paragraph
came back fully corrected in one pass. No greeting, sign-off, apology or deadline was
invented. Compact's Rewrite was not run on Transformers.js.

**Decision.** Gemma 4 E4B found the most errors of every model tested and, with the current
validator, changes no correct text on the full suite. Qwen3-4B-Instruct-2507 is the smaller
option at 56% of the download and ~40% of the cold-load time.

**Other candidates.** Of the other models screened (13 on WebLLM 0.2.85, 7 more
Transformers.js-only exports), none reached both ≥ 78% dense and ≥ 84% held-out accepted
recall (WebLLM's best: Qwen3.5-9B 78% / 69% and gemma-2-9b 70% / 84%, both 5+ GB). Without grammar-constrained
decoding several small models mostly broke the JSON contract (granite-4.0-micro 107/122
invalid, SmolLM3-3B 105/122, SmolLM2-1.7B 54/122, gemma-3-1b 39/122); the single-file
Qwen3-1.7B ONNX export failed to load (`std::bad_alloc`).

## Why Transformers.js

WebLLM's per-model compiled libraries (`mlc-ai/binary-mlc-llm-libs`) carry no license.
Transformers.js ships one generic MIT/Apache-2.0 runtime, and a model is data only. Same
model and prompt on both engines (Qwen3-4B): p50 1719 vs 1793 ms, accepted recall dense 49%
vs 49%, held-out 42% vs 47%, identical correct-text changes; cold load slower (6.4 vs 3.4 s).
Transformers.js 4.3.0 has no grammar-constrained decoding, so the JSON contract is
unconstrained (0/122 invalid for the shipped models). A plain-text contract was 30–40%
faster but raised correct-text changes for most models; not adopted.

## Prompt findings

- **Separate input and output keys** (`review-ai-2`). Under `review-ai-1` the Qwen3 models
  returned 66–70 of 70 correction fixtures verbatim. Sending the text as `original`,
  answering as `text`, one worked example, and the task verb in the user turn took
  Qwen3-4B from 3 to 44 of 70 corrections with false positives unchanged (0/87), for ~85
  more prompt tokens.
- **Name the error classes; one sentence per request** (`review-ai-3`). A user's
  error-dense paragraph got almost no findings: the model copied dense sentences back, and
  several sentences per request made it fix only the first. Naming the error classes with a
  multi-error example raised Qwen3-4B's model-level recall on the 20 dense sentences from
  11/57 to 32/57, correct-prose controls untouched. The validator now checks each change
  on its own, and Rewrite keeps a failing sentence as written instead of discarding the
  proposal.
- Four further Correct-prompt variants gained at most 4 of 45 held-out fixes, on a held-out
  set that had informed them; not adopted.

## Gemma Correct batching (2026-09-29)

**Applied for Recommended (Gemma); Compact keeps single-sentence requests.** Form pairs
in document order, then send a pair together only when its
editable text fits within 200 characters. Split larger pairs into two single requests
without regrouping their neighbours. Individual sentences retain the existing
400-character limit; context remains 300 characters on each side. Segment IDs, protected
markers, validation, cancellation, the session cache and the `review-ai-3` prompt stay
on the existing paths. Gemma 4 E4B, its revision and precision are unchanged.

Real-GPU evaluation used the pinned `843f250f23bc91754def1e0f0db390dacd1e6b05`
ONNX export, q4f16, Transformers.js 4.3.0, Chrome 154 and Apple Metal WebGPU. The base was
`f61e6bd5`, including the pending validator guard against optional commas before “too”.

| Check                                             |           One segment |          Stable pairs |
| ------------------------------------------------- | --------------------: | --------------------: |
| Requests for the supplied broken stress passage   |                    98 |                    58 |
| Requests for its corrected reference              |                   102 |                    59 |
| Accepted changes to the corrected reference       |                     0 |                     0 |
| Regression fixtures with identical accepted text  |                     — |               230/230 |
| Correct-text fixtures changed                     |                 0/119 |                 0/119 |
| Accepted expected fixes: dense / held-out / other | 70/91 / 38/45 / 69/69 | 70/91 / 38/45 / 69/69 |
| Fresh timing round 1: same 24 sentences           |               55.07 s |               37.92 s |
| Fresh timing round 2: same 24 sentences           |               55.65 s |               38.41 s |

The two timing rounds alternated single-first and pair-first order with a warm model,
without overlapping builds or browser tests. Paired work took **31.1% less generation
time** overall (31.1% and 31.0% in the individual rounds), using 48.2% fewer input tokens.
This is a measurement of the sentences eligible for pairing, not a claim that the whole
review is 31.1% faster. Median time to one response increased from 2.28 s for a single
sentence to 3.19 s for a pair; the rules still appear immediately.

All 24 fresh pair outputs and 48 fresh single outputs exactly matched the evaluated outputs. Quality evaluation
first generated both complete stress passages and all 230 regression fixtures with
400-character pairs. The final planner's 117 stress requests and 234 fixture requests
all matched a measured prompt and response shape from that run or the saved single-segment requests;
we replayed their raw results through the current validator. No unmeasured request was
substituted. The fixtures' accepted text stayed identical, including the dense paragraph.
The 70/91 baseline includes the existing decision to preserve the dialect choice
“Our team have”; the older table above predates that validator guard.

In the complete ReviewSession replay, including rules and Presage spelling, the broken
passage produces 154 cards versus 155 before: “User” becomes “The user” rather than
“Users”, and an optional comma after an introductory date phrase is no longer offered.
The month capitalization remains covered by the rules. Neither change loses a required
grammar correction. The corrected passage produces zero cards through this combined path as well.
Finding counts are not recall: multiple cards can refer to one expected correction, and
quoted examples, protected content and style choices remain deliberately restricted.

Two rejected alternatives explain the limits:

- Unrestricted two-segment/400-character pairs were faster and passed the 230 fixtures,
  but the stress passage lost “many” → “much” before “useful feedback”.
- Greedily packing to 200 characters moved pair boundaries and copied an article-heavy
  sentence unchanged, losing four previously accepted fixes. Splitting oversized pairs
  without regrouping preserves those fixes.

The smaller 24-sentence probe had missed both effects. Removing context was also left
out: its roughly 9% speed gain came with changed findings, including a missed punctuation
fix. Prompt shortening and changing the JSON contract were not part of this change.

The temporary benchmark driver was restored from `250a077b` under
`/tmp/fluenttyper-stress-root/scripts/local-ai-bench/`; it imports the current product
prompt, chunker, parser and validator. Raw local evidence is in
`.cache/local-ai-bench/results/gemma-stable-pairs-2026-09-29.json` and the corresponding
`gemma-wide-pairs-2026-09-29.json`. These ignored files contain the supplied test passage
and are not packaged with the extension. Regression tests cover pair boundaries,
character limits, protected markers, independent validation, progressive findings,
staleness and cache reuse.

Validation: `bun run check`, the complete unit suite, Chrome smoke and full E2E,
coverage-matrix validation, and Chrome/Firefox production artifact checks passed.
Firefox full E2E remains unverified: after installing the required Puppeteer Firefox,
both it and the system Firefox exited before startup with “Could not find profile
folder”, including explicit temporary profiles. This was a browser-startup failure,
not a passing Firefox regression run.

## Languages

English only. Both earlier shipped models damaged the Polish rewrite fixture rw-pl-02
(a non-word or a wrong-tense verb): the translation guard does not catch a same-language
wrong word. Other languages need their own evaluation first.

## Integrated extension run

`bun run test:local-ai:real` (production Chrome build, engine in the background service
worker, Gemma 4 E4B, same device, 2026-09-28; all 14 steps pass): install 153 s (5.2 GB);
first Local AI finding 7.7 s after Review opens (the model loads from disk each time); the
user's 10-sentence paragraph complete in 29 s; model unloaded 1.1 s after the Review closes;
Rewrite 7.8 s; offline cold start → first finding 7.5 s; a partial cache fails honestly;
Delete leaves no copy (HTTP cache included); no sentinel text in storage, console or
profile files.

## Not verified

Other GPUs and operating systems, integrated or low-memory GPUs, measured memory use,
run-to-run variance, Edge and Firefox in a browser, contenteditable and rich editors with a
real model (covered by unit and existing e2e tests).
