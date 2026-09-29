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

For saved Correct outputs, the evaluator defaults to the current Standard/Gemma
chunking policy. Pass `--tier=compact` to `bun scripts/local-ai-eval/score.ts outputs.json`
for Compact single-sentence outputs. This selects request reconstruction only; it does
not run or change the model.

## Gemma Correct batching (2026-09-29)

**Applied for Recommended (Gemma); Compact keeps single-sentence requests.** Form greedy
groups of at most two sentences within the existing 400-character budget, then send
a pair together only when its
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

## Remaining latency and review UX (2026-09-29)

The follow-up keeps the evaluated model requests unchanged. Review now shows a
localized percentage during checking (successful chunks, including cache hits), and
labels the 1.5-second edit debounce as waiting for edits instead of loading the model.
Percentages are not time estimates; chunks differ in length. Only pass completion is
announced to screen readers, so incremental results do not cause repeated announcements.

A request-key experiment used the actual chunker and `aiRequestForChunk`, with the
supplied broken passage and a fully populated session cache. Each row is one independent
edit against the original passage, not cumulative edits:

| Edit                                               | Cached requests reused | New requests |
| -------------------------------------------------- | ---------------------: | -----------: |
| Opening `last monday` → `Last Monday`              |                     55 |            3 |
| Middle `more faster` → `faster`                    |                     54 |            4 |
| Final `nobody have checked` → `nobody has checked` |                     56 |            2 |
| Delete the opening sentence and following space    |                     10 |           47 |

The baseline is 58 requests. Small edits already reuse most completed work. A sentence
removal shifts pair boundaries, so many requests really change; reusing their old
answers would weaken the exact-input guarantee. Applying the opening fix after only
one request has completed leaves zero cache hits and 58 requests to do. After ten
completed requests, seven are reused and 51 remain. The active request is also cancelled,
and rechecking waits 1.5 seconds. This explains why applying early results can feel slow
even though the engine is making progress. The existing AI batch preview applies multiple
reviewed fixes in one verified transaction and avoids repeating that cycle per fix.

In the two fresh interleaved timing rounds above, paired requests spent 32.91 of 76.33
seconds (43.1%) before their first generated token; median time to first token was 1.37
seconds. This includes prompt processing and runtime overhead, not just tokenization.
The remaining 43.42 seconds were spent after the first token. The engine currently
reprocesses the complete prompt for every request. Lowering `max_new_tokens` alone will
not speed up responses that already stop naturally, and risks truncation instead.

Next experiments, in priority order:

1. **Reuse the fixed prompt prefix in the same loaded engine.** This targets repeated
   prompt processing without shortening instructions or changing Gemma. The installed
   runtime exposes past key/value tensors, but safe cross-request reuse, correct positions,
   cancellation, GPU memory ownership and identical outputs still need a dedicated real-GPU
   experiment. The 43.1% figure is not a promised saving: only part of that work is reusable.
2. **Make batching resilient to sentence insertion/deletion.** Paragraph boundaries are
   a candidate. The 47-request invalidation above is the measured motivation. Different
   neighbours have already changed correction quality, so this needs the full stress and
   negative-control evaluation before shipping.
3. **Reduce time to the first AI result.** Cold model loads measured 6–10 seconds in the
   benchmark runs. Keeping Review open avoids reloading; closing the last Review deliberately
   releases GPU memory. A warm-retention policy requires measured GPU memory and an explicit
   resource-lifetime decision. Splitting just the first pair could improve first-result
   latency but increases total work and must preserve later pair boundaries.

Not adopted: removing context (measured quality loss), weaker output validation, automatic
application of AI findings, or speculative concurrent generations on the same GPU. These
changes do not have evidence of a safe quality/performance tradeoff.

## Prompt reuse, incremental pairs and text-only loading (2026-09-29)

Three follow-up changes keep Gemma's pinned revision, q4f16 text weights, instructions,
context and validation intact:

- **Original fixed instruction prefix:** reuse the first 400 tokens only after matching them to
  a synthetic, text-free Correct prompt. The cache is 22,937,600 bytes (21.875 MiB) on
  the CPU, bounded to 32 MiB. Each generation gets its own mutable KV cache, disposed
  on success or failure. CPU downloads explicitly release the former GPU tensors.
  A first Correct request runs normally: the prefix is prepared only when a second
  request needs it, so a one-request review pays no setup cost.
  Cancellation during preparation never counts as an engine failure. Closing the
  last Review still unloads the model and discards this cache.
- **Incremental grouping:** unchanged pairs in the previous review plan anchor the
  next plan. Answers are still reused only for identical complete requests, including
  surrounding context, model and prompt version. All offsets and protected markers
  are rebuilt against the current snapshot. Initial grouping is unchanged: verified
  on both stress passages and all 230 fixtures (232/232 identical plans).
