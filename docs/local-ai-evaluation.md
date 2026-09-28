# Local AI Review: model evaluation

Status: first real-device measurement, 2026-09-28. One device, synthetic fixtures,
sentence-sized inputs. This is a regression gate and a model-selection input, not
evidence of population-wide accuracy. Design context: [local-ai-review.md](local-ai-review.md).

## How it was measured

Harness: `scripts/local-ai-bench/` (opt-in, real GPU only).

```sh
bun scripts/local-ai-bench/run.ts --real [--models=<id>,…] [--prompt=product|v2] [--tag=name]
bun scripts/local-ai-bench/report.ts     # per-model Markdown/JSON + headline table
```

Registry models use the packaged libraries in `public/local-ai/libs/`. Non-registry
candidates need `FT_LOCAL_AI_LIBS` (directory with their `*_cs1k-webgpu.wasm`) and
`FT_LOCAL_AI_PROBE` (JSON with pinned revision, weight bytes, lib sha256/SRI per model id).

- Puppeteer's Chrome for Testing with `--enable-unsafe-webgpu`, a persistent profile and
  results under `.cache/local-ai-bench/` (git-ignored). The page is served from
  `http://localhost:47811` (secure context; fixed port so the per-origin weight cache hits).
- The run exits non-zero without `--real`, and fails loudly (`no usable WebGPU adapter`,
  exit 1) when there is no adapter or no `shader-f16`; verified by launching Chrome with
  WebGPU disabled. There is no CPU or mock fallback.
- The page bundles the **real** `@mlc-ai/web-llm` and the product's `buildAiMessages`,
  `aiMaxOutputTokens` and `parseAiResponse`. The model record is built like the product's:
  `https://huggingface.co/<repo>/resolve/<pinned revision>/`, `model_lib` served locally,
  `integrity.model_lib` SRI (sha384, `onFailure: "error"`), `required_features:
["shader-f16"]`, WebLLM's prebuilt overrides plus `context_window_size: 4096`.
- Generation: `n: 1`, `stream: true` with `include_usage`, `seed: 42`, temperature 0
  (Correct) / 0.4 (Rewrite), `max_tokens = aiMaxOutputTokens(request)`,
  `extra_body.enable_thinking: false` for Qwen3 and Qwen3.5 (omitted for Qwen2.5),
  `resetChat()` before every request, and `response_format: { type: "json_object", schema }`
  with the response contract as a JSON schema (see finding 1).
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
| Prompt         | `review-ai-1` (shipped templates) and `v2` (harness-only experiment)                                                                                 |
| Fixtures       | 157 Correct (87 expected unchanged, 70 expected corrections; 16 Polish), 34 Rewrite (8 keep-voice, 9 professional, 7 concise, 6 clearer, 4 friendly) |
| Samples        | one pass per fixture per model/prompt; 5 cancel runs                                                                                                 |

| Model                               | Pinned revision                            | Lib sha256 (first 16) | Weights download |
| ----------------------------------- | ------------------------------------------ | --------------------- | ---------------: |
| `Qwen3-1.7B-q4f16_1-MLC`            | `80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc` | `8161aaa4b40bccf1`    |          0.97 GB |
| `Qwen3.5-2B-q4f16_1-MLC`            | `dd74e9c8a20c4546df85c844103bff87b6dcacad` | `b0f951d411e4fd59`    |          1.06 GB |
| `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | `9bd564b064631febf14deadcac492efb761d60c3` | `0fceb50bbaf47efd`    |          0.87 GB |
| `Qwen3-4B-q4f16_1-MLC`              | `a5c9fab855e3ccbdfed2e7e69683d75f30332161` | `a986a53c92579714`    |          2.26 GB |
| `Qwen3.5-4B-q4f16_1-MLC`            | `44b42469f9e192814bfd90440e3b377d89ba7a13` | `7e8f9895daa710a8`    |          2.37 GB |

Download bytes are the pinned revisions' weight shards (registry / probe), not measured
transfer. Memory was not measured (registry VRAM estimates only).

## Findings that affect the product regardless of model

1. **`response_format: { type: "json_object" }` without a schema always fails in WebLLM
   0.2.85** (`GrammarMatcherInitError: … Cannot pass non-string to std::string`): the engine
   passes the undefined schema to xgrammar's `compileJSONSchema`. Reproduced on all five
   models. Workaround used here: pass `schema` (a JSON-schema string of the response
   contract). A generic schema string is compiled once and reused across requests.
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
4. **Cancel-to-settle is bounded by prefill, not decode.** 1.5–1.7B models: 1–22 ms. Qwen3-4B:
   270–720 ms; Qwen3.5-2B: 340–560 ms; Qwen3.5-4B: ~1.2 s. In every slow case only the
   injected think block had streamed: the interrupt lands after the (uninterruptible)
   prefill. The worker-teardown bound should be well above 1.5 s for 4B-class models.
5. **Validator gaps observed (Domain):** accepted in Correct mode: `user.save()` →
   `user.save(` (Qwen2.5 v2, tech-04), British→American spelling (ambiguous-10/11), a
   trailing space (pl-06), grammatical number flips `My friends is` → `My friend is`
   (fix-07/08), `cant` → `cante` (spec-06), Polish `Zadzwonię` → `Zadzwoń` (pl-07, person/mood
   change). In Rewrite: rw-pl-02 was **translated from Polish to English** and accepted
   (Qwen3-1.7B v2 even changed "I pushed" into "I will send"; Qwen3.5-2B v2 kept Polish but
   replaced the verb with "I returned"); hedges replaced by synonyms
   (`probably` → `likely`, `might` → `may`) pass. Over-strict rejections: `nope, not
happening` → `No, not happening` rejected as negation; `Not sure…` → `Not sure…. Could
someone…` rejected as uncertainty.

## Headline results

Correct = 157 fixtures; FP = a finding offered on an expected-unchanged fixture; Corrected =
applying the offered findings yields exactly the expected text; Wrong/partial = findings
offered on a correction fixture that do not yield the expected text. Rewrite "changed" = a
validated, non-identical proposal; "inv. ok" = changed and the fixture's must-keep /
forbidden-word invariants hold. Latency is per fixture (mostly one sentence, ~315–420 prompt
tokens, ~20 completion tokens at p50).

### Shipped prompt (`review-ai-1`)

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

### Experimental prompt `v2` (harness only, `scripts/local-ai-bench/promptVariants.ts`)

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

## Recommendation

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

### Prompt-template changes that clearly helped (for `prompts.ts`; orchestrator decides)

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
