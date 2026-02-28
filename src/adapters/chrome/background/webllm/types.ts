export interface PredictorRequest {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

export interface InFlightPredictorRequest {
  lang: string;
  predictionInput: string;
}

export interface PredictionResponsePayload {
  predictions: string[];
  rawOutput: string;
}

export interface CompletionResponse {
  choices?: Array<{ text?: string | null }>;
}

export interface CompletionChunkResponse {
  choices?: Array<{ text?: string | null }>;
}

export interface ChatCompletionChoice {
  message?: {
    content?:
      | string
      | Array<{
          text?: string | null;
        }>
      | null;
  } | null;
}

export interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

export interface ChatCompletionChunkResponse {
  choices?: Array<{
    delta?: {
      content?: string | null;
    } | null;
  }>;
}

export type ChatMessageContent =
  | string
  | Array<{
      text?: string | null;
    }>
  | null
  | undefined;

export type ChatCreateResponse =
  | ChatCompletionResponse
  | AsyncIterable<ChatCompletionChunkResponse>;

export type CompletionCreateResponse = CompletionResponse | AsyncIterable<CompletionChunkResponse>;

export type PredictionMode = "next_word" | "complete_or_correct";

export interface PredictionModeContext {
  mode: PredictionMode;
  fragment: string;
}

export interface InitProgressEntry {
  atMs: number;
  progress: number;
  text: string;
}
