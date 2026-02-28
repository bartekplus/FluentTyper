export type Result<TValue, TError> = Ok<TValue> | Err<TError>;

export interface Ok<TValue> {
  ok: true;
  value: TValue;
}

export interface Err<TError> {
  ok: false;
  error: TError;
}

export function ok<TValue>(value: TValue): Ok<TValue> {
  return { ok: true, value };
}

export function err<TError>(error: TError): Err<TError> {
  return { ok: false, error };
}
