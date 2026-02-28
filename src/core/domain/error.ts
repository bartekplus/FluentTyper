import { hasStringProperty, isObjectRecord } from "./guards";

type ErrorWithMessage = {
  message: string;
};

export type FluentTyperErrorKind = "config" | "transport" | "predictor";

interface FluentTyperErrorDetails {
  kind: FluentTyperErrorKind;
  code: string;
  cause?: unknown;
}

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    isObjectRecord(error) &&
    "message" in error &&
    hasStringProperty(error, "message")
  );
}

function toErrorWithMessage(maybeError: unknown): ErrorWithMessage {
  if (isErrorWithMessage(maybeError)) return maybeError;

  try {
    return new Error(JSON.stringify(maybeError));
  } catch {
    // fallback in case there's an error stringifying the maybeError
    // like with circular references for example.
    return new Error(String(maybeError));
  }
}

export abstract class FluentTyperError extends Error {
  readonly kind: FluentTyperErrorKind;
  readonly code: string;
  readonly cause?: unknown;

  protected constructor(
    name: string,
    message: string,
    details: FluentTyperErrorDetails,
  ) {
    super(
      message,
      typeof details.cause === "undefined"
        ? undefined
        : { cause: details.cause },
    );
    this.name = name;
    this.kind = details.kind;
    this.code = details.code;
    this.cause = details.cause;
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
  if (error instanceof FluentTyperError) {
    return true;
  }
  if (!isObjectRecord(error)) {
    return false;
  }
  const maybeError = error as {
    kind?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const kind = maybeError.kind;
  return (
    (kind === "config" || kind === "transport" || kind === "predictor") &&
    typeof maybeError.code === "string" &&
    typeof maybeError.message === "string"
  );
}

export function getErrorMessage(error: unknown): string {
  return toErrorWithMessage(error).message;
}

export function logError(context: string, error: unknown) {
  const message = getErrorMessage(error);
  console.error(`[${context}] Error: ${message}`, error);
}
