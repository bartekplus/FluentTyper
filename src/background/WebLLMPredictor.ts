import { CreateMLCEngine, MLCEngineInterface } from "@mlc-ai/web-llm";
import {
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PREDICTOR_ENABLED,
} from "../shared/constants";
import { getErrorMessage } from "../shared/error";

const CACHE_TTL_MS = 5000;
const FAILURE_RETRY_MS = 30000;
const MAX_GENERATION_CHOICES = 5;
const WEB_LLM_TEST_OVERRIDE_KEY = "__fluentTyperWebLLMTestOverride__";

enum PredictorStatus {
  Idle = "idle",
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

interface CacheEntry {
  expiresAt: number;
  predictions: string[];
}

interface CompletionResponse {
  choices?: Array<{ text?: string | null }>;
}

interface CompletionChunkResponse {
  choices?: Array<{ text?: string | null }>;
}

interface PredictionResponsePayload {
  predictions: string[];
  rawOutput: string;
}

interface ChatCompletionChoice {
  message?: {
    content?:
      | string
      | Array<{
          text?: string | null;
        }>
      | null;
  } | null;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

interface ChatCompletionChunkResponse {
  choices?: Array<{
    delta?: {
      content?: string | null;
    } | null;
  }>;
}

type ChatMessageContent =
  | string
  | Array<{
      text?: string | null;
    }>
  | null
  | undefined;

type ChatCreateResponse =
  | ChatCompletionResponse
  | AsyncIterable<ChatCompletionChunkResponse>;

type CompletionCreateResponse =
  | CompletionResponse
  | AsyncIterable<CompletionChunkResponse>;

type PredictionMode = "next_word" | "complete_or_correct";

interface PredictionModeContext {
  mode: PredictionMode;
  fragment: string;
}

interface WebLLMTestPredictionCall {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

interface WebLLMTestOverrideState {
  predictions: string[];
  delayMs: number;
  calls: WebLLMTestPredictionCall[];
}

type WebLLMTestGlobals = typeof globalThis & {
  __fluentTyperWebLLMTestOverride__?: WebLLMTestOverrideState;
};

export interface WebLLMPredictorConfig {
  enabled?: boolean;
  modelId?: string;
}

export interface WebLLMPredictRequest {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

export interface WebLLMPredictorDebugState {
  enabled: boolean;
  modelId: string;
  status: string;
  hasWebGPU: boolean;
  isGenerating: boolean;
  cacheSize: number;
  lastFailureAt: number | null;
  lastPredictAt: number | null;
  lastPredictDurationMs: number | null;
  lastPredictSource: string;
  lastPredictInput: string | null;
  lastRawOutputPreview: string | null;
  lastPredictOutputCount: number;
  lastPredictError: string | null;
}

export class WebLLMPredictor {
  private engine: MLCEngineInterface | null = null;
  private status: PredictorStatus = PredictorStatus.Idle;
  private initPromise: Promise<boolean> | null = null;
  private cache = new Map<string, CacheEntry>();
  private activeGenerationSeq = 0;
  private isGenerating = false;
  private enabled = DEFAULT_AI_PREDICTOR_ENABLED;
  private modelId = DEFAULT_AI_MODEL_ID;
  private lastFailureAt = 0;
  private lastPredictAt = 0;
  private lastPredictDurationMs = -1;
  private lastPredictSource = "none";
  private lastPredictInput: string | null = null;
  private lastRawOutputPreview: string | null = null;
  private lastPredictOutputCount = 0;
  private lastPredictError: string | null = null;

  setConfig(config: WebLLMPredictorConfig): void {
    const nextEnabled =
      typeof config.enabled === "boolean"
        ? config.enabled
        : DEFAULT_AI_PREDICTOR_ENABLED;
    const nextModelId =
      typeof config.modelId === "string" && config.modelId.trim().length > 0
        ? config.modelId
        : DEFAULT_AI_MODEL_ID;
    const modelChanged = nextModelId !== this.modelId;
    const enabledChanged = nextEnabled !== this.enabled;

    this.enabled = nextEnabled;
    this.modelId = nextModelId;

    if (modelChanged) {
      this.resetEngine();
    }
    if (enabledChanged && !this.enabled) {
      this.resetEngine();
    }
  }

