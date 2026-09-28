/**
 * Fixture runs for the Local AI Review benchmark. Requests are built exactly
 * like the product: a synthetic whole-text snapshot (score.ts fixturePrepared)
 * → buildAiChunks → aiRequestForChunk. Raw outputs are scored by the Domain
 * scorer (scripts/local-ai-eval/score.ts), i.e. the product's parse +
 * correctionFindings / rewriteProposal.
 */
import type { Page } from "puppeteer";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewEdit } from "../../src/core/domain/grammar/review/types";
import { aiRequestForChunk, buildAiChunks } from "../../src/core/domain/grammar/review/ai/segments";
import {
  correctionFindings,
  rewriteProposal,
} from "../../src/core/domain/grammar/review/ai/validate";
import type { AiChunk, ConcreteRewriteStyle } from "../../src/core/domain/grammar/review/ai/types";
import {
  fixturePrepared,
  loadCorrectCases,
  loadRewriteCases,
  scoreCorrectCase,
  scoreRewriteCase,
  type CorrectScore,
  type RewriteScore,
} from "../local-ai-eval/score";
import type { GenParams, GenResult } from "./page";

export interface ModelRun {
  environment: Record<string, unknown>;
  modelId: string;
  revision: string;
  libSha256: string;
  downloadBytes: number;
  params: Record<string, GenParams>;
  downloadMs: number | null;
  coldLoadMs: number | null;
  warmupMs: number | null;
  thinkingProbe: Array<{
    enableThinking: boolean | null;
    hasThinkMarkup: boolean;
    head: string;
    completionTokens: number | null;
  }>;
  smoke: GenResult[];
  /** Set when the model run stopped early (timeout, load failure); results are partial. */
  failure?: string;
  /** Origins the page requested during the run (download/CSP evidence). */
  requestOrigins?: string[];
  correct: Array<CaseRun & { score: CorrectScore }>;
  rewrite: Array<CaseRun & { score: RewriteScore }>;
  cancel: Array<{
    settleMs: number;
    finish: string | null;
    charsBeforeCancel: number;
    error: string | null;
  }>;
}

export interface RunLimits {
  generationMs: number;
  /** Epoch ms after which the model run stops. */
  deadline: number;
}

function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface CaseRun {
  id: string;
  style: ConcreteRewriteStyle | null;
  input: string;
  /** Per chunk: raw output, parse outcome and engine stats. */
  generations: GenResult[];
  /** Raw model proposal spliced into the input, before validation (null when a chunk failed). */
  proposed: string | null;
  /** Like `proposed`, but chunks that failed keep their original text (for recall). */
  proposedPartial: string;
  /** Input after applying only what validation accepted. */
  accepted: string;
  /** Wall time: generation + parse (page) + validation (driver), summed over chunks. */
  latencyMs: number;
  validateMs: number;
}

/** Host-side splice of per-segment model text (placeholders restored), like the product. */
function splice(
  text: string,
  chunks: readonly AiChunk[],
  outputs: readonly string[],
): string | null {
  const edits: ReviewEdit[] = chunks
    .flatMap((chunk) => chunk.segments)
    .map((segment, index) => {
      let replacement = outputs[index] ?? "";
      for (const placeholder of segment.placeholders) {
        replacement = replacement.replace(
          placeholder.token,
          text.slice(placeholder.range.start, placeholder.range.end),
        );
      }
      return {
        start: segment.range.start,
        end: segment.range.end,
        original: text.slice(segment.range.start, segment.range.end),
        replacement,
      };
    });
  return applyEdits(text, edits);
}

