import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import type {
  ChatCreateResponse,
  ChatCompletionChunkResponse,
  ChatMessageContent,
  CompletionCreateResponse,
  CompletionResponse,
  PredictionResponsePayload,
} from "./types";

export class ResponseParser {
  async parseChatCreateResponse(
    response: ChatCreateResponse,
    limit: number,
  ): Promise<PredictionResponsePayload> {
    const rawOutput = this.isAsyncIterable<ChatCompletionChunkResponse>(response)
      ? await this.collectStream(response, (choice) => choice?.delta?.content)
      : (response.choices ?? [])
          .map((choice) => this.extractMessageContent(choice.message?.content))
          .join("\n");
    return this.toPayload(rawOutput, limit);
  }

  async parseCompletionCreateResponse(
    response: CompletionCreateResponse,
    limit: number,
  ): Promise<PredictionResponsePayload> {
    const rawOutput = this.isAsyncIterable<CompletionResponse>(response)
      ? await this.collectStream(response, (choice) => choice?.text)
      : (response.choices ?? []).map((choice) => choice.text ?? "").join("\n");
    return this.toPayload(rawOutput, limit);
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
      return this.toPayload(message, limit);
    } catch {
      return result;
    }
  }

  private parsePredictionLines(rawOutput: string, limit: number): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const lines = rawOutput.split(/\r?\n|,/g);

    for (const rawLine of lines) {
      if (result.length >= limit) {
        break;
      }
      const cleaned = rawLine.replace(/^\s*[-*•]?\s*\d*[).:-]?\s*/u, "").trim();
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

  private toPayload(rawOutput: string, limit: number): PredictionResponsePayload {
    return {
      predictions: this.parsePredictionLines(rawOutput, limit),
      rawOutput,
    };
  }

  private async collectStream<TChoice>(
    stream: AsyncIterable<{ choices?: TChoice[] }>,
    getText: (choice: TChoice) => string | null | undefined,
  ): Promise<string> {
    let rawOutput = "";
    for await (const chunk of stream) {
      for (const choice of chunk.choices ?? []) {
        const text = getText(choice);
        if (typeof text === "string") {
          rawOutput += text;
        }
      }
    }
    return rawOutput;
  }

  private extractMessageContent(content: ChatMessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return "";
    }
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n");
  }

  private isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    return (
      typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
    );
  }
}
