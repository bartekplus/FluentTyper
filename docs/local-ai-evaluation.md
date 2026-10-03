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
aiMaxOutputTokens(request)`.
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

This original evaluation used `Gemma4ForConditionalGeneration` for Gemma 4, including
about 0.27 GB of unused audio/vision encoders. The later text-only loader evaluation
below uses the same pinned text weights without those encoders.

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

**Decision at the original run.** Gemma 4 E4B found the most errors of every model tested.
The re-scored row in the table above gives the current-validator replay results.
Qwen3-4B-Instruct-2507 is the smaller option at 56% of the download and ~40% of the
cold-load time.

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

For saved Correct outputs, the evaluator defaults to the current Standard/Gemma
chunking policy. Pass `--tier=compact` to `bun scripts/local-ai-eval/score.ts outputs.json`
for Compact single-sentence outputs. This selects request reconstruction only; it does
not run or change the model.

## Decisions

These decisions come from real-GPU runs of Gemma 4 E4B (q4f16, Transformers.js 4.3.0,
Chrome, Apple Metal WebGPU). The timings are single-device observations, not guarantees.

- **Pairs for Recommended (Gemma).** Correct groups at most two sentences. It sends a pair
  only when the editable text is 200 characters or less. It splits a larger pair into two
  single requests and does not regroup the neighbours. One sentence keeps the 400-character
  limit, and context stays 300 characters on each side. Compact keeps one sentence per request.
  Pairs used about 31% less generation time on the eligible sentences, with the same
  accepted fixes. Wider 400-character pairs and greedy 200-character packing lost fixes.
- **Stable pairs after edits.** Unchanged pairs from the previous plan anchor the next plan.
  Answers are reused only for identical complete requests (context, model and prompt version
  included). When you delete the first sentence of the stress passage, 2 requests run
  again instead of 47. Pair resets at paragraph boundaries lost a fix, so we did not use them.
- **480-token instruction prefix on the GPU.** The engine reuses the fixed prompt prefix in
  the loaded model. The first differing token of the synthetic prompt is 485, so a longer
  prefix is not safe. The cache is 26.25 MiB, below the 32 MiB cap. It is prepared only
  when a second request needs it. Responses stay byte-identical to the uncached path.
- **Text-only loader.** `Gemma4ForCausalLM` loads only the text embedding and decoder
  sessions. New installs do not download the audio and vision encoders (273 MB less).
- **Wider Correct validator.** Correct mode has no sentence-wide limit on changed words.
  A unit with three or more changed words becomes one manual review card. The number,
  negation, uncertainty, name, quotation, protected-text and edit-boundary guards stay.
  AI cards never enter Fix all.
- **Not adopted.** Removing context (quality loss), shorter `max_new_tokens`, weaker output
  validation, automatic application of AI findings, and concurrent generations on one GPU.

## Languages

English only. Both earlier shipped models damaged the Polish rewrite fixture rw-pl-02
(a non-word or a wrong-tense verb): the translation guard does not catch a same-language
wrong word. Other languages need their own evaluation first.

## Integrated extension run

The GPU-resident production build passed all 14 real-GPU Chrome steps of `bun run test:local-ai:real` on 2026-09-29,
including multi-request Correct, unload, Rewrite, offline reload, incomplete-cache
handling, privacy checks and deletion. First Local AI finding: 8.20 s; dense review
complete: 19.22 s; unload: 103 ms. These numbers come from one integrated run.

## Not verified

Other GPUs and operating systems, integrated or low-memory GPUs, measured memory use,
run-to-run variance, Edge and Firefox in a browser, contenteditable and rich editors with a
real model (covered by unit and existing e2e tests).