- **Text-only loading:** `Gemma4ForCausalLM` uses the same text embedding and decoder
  sessions as the conditional loader; its inherited forward implementation is unchanged.
  Audio and vision encoders are neither loaded nor included in new installs. This
  removes 273,379,300 bytes from the download (now 4,924,964,491 bytes), while existing
  verified installs remain usable. The existing obsolete-file cleanup removes the
  unneeded cached files. No GPU warm-retention period was added.

### Measurements

The prefix probe ran eight stress requests twice, in opposite baseline/prefix order
with one warm model. Total generation time fell from **47.478 s to 34.672 s (27.0%)**.
All 16 raw outputs matched exactly. Prefix preparation cost 1.037 s once per load;
that setup cost is excluded from the warm-generation percentage. This gain is measured
on top of short-sentence pairing, not independently additive to its earlier 31.1% gain.

The complete prefix experiment checked 117 stress requests and 230 regression fixtures.
Both stress passages retained identical accepted findings. 229/230 fixtures retained
identical accepted text; the dense paragraph additionally gained a comma before an
independent clause joined by “and”. No accepted correction was lost, and none of the
119 unchanged controls was changed. Small numerical differences from splitting prompt
processing can alter model output, so prefix caching is quality-tested, not assumed
bit-identical. The final runtime wrapper, using the text-only loader, repeated the full corpus: all
117 stress requests and all 230 fixtures parsed successfully and reproduced the same
accepted findings, including that one additional comma. The final snapshot-deletion
run generated only two fresh requests and preserved every surviving baseline finding.

An A/B/B/A comparison of conditional versus text-only loading, with the actual prefix
wrapper, measured mean cached-model load times of **6.276 s versus 5.100 s**. Time from
load start to the first completed correction was **9.024 s versus 7.768 s**. All four
outputs matched. The runs confirmed four inference sessions before and only the two
text sessions afterward. A second A/B/B/A run with deferred prefix preparation gave
4.924 s versus 3.587 s for loading and 7.417 s versus 6.109 s to the first completed
correction, again with all outputs identical. Cache warmth produced substantial variance
between runs; these timings are observations, not fixed latency guarantees. This is a same-browser, disk-cache comparison on the test Mac;
it does not promise the same savings on other devices or after a machine restart.

On the supplied stress passage, deleting its first sentence now reuses **55 of 57**
requests: **2 new requests instead of 47**. The initial plan still has 58 requests. The real-Gemma deletion replay lost no accepted
findings and added none.
Small word edits still invalidate only the affected text and nearby context (2–4
requests in the measured cases).

Rejected: resetting pairs at paragraph boundaries also reduced deletion rechecks to
2 requests, but increased the initial plan to 62 requests and lost the accepted
“many useful feedbacks” → “much useful feedback” correction. Preserving prior pairs
avoids changing the initial prompt grouping.

The integrated extension test also exposed a cold-load failure: after a verified install,
evicting a weight file could leave ONNX loading for over two minutes. The host now checks
cache completeness again before allocating the GPU, returns the existing reinstall state
for an incomplete cache, and does not start a late load after cancellation during that
check. This uses the existing cache-state verifier and does not add a network request.

### Remaining quality limits

Validator experiment (2026-09-29): the short `She dont knows.` → `She doesn't know.`
case now passes as one atomic finding only when the unchanged subject is `he`,
`she`, or `it`, the negative auxiliary becomes `doesn't`, the following verb
returns to its base form, and spacing/punctuation are unchanged. The 50% and
four-word limits remain in place for other proposals. Correct-mode rejection
counts now distinguish changed-word share, lexical substitution, optional
style, and oversized units; counts remain text-free.

Manual sample from the saved Gemma 4 E4B full Correct run, checked against the
explicit fixture targets (four selected rejections, not a representative
rate): `dense-05` correctly blocked a pronoun substitution; `dense-10`
correctly blocked a stylistic subject reorder; `dense-13` correctly blocked
a dialect-dependent collective-noun agreement change; `heldout-08` lost a
legitimate correction because it requires a broader clause restructure.
The last case remains blocked pending a specific rule for that construction.

The original stress run rejected 33 proposed change units as wording drift, 10 as
quoted text, 3 as number changes, 2 as negation changes, and one each as too many changed
words, a technical-token change and a name change. These counts are not all missed
errors: the corrected reference also had four proposals rejected correctly. Increasing
all guard limits would therefore be unsafe. A useful next quality experiment is a
separate, narrowly proved rule for compound-subject pronouns and agreement; the first
stress sentence's large change unit currently exceeds the four-word guard. The existing
quoted-example and style restrictions remain intentional.

## Longer instruction prefix (2026-09-29)

