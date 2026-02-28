import { type FluentTyperErrorKind, getErrorMessage, isFluentTyperError } from "@core/domain/error";

export interface RuntimeErrorResponse {
  ok: false;
}

export interface RuntimeMappedError {
  category: FluentTyperErrorKind | "unknown";
  code: string;
  message: string;
  response: RuntimeErrorResponse;
}

const RUNTIME_FAILURE_RESPONSE: RuntimeErrorResponse = { ok: false };

export function mapRuntimeError(error: unknown): RuntimeMappedError {
  if (isFluentTyperError(error)) {
    return {
      category: error.kind,
      code: error.code,
      message: error.message,
      response: RUNTIME_FAILURE_RESPONSE,
    };
  }

  return {
    category: "unknown",
    code: "unhandled_runtime_error",
    message: getErrorMessage(error),
    response: RUNTIME_FAILURE_RESPONSE,
  };
}
