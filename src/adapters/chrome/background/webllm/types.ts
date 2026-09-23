export interface PredictionResponsePayload {
  predictions: string[];
  rawOutput: string;
}

export interface CompletionResponse {
  choices?: Array<{ text?: string | null }>;
}

export type ChatMessageContent =
  | string
  | Array<{
      text?: string | null;
    }>
  | null
  | undefined;

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: ChatMessageContent;
    } | null;
  }>;
}

export interface ChatCompletionChunkResponse {
  choices?: Array<{
    delta?: {
      content?: string | null;
    } | null;
  }>;
}

export type ChatCreateResponse =
  ChatCompletionResponse | AsyncIterable<ChatCompletionChunkResponse>;

export type CompletionCreateResponse = CompletionResponse | AsyncIterable<CompletionResponse>;

export interface PredictionModeContext {
  mode: "next_word" | "complete_or_correct";
  fragment: string;
}

export interface InitProgressEntry {
  atMs: number;
  progress: number;
  text: string;
}