The final 400-token wrapper was re-profiled on the M2 Max with the pinned Gemma 4
text-only loader and the same eight Correct requests in alternating order. A synthetic
prompt varied `contextBefore`, `contextAfter` and segment text; its first differing token
was 485. The runtime also checks the exact token prefix for every request. Thus 512 and
576 tokens cannot be reused safely, regardless of memory budget. We compared 400, 448
and 480 tokens. The 480-token cache is 27,525,120 bytes (26.25 MiB), below the existing
32 MiB cap; 400 tokens used 21.875 MiB.

| Measure, one warm model                                 | No prefix | 400 tokens | 448 tokens | 480 tokens |
| ------------------------------------------------------- | --------: | ---------: | ---------: | ---------: |
| Eight requests, including first request and preparation |   24.63 s |    19.34 s |    19.02 s |    18.80 s |
| First two requests, including preparation               |    5.74 s |     5.56 s |     5.54 s |     5.63 s |
| Last six requests, cache prepared                       |   18.89 s |    13.78 s |    13.48 s |    13.17 s |
| Last six, before first generated token                  |    8.47 s |     3.59 s |     3.17 s |     2.90 s |

All 32 responses were byte-identical. Prefix preparation took 0.95, 0.99 and
1.12 seconds for 400, 448 and 480 tokens; downloading its GPU tensors to CPU took
54, 20 and 21 ms respectively in this run. The preparation samples are noisy, so
the small whole-review gain is more useful than an isolated prefill number. The
400-token baseline spent **26.0%** of the last six requests before their
first token; 480 tokens spent **22.0%**. The older **43.1%** measurement predates
prefix reuse and is not the current optimization budget.

The queue probe saw 2–4 MiB of `writeBuffer` traffic and 18–40 ms in each request,
without a detectable difference between baseline and cached modes. This does not
isolate every possible transfer path in Transformers.js/ONNX Runtime, particularly on
an M2 Max with unified memory. The full CPU-backed 480-token wrapper reproduced the
accepted findings from all 117 stress requests and 230 fixtures, with no generation errors.
Local raw data: `.cache/local-ai-bench/results/gemma-prefix-lengths-2026-09-29.json`
and `gemma-prefix480-full-2026-09-29.json` (ignored, synthetic text only).

## GPU-resident instruction prefix (2026-09-29)

The next experiment kept the verified 480-token prefix on the WebGPU device. The
master owns the output GPU buffers (28 MiB of actual buffer allocations). Every
request wraps those buffers in its own non-owning ONNX Runtime tensors, so
`DynamicCache.update()` and `dispose()` release only that request's wrappers;
unload waits for active requests before disposing the master. No GPU tensor is
downloaded to CPU to prepare the prefix. This follows the resource lifecycle in
[ONNX Runtime's WebGPU guidance](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
and [Transformers.js's cache API](https://huggingface.co/docs/transformers.js/api/generation/cache).

The same eight-request paired probe, with one warm model and alternating order,
measured **17.945 s CPU-backed versus 17.915 s GPU-resident** for all eight;
the last six were **12.921 s versus 12.923 s**. All responses were byte-identical.
Across the 117 stress requests on the production GPU wrapper, time before the
first generated token was **61.72 of 267.21 seconds (23.1%)**, with a 505 ms
median. This replaces the pre-prefix 43.1% figure as the measured current
breakdown for that workload.
These differences are below run-to-run noise on the M2 Max. The GPU path is kept
to avoid a separate-memory transfer on other devices; its benefit there is
unverified. Raw data: `.cache/local-ai-bench/results/gemma-gpu-v-cpu-prefix-2026-09-29.json`
(ignored, synthetic text only).

The production GPU wrapper reproduced the recorded raw responses and accepted
findings for all 117 stress requests, and the accepted findings for all 230
fixtures. No generation failed. Raw results:
`.cache/local-ai-bench/results/gemma-prefix480-gpu-full-2026-09-29.json`.

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

The optimized production extension was rerun on 2026-09-29: all 14 steps passed.
First rule finding: 52 ms; first Local AI finding: 7.94 s; dense paragraph first AI
finding: 7.98 s and complete: 18.65 s; unload: 102 ms; Rewrite: 7.24 s; offline cold
first finding: 6.86 s. Installation took 101 s. The partial-cache check returned the
reinstall state without network access, and deletion left no model copy. Privacy
sentinel checks passed. These are individual runs, not controlled latency comparisons.
The final follow-up clears a misleading save-error message from that partial-cache
state; its host regression test passes.

The GPU-resident production build passed all 14 real-GPU Chrome steps on 2026-09-29,
including multi-request Correct, unload, Rewrite, offline reload, incomplete-cache
handling, privacy checks and deletion. First Local AI finding: 8.20 s; dense review
complete: 19.22 s; unload: 103 ms. These are one integrated run, not a paired
performance comparison with the CPU-backed build.

## Not verified

Other GPUs and operating systems, integrated or low-memory GPUs, measured memory use,
run-to-run variance, Edge and Firefox in a browser, contenteditable and rich editors with a
real model (covered by unit and existing e2e tests).