  getDebugState(): WebLLMPredictorDebugState {
    return {
      enabled: this.enabled,
      modelId: this.modelId,
      status: this.status,
      hasWebGPU: this.hasWebGPU(),
      isGenerating: this.isGenerating,
      cacheSize: this.cache.size,
      lastFailureAt: this.lastFailureAt > 0 ? this.lastFailureAt : null,
      lastPredictAt: this.lastPredictAt > 0 ? this.lastPredictAt : null,
      lastPredictDurationMs:
        this.lastPredictDurationMs >= 0 ? this.lastPredictDurationMs : null,
      lastPredictSource: this.lastPredictSource,
      lastPredictInput: this.lastPredictInput,
      lastRawOutputPreview: this.lastRawOutputPreview,
      lastPredictOutputCount: this.lastPredictOutputCount,
      lastPredictError: this.lastPredictError,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  preload(): void {
    void this.ensureReady();
  }

  async predict(request: WebLLMPredictRequest): Promise<string[]> {
    if (!this.enabled || request.numSuggestions <= 0) {
      return [];
    }
    const testOverride = this.getTestOverrideState();
    if (testOverride) {
      return this.predictFromTestOverride(testOverride, request);
    }
    const cacheKey = this.getCacheKey(request);
    const cachedPredictions = this.getCachedPredictions(cacheKey);
    if (cachedPredictions) {
      return cachedPredictions;
    }
    const ready = await this.ensureReady();
    if (!ready || !this.engine) {
      return [];
    }
    const modeContext = this.resolvePredictionMode(request.predictionInput);

    if (this.isGenerating) {
      this.lastPredictAt = Date.now();
      this.lastPredictInput = request.predictionInput;
      this.lastPredictDurationMs = 0;
      this.lastPredictSource = "skipped";
      this.lastRawOutputPreview = "";
      this.lastPredictOutputCount = 0;
      this.lastPredictError = "generation_in_progress";
      return [];
    }
    const generationSeq = ++this.activeGenerationSeq;
    this.isGenerating = true;
    const predictStartedAt = Date.now();
    this.lastPredictAt = predictStartedAt;
    this.lastPredictInput = request.predictionInput;
    this.lastPredictDurationMs = 0;
    this.lastPredictSource = "none";
    this.lastRawOutputPreview = null;
    this.lastPredictOutputCount = 0;
    this.lastPredictError = null;

    try {
      let predictions: string[] = [];
      let rawOutput = "";
      let source = "none";
      try {
        const chatResult = await this.predictWithChatCompletion(
          request,
          modeContext,
        );
        predictions = chatResult.predictions;
        rawOutput = chatResult.rawOutput;
        source = "chat";
      } catch (error) {
        console.warn(
          "WebLLM chat completion failed, trying completion fallback:",
          getErrorMessage(error),
        );
        this.lastPredictError = getErrorMessage(error);
      }
      if (predictions.length === 0) {
        try {
          const simpleChatResult = await this.predictWithSimpleChatCompletion(
            request,
            modeContext,
          );
          if (simpleChatResult.rawOutput.trim().length > 0 || !rawOutput) {
            rawOutput = simpleChatResult.rawOutput;
          }
          if (simpleChatResult.predictions.length > 0) {
            predictions = simpleChatResult.predictions;
            source = "chat_simple";
          }
        } catch (error) {
          if (!this.lastPredictError) {
            this.lastPredictError = getErrorMessage(error);
          }
        }
      }
      if (predictions.length === 0) {
        const completionResult = await this.predictWithCompletion(
          request,
          modeContext,
        );
        predictions = completionResult.predictions;
        if (completionResult.rawOutput.trim().length > 0 || !rawOutput) {
          rawOutput = completionResult.rawOutput;
        }
        source = "completion";
      }

      if (generationSeq !== this.activeGenerationSeq) {
        return [];
      }
      predictions = this.postProcessPredictions(
        predictions,
        modeContext,
        request.numSuggestions,
      );

      if (predictions.length > 0) {
        this.setCachedPredictions(cacheKey, predictions);
      }
      this.lastPredictDurationMs = Date.now() - predictStartedAt;
      this.lastPredictSource = source;
      this.lastRawOutputPreview = rawOutput.slice(0, 400);
      this.lastPredictOutputCount = predictions.length;
      if (predictions.length === 0 && !this.lastPredictError) {
        this.lastPredictError = "empty_response";
      }
      return predictions;
    } catch (error) {
      console.warn(
        "WebLLM generation failed, fallback to Presage:",
        getErrorMessage(error),
      );
      this.lastPredictDurationMs = Date.now() - predictStartedAt;
      this.lastPredictSource = "error";
      this.lastPredictError = getErrorMessage(error);
      this.lastPredictOutputCount = 0;
      return [];
    } finally {
      if (generationSeq === this.activeGenerationSeq) {
        this.isGenerating = false;
      }
    }
  }

  private hasWebGPU(): boolean {
    const maybeNavigator = (globalThis as { navigator?: { gpu?: unknown } })
      .navigator;
    return Boolean(maybeNavigator?.gpu);
  }

  private getTestOverrideState(): WebLLMTestOverrideState | null {
    const testGlobals = globalThis as WebLLMTestGlobals;
    const override = testGlobals[WEB_LLM_TEST_OVERRIDE_KEY];
    return override ?? null;
  }

  private async predictFromTestOverride(
    override: WebLLMTestOverrideState,
    request: WebLLMPredictRequest,
  ): Promise<string[]> {
    if (Array.isArray(override.calls)) {
      override.calls.push({
        lang: request.lang,
        predictionInput: request.predictionInput,
        numSuggestions: request.numSuggestions,
      });
    }
    const delayMs =
      typeof override.delayMs === "number" && Number.isFinite(override.delayMs)
        ? Math.max(0, Math.round(override.delayMs))
        : 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!Array.isArray(override.predictions)) {
      return [];
    }
    return override.predictions
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, request.numSuggestions);
  }

