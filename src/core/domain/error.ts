import { isObjectRecord } from "./guards";

export type FluentTyperErrorKind = "config" | "transport" | "predictor";

interface FluentTyperErrorDetails {
  kind: FluentTyperErrorKind;
  code: string;
  cause?: unknown;
}

abstract class FluentTyperError extends Error {
  readonly kind: FluentTyperErrorKind;
  readonly code: string;

  protected constructor(name: string, message: string, details: FluentTyperErrorDetails) {
    super(message, typeof details.cause === "undefined" ? undefined : { cause: details.cause });
    this.name = name;
    this.kind = details.kind;
    this.code = details.code;
  }
}

export class ConfigError extends FluentTyperError {
  constructor(message: string, details: Omit<FluentTyperErrorDetails, "kind">) {
    super("ConfigError", message, {
      ...details,
      kind: "config",
    });
  }
}

export class TransportError extends FluentTyperError {
  constructor(message: string, details: Omit<FluentTyperErrorDetails, "kind">) {
    super("TransportError", message, {
      ...details,
      kind: "transport",
    });
  }
}

export class PredictorError extends FluentTyperError {
  constructor(message: string, details: Omit<FluentTyperErrorDetails, "kind">) {
    super("PredictorError", message, {
      ...details,
      kind: "predictor",
    });
  }
}

export function isFluentTyperError(error: unknown): error is FluentTyperError {
  return error instanceof FluentTyperError;
}

export function getErrorMessage(error: unknown): string {
  if (isObjectRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  try {
    return JSON.stringify(error) ?? "";
  } catch {
    // JSON.stringify throws for circular references and BigInt values.
    return String(error);
  }
}

export function logError(context: string, error: unknown) {
  const message = getErrorMessage(error);
  console.error(`[${context}] Error: ${message}`, error);
}