async function generateCase(
  page: Page,
  fixture: { id: string; text: string; lang: string },
  style: ConcreteRewriteStyle | null,
  params: GenParams,
  limits: RunLimits,
): Promise<CaseRun & { raws: string[] }> {
  const mode = style ? "rewrite" : "correct";
  const prepared = fixturePrepared(fixture.text, fixture.lang);
  const chunks = buildAiChunks(prepared, { mode, style }).chunks;
  const run: CaseRun & { raws: string[] } = {
    id: fixture.id,
    style,
    input: fixture.text,
    generations: [],
    proposed: null,
    proposedPartial: fixture.text,
    accepted: fixture.text,
    latencyMs: 0,
    validateMs: 0,
    raws: [],
  };
  const segmentTexts: string[] = [];
  const parsed: Array<Array<{ id: string; text: string }>> = [];
  const edits: ReviewEdit[] = [];
  let complete = true;
  for (const chunk of chunks) {
    const request = aiRequestForChunk(chunk, fixture.lang, mode, style);
    if (Date.now() > limits.deadline) throw new Error("timeout: model run");
    let result: GenResult;
    try {
      result = await bounded(
        page.evaluate((req, p) => window.ftBench.generate(req, p), request, params),
        Math.min(limits.generationMs, limits.deadline - Date.now()),
        "generation",
      );
    } catch (error) {
      // Interrupt; if the engine does not settle, the model run is aborted by the caller.
      await bounded(
        page.evaluate(() => window.ftBench.interrupt()),
        5_000,
        "interrupt after generation timeout",
      );
      if (Date.now() > limits.deadline) throw error;
      console.log(`  ${fixture.id}: generation timeout, interrupted`);
      result = {
        raw: "",
        finish: "timeout",
        ttftMs: null,
        genMs: limits.generationMs,
        parsedMs: limits.generationMs,
        maxTokens: 0,
        usage: null,
        outcome: { ok: false, error: "timeout" },
        error: "timeout",
      };
    }
    run.generations.push(result);
    run.latencyMs += result.parsedMs;
    // The scorer gets exactly what the stream produced; a non-"stop" finish is a failure.
    run.raws.push(
      result.finish !== "stop"
        ? ""
        : params.contract === "text"
          ? // Text contract: hand the scorer the parsed answer in the JSON contract it reads.
            result.outcome?.ok
            ? JSON.stringify({ segments: result.outcome.segments })
            : ""
          : params.thinkBudget
            ? result.raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "")
            : result.raw,
    );
    if (!result.outcome?.ok) {
      complete = false;
      segmentTexts.push(...chunk.segments.map((segment) => segment.text));
      continue;
    }
    parsed.push(result.outcome.segments);
    segmentTexts.push(...result.outcome.segments.map((segment) => segment.text));
    if (mode === "correct") {
      const t0 = performance.now();
      for (const diagnostic of correctionFindings(prepared, chunk, result.outcome.segments)
        .diagnostics) {
        edits.push(...(diagnostic.alternatives[0]?.edits ?? []));
      }
      run.validateMs += performance.now() - t0;
    }
  }
  if (chunks.length > 0)
    run.proposedPartial = splice(fixture.text, chunks, segmentTexts) ?? fixture.text;
  if (complete && chunks.length > 0) {
    run.proposed = run.proposedPartial;
    if (style) {
      const t0 = performance.now();
      const proposal = rewriteProposal(prepared, chunks, parsed, style);
      run.validateMs += performance.now() - t0;
      if (proposal.ok) edits.push(...proposal.edits);
    }
  }
  run.latencyMs += run.validateMs;
  run.accepted = applyEdits(fixture.text, edits) ?? fixture.text;
  return run;
}

export async function runFixtures(
  page: Page,
  run: ModelRun,
  args: Map<string, string>,
  correctParams: GenParams,
  limits: RunLimits,
): Promise<void> {
  const limit = Number(args.get("limit") ?? Infinity);
  const ids = args.get("ids")?.split(",");
  const selected = <T extends { id: string }>(cases: T[]) =>
    (ids ? cases.filter((fixture) => ids.includes(fixture.id)) : cases).slice(0, limit);
  const modes = (args.get("modes") ?? "correct,rewrite,cancel").split(",");
  const rewriteParams: GenParams = { ...correctParams, temperature: 0.4 };
  run.params.rewrite = rewriteParams;

  if (modes.includes("correct")) {
    const cases = selected(loadCorrectCases());
    for (const [index, fixture] of cases.entries()) {
      const { raws, ...result } = await generateCase(page, fixture, null, correctParams, limits);
      const score = scoreCorrectCase(fixture, raws);
      run.correct.push({ ...result, score });
      const status = !score.valid
        ? "INVALID"
        : score.corrected
          ? "corrected"
          : score.falsePositive
            ? "FALSE-POSITIVE"
            : score.unchangedOk
              ? "unchanged-ok"
              : "missed";
      console.log(
        `correct ${index + 1}/${cases.length} ${fixture.id}: ${result.latencyMs.toFixed(0)} ms ${status}`,
      );
    }
  }
  const rewriteCases = selected(loadRewriteCases());
  if (modes.includes("rewrite")) {
    for (const [index, fixture] of rewriteCases.entries()) {
      const { raws, ...result } = await generateCase(
        page,
        fixture,
        fixture.style,
        rewriteParams,
        limits,
      );
      const score = scoreRewriteCase(fixture, raws);
      run.rewrite.push({ ...result, score });
      const status = !score.valid
        ? "INVALID"
        : !score.proposalOk
          ? `rejected:${score.rejection}`
          : result.accepted === fixture.text
            ? "no-change"
            : score.missing.length + score.forbidden.length > 0
              ? "INVARIANT-FAIL"
              : "ok";
      console.log(
        `rewrite ${index + 1}/${rewriteCases.length} ${fixture.id} ${fixture.style}: ${result.latencyMs.toFixed(0)} ms ${status}`,
      );
    }
  }
  if (modes.includes("cancel") && rewriteCases.length > 0) {
    // Longest rewrite input, interrupted 300 ms after the request starts.
    const longest = rewriteCases.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const chunk = buildAiChunks(fixturePrepared(longest.text, longest.lang), {
      mode: "rewrite",
      style: "clearer",
    }).chunks[0]!;
    const request = aiRequestForChunk(chunk, longest.lang, "rewrite", "clearer");
    for (let i = 0; i < 5; i++) {
      const result = await bounded(
        page.evaluate(
          (req, p) => window.ftBench.cancelToSettle(req, p, 300),
          request,
          rewriteParams,
        ),
        limits.generationMs,
        "cancel",
      );
      run.cancel.push(result);
      console.log(`cancel ${i}: settle ${result.settleMs.toFixed(1)} ms (${result.finish})`);
    }
  }
}
