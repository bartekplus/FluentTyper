import type { AiGenerationRequest } from "./types";

/** Bumped whenever templates or the response contract change; part of every cache key. */
export const AI_PROMPT_VERSION = "review-ai-1";

export interface AiChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * System + user messages for one request. Editor text is embedded as JSON
 * data, never as instructions. STUB: implemented by the domain workstream.
 */
export function buildAiMessages(request: AiGenerationRequest): AiChatMessage[] {
  void request;
  throw new Error("buildAiMessages: not implemented");
}

/** Output token budget for a request (bounded; truncation is a failure, not a result). */
export function aiMaxOutputTokens(request: AiGenerationRequest): number {
  void request;
  throw new Error("aiMaxOutputTokens: not implemented");
}