  private async ensureReady(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    if (!this.hasWebGPU()) {
      return false;
    }
    if (this.status === PredictorStatus.Ready && this.engine) {
      return true;
    }
    if (this.status === PredictorStatus.Loading && this.initPromise) {
      return this.initPromise;
    }
    if (
      this.status === PredictorStatus.Failed &&
      Date.now() - this.lastFailureAt < FAILURE_RETRY_MS
    ) {
      return false;
    }

    this.status = PredictorStatus.Loading;
    this.initPromise = (async () => {
      try {
        this.engine = await CreateMLCEngine(this.modelId);
        this.status = PredictorStatus.Ready;
        this.lastFailureAt = 0;
        return true;
      } catch (error) {
        this.engine = null;
        this.status = PredictorStatus.Failed;
        this.lastFailureAt = Date.now();
        console.warn(
          "WebLLM init failed, fallback to Presage:",
          getErrorMessage(error),
        );
        return false;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  private resetEngine(): void {
    this.cache.clear();
    this.status = PredictorStatus.Idle;
    this.initPromise = null;
    this.activeGenerationSeq += 1;
    this.isGenerating = false;
    if (this.engine) {
      const engine = this.engine;
      this.engine = null;
      void engine.unload().catch(() => {
        // Ignore unload errors; predictor can still recover via re-init.
      });
    }
  }

  private buildPrompt(
    predictionInput: string,
    lang: string,
    numSuggestions: number,
    modeContext: PredictionModeContext,
  ): string {
    const languageLabel = lang.replace("_", "-");
    const safeText = predictionInput.trim() || "<empty>";
    const count = Math.min(MAX_GENERATION_CHOICES, Math.max(1, numSuggestions));
    if (modeContext.mode === "complete_or_correct") {
      return [
        `You are a typing autocomplete assistant for language ${languageLabel}.`,
        `Given the text and current last-word fragment, output ${count} likely completed or corrected full-word candidates for that fragment only.`,
        "Rules:",
        "- return each candidate on a new line",
        "- single word only",
        "- no punctuation, numbering, or explanations",
        "- do not predict the next word after the current fragment",
        `Context: ${safeText}`,
        `Current fragment: ${modeContext.fragment || "<empty>"}`,
        "Candidates:",
      ].join("\n");
    }
    return [
      `You are a typing autocomplete assistant for language ${languageLabel}.`,
      `Given text context, output ${count} likely next single-word completions.`,
      "Rules:",
      "- return each candidate on a new line",
      "- do not number items",
      "- no punctuation, no explanations",
      `Context: ${safeText}`,
      "Completions:",
    ].join("\n");
  }

  private buildChatMessages(
    predictionInput: string,
    lang: string,
    numSuggestions: number,
    modeContext: PredictionModeContext,
  ): Array<{ role: "system" | "user"; content: string }> {
    const languageLabel = lang.replace("_", "-");
    const safeText = predictionInput.trim() || "<empty>";
    const count = Math.min(MAX_GENERATION_CHOICES, Math.max(1, numSuggestions));
    if (modeContext.mode === "complete_or_correct") {
      return [
        {
          role: "system",
          content: [
            `You are a typing autocomplete assistant for language ${languageLabel}.`,
            "Complete or correct only the current last word fragment.",
            "Return only candidate full words.",
            "No explanations, no numbering, no punctuation.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Context: ${safeText}`,
            `Current fragment: ${modeContext.fragment || "<empty>"}`,
            `Return ${count} likely completed or corrected full words for this fragment.`,
            "Do not predict the next word.",
            "One candidate per line.",
          ].join("\n"),
        },
      ];
    }
    return [
      {
        role: "system",
        content: [
          `You are a typing autocomplete assistant for language ${languageLabel}.`,
          "Return only completion candidates.",
          "No explanations, no numbering, no punctuation.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Context: ${safeText}`,
          `Return ${count} likely next single-word completions.`,
          "One completion per line.",
        ].join("\n"),
      },
    ];
  }

  private buildSimpleChatMessages(
    predictionInput: string,
    numSuggestions: number,
    modeContext: PredictionModeContext,
  ): Array<{ role: "user"; content: string }> {
    const safeText = predictionInput.trim() || "<empty>";
    const count = Math.min(MAX_GENERATION_CHOICES, Math.max(1, numSuggestions));
    if (modeContext.mode === "complete_or_correct") {
      return [
        {
          role: "user",
          content: [
            `Text context: "${safeText}"`,
            `Current fragment: "${modeContext.fragment || "<empty>"}"`,
            `Return ${count} candidate full-word completions/corrections for the current fragment only.`,
            "Output only comma-separated single words.",
          ].join("\n"),
        },
      ];
    }
    return [
      {
        role: "user",
        content: `Complete the text "${safeText}" with ${count} likely next single words. Return only comma-separated words.`,
      },
    ];
  }

  private async predictWithChatCompletion(
    request: WebLLMPredictRequest,
    modeContext: PredictionModeContext,
  ): Promise<PredictionResponsePayload> {
    if (!this.engine) {
      return { predictions: [], rawOutput: "" };
    }
    const chatCompletion = (await this.engine.chat.completions.create({
      stream: false,
      messages: this.buildChatMessages(
        request.predictionInput,
        request.lang,
        request.numSuggestions,
        modeContext,
      ),
      n: 1,
      max_tokens: Math.max(16, request.numSuggestions * 8),
      temperature: 0.2,
      top_p: 0.95,
    })) as ChatCreateResponse;
    const parsed = await this.parseChatCreateResponse(
      chatCompletion,
      request.numSuggestions,
    );
    return this.enrichFromEngineMessage(parsed, request.numSuggestions);
  }

  private async predictWithSimpleChatCompletion(
    request: WebLLMPredictRequest,
    modeContext: PredictionModeContext,
  ): Promise<PredictionResponsePayload> {
    if (!this.engine) {
      return { predictions: [], rawOutput: "" };
    }
    const chatCompletion = (await this.engine.chat.completions.create({
      stream: false,
      messages: this.buildSimpleChatMessages(
        request.predictionInput,
        request.numSuggestions,
        modeContext,
      ),
      n: 1,
      max_tokens: Math.max(16, request.numSuggestions * 8),
      temperature: 0.2,
      top_p: 0.95,
    })) as ChatCreateResponse;
    const parsed = await this.parseChatCreateResponse(
      chatCompletion,
      request.numSuggestions,
    );
    return this.enrichFromEngineMessage(parsed, request.numSuggestions);
  }

  private async predictWithCompletion(
    request: WebLLMPredictRequest,
    modeContext: PredictionModeContext,
  ): Promise<PredictionResponsePayload> {
    if (!this.engine) {
      return { predictions: [], rawOutput: "" };
    }
    const completion = (await this.engine.completions.create({
      stream: false,
      prompt: this.buildPrompt(
        request.predictionInput,
        request.lang,
        request.numSuggestions,
        modeContext,
      ),
      n: 1,
      max_tokens: Math.max(16, request.numSuggestions * 8),
      temperature: 0.2,
      top_p: 0.95,
    })) as CompletionCreateResponse;
    const parsed = await this.parseCompletionCreateResponse(
      completion,
      request.numSuggestions,
    );
    return this.enrichFromEngineMessage(parsed, request.numSuggestions);
  }

  private async parseChatCreateResponse(
    response: ChatCreateResponse,
    limit: number,
  ): Promise<PredictionResponsePayload> {
    if (!this.isAsyncIterable<ChatCompletionChunkResponse>(response)) {
      return this.parseChatCompletionOutput(response, limit);
    }
    let rawOutput = "";
    for await (const chunk of response) {
      for (const choice of chunk.choices ?? []) {
        const content = choice?.delta?.content;
        if (typeof content === "string") {
          rawOutput += content;
        }
      }
    }
    return {
      predictions: this.parsePredictionLines(rawOutput, limit),
      rawOutput,
    };
  }

  private async parseCompletionCreateResponse(
    response: CompletionCreateResponse,
    limit: number,
  ): Promise<PredictionResponsePayload> {
    if (!this.isAsyncIterable<CompletionChunkResponse>(response)) {
      return this.parseCompletionOutput(response, limit);
    }
    let rawOutput = "";
    for await (const chunk of response) {
      for (const choice of chunk.choices ?? []) {
        const text = choice?.text;
        if (typeof text === "string") {
          rawOutput += text;
        }
      }
    }
    return {
      predictions: this.parsePredictionLines(rawOutput, limit),
      rawOutput,
    };
  }

  private parseChatCompletionOutput(
    chatCompletion: ChatCompletionResponse,
    limit: number,
  ): PredictionResponsePayload {
    const rawOutput = (chatCompletion.choices ?? [])
      .map((choice) => this.extractMessageContent(choice.message?.content))
      .join("\n");
    return {
      predictions: this.parsePredictionLines(rawOutput, limit),
      rawOutput,
    };
  }

  private parseCompletionOutput(
    completion: CompletionResponse,
    limit: number,
  ): PredictionResponsePayload {
    const rawOutput = (completion.choices ?? [])
      .map((choice) => choice.text ?? "")
      .join("\n");
    return {
      predictions: this.parsePredictionLines(rawOutput, limit),
      rawOutput,
    };
  }

  private async enrichFromEngineMessage(
    result: PredictionResponsePayload,
    limit: number,
  ): Promise<PredictionResponsePayload> {
    if (!this.engine) {
      return result;
    }
    if (
      result.predictions.length > 0 ||
      (typeof result.rawOutput === "string" && result.rawOutput.trim().length > 0)
    ) {
      return result;
    }
    try {
      const message = await this.engine.getMessage();
      if (typeof message !== "string" || message.trim().length === 0) {
        return result;
      }
      return {
        predictions: this.parsePredictionLines(message, limit),
        rawOutput: message,
      };
    } catch {
      return result;
    }
  }

  private extractMessageContent(content: ChatMessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return "";
    }
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n");
  }

  private parsePredictionLines(rawOutput: string, limit: number): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const lines = rawOutput.split(/\r?\n|,/g);

    for (const rawLine of lines) {
      if (result.length >= limit) {
        break;
      }
      const cleaned = rawLine
        .replace(/^\s*[-*•]?\s*\d*[).:-]?\s*/u, "")
        .trim();
      if (!cleaned) {
        continue;
      }
      const tokenMatch = cleaned.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/u);
      if (!tokenMatch) {
        continue;
      }
      const token = tokenMatch[0];
      const normalized = token.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(token);
    }
    return result;
  }

