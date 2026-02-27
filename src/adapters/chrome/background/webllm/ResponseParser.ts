import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import type {
  ChatCreateResponse,
  ChatCompletionChunkResponse,
  ChatCompletionResponse,
  ChatMessageContent,
  CompletionChunkResponse,
  CompletionCreateResponse,
  CompletionResponse,
  PredictionResponsePayload,
} from "./types";

export class ResponseParser {
  async parseChatCreateResponse(
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

  async parseCompletionCreateResponse(
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

  async enrichFromEngineMessage(
    engine: MLCEngineInterface | null,
    result: PredictionResponsePayload,
    limit: number,
  ): Promise<PredictionResponsePayload> {
    if (!engine) {
      return result;
    }
    if (
      result.predictions.length > 0 ||
      (typeof result.rawOutput === "string" && result.rawOutput.trim().length > 0)
    ) {
      return result;
    }
    try {
      const message = await engine.getMessage();
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

  parsePredictionLines(rawOutput: string, limit: number): string[] {
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

  private isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const maybeIterable = value as {
      [Symbol.asyncIterator]?: unknown;
    };
    return typeof maybeIterable[Symbol.asyncIterator] === "function";
  }
}
