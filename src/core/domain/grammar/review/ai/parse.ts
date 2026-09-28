import type { AiGenerationOutcome, AiGenerationRequest } from "./types";

/** Hard cap on raw model output accepted for parsing (UTF-16 units). */
export const MAX_AI_RAW_OUTPUT_CHARS = 32_000;

/**
 * Strict, bounded parse of raw model output against the request: JSON object
 * with exactly `segments`, each requested id exactly once in order, string
 * text only, no extra keys, no thinking markup. Anything else is `malformed`.
 * STUB: implemented by the domain workstream.
 */
export function parseAiResponse(raw: string, request: AiGenerationRequest): AiGenerationOutcome {
  void raw;
  void request;
  throw new Error("parseAiResponse: not implemented");
}

/**
 * Runtime validation of an untrusted request arriving over the transport
 * (types, sizes, ids, style/mode). Returns null when invalid.
 * STUB: implemented by the domain workstream.
 */
export function validateAiRequest(value: unknown): AiGenerationRequest | null {
  void value;
  throw new Error("validateAiRequest: not implemented");
}