  private resolvePredictionMode(
    predictionInput: string,
  ): PredictionModeContext {
    const trimmedInput = predictionInput.trim();
    const endsWithSpace = predictionInput !== predictionInput.trimEnd();
    if (trimmedInput.length === 0 || endsWithSpace) {
      return {
        mode: "next_word",
        fragment: "",
      };
    }
    const fragmentMatch = trimmedInput.match(/([\p{L}\p{N}'-]+)$/u);
    const fragment = (fragmentMatch?.[1] || "").toLowerCase();
    if (!fragment) {
      return {
        mode: "next_word",
        fragment: "",
      };
    }
    return {
      mode: "complete_or_correct",
      fragment,
    };
  }

  private postProcessPredictions(
    predictions: string[],
    modeContext: PredictionModeContext,
    limit: number,
  ): string[] {
    const normalized = predictions
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (modeContext.mode !== "complete_or_correct" || !modeContext.fragment) {
      return normalized.slice(0, limit);
    }
    const bestByToken = new Map<
      string,
      { token: string; score: number; index: number }
    >();
    for (let index = 0; index < normalized.length; index += 1) {
      const token = normalized[index];
      const tokenLower = token.toLowerCase();
      const score = this.scoreCompletionCandidate(tokenLower, modeContext.fragment);
      if (score === null) {
        continue;
      }
      const existing = bestByToken.get(tokenLower);
      if (
        !existing ||
        score < existing.score ||
        (score === existing.score && index < existing.index)
      ) {
        bestByToken.set(tokenLower, { token, score, index });
      }
    }
    return Array.from(bestByToken.values())
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.token)
      .slice(0, limit);
  }

  private scoreCompletionCandidate(
    candidate: string,
    fragment: string,
  ): number | null {
    if (!candidate || !fragment) {
      return null;
    }
    if (candidate === fragment) {
      return 0;
    }
    if (candidate.startsWith(fragment)) {
      return 1 + Math.max(0, candidate.length - fragment.length) / 100;
    }
    const maxDistance = this.getMaxCorrectionDistance(fragment.length);
    const distance = this.damerauLevenshteinDistance(
      fragment,
      candidate,
      maxDistance + 1,
    );
    const overlapRatio = this.getCharacterOverlapRatio(fragment, candidate);
    if (
      distance <= maxDistance &&
      candidate.length >= Math.max(2, fragment.length - 1) &&
      overlapRatio >= 0.55
    ) {
      return (
        10 +
        distance +
        (1 - overlapRatio) * 6 +
        Math.max(0, candidate.length - fragment.length) / 100
      );
    }
    return null;
  }

  private getMaxCorrectionDistance(fragmentLength: number): number {
    if (fragmentLength <= 4) {
      return 1;
    }
    if (fragmentLength <= 8) {
      return 3;
    }
    return 4;
  }

  private getCharacterOverlapRatio(source: string, target: string): number {
    if (!source || !target) {
      return 0;
    }
    const sourceCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();
    for (const char of source) {
      sourceCounts.set(char, (sourceCounts.get(char) ?? 0) + 1);
    }
    for (const char of target) {
      targetCounts.set(char, (targetCounts.get(char) ?? 0) + 1);
    }
    let overlapCount = 0;
    for (const [char, count] of sourceCounts.entries()) {
      overlapCount += Math.min(count, targetCounts.get(char) ?? 0);
    }
    return overlapCount / Math.max(source.length, target.length);
  }

  private damerauLevenshteinDistance(
    source: string,
    target: string,
    maxDistance: number,
  ): number {
    const sourceLength = source.length;
    const targetLength = target.length;
    if (sourceLength === 0) {
      return targetLength;
    }
    if (targetLength === 0) {
      return sourceLength;
    }
    const matrix: number[][] = Array.from({ length: sourceLength + 1 }, () =>
      new Array<number>(targetLength + 1).fill(0),
    );
    for (let i = 0; i <= sourceLength; i += 1) {
      matrix[i][0] = i;
    }
    for (let j = 0; j <= targetLength; j += 1) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= sourceLength; i += 1) {
      let rowMin = Number.POSITIVE_INFINITY;
      for (let j = 1; j <= targetLength; j += 1) {
        const substitutionCost = source[i - 1] === target[j - 1] ? 0 : 1;
        let value = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + substitutionCost,
        );
        if (
          i > 1 &&
          j > 1 &&
          source[i - 1] === target[j - 2] &&
          source[i - 2] === target[j - 1]
        ) {
          value = Math.min(value, matrix[i - 2][j - 2] + 1);
        }
        matrix[i][j] = value;
        if (value < rowMin) {
          rowMin = value;
        }
      }
      if (rowMin > maxDistance) {
        return rowMin;
      }
    }
    return matrix[sourceLength][targetLength];
  }

  private isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const maybeIterable = value as {
      [Symbol.asyncIterator]?: unknown;
    };
    return typeof maybeIterable[Symbol.asyncIterator] === "function";
  }

  private getCacheKey(request: WebLLMPredictRequest): string {
    return `${this.modelId}|${request.lang}|${request.numSuggestions}|${request.predictionInput}`;
  }

  private getCachedPredictions(cacheKey: string): string[] | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt < Date.now()) {
      this.cache.delete(cacheKey);
      return null;
    }
    return cached.predictions.slice();
  }

  private setCachedPredictions(cacheKey: string, predictions: string[]): void {
    this.cache.set(cacheKey, {
      predictions: predictions.slice(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
}
