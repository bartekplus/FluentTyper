/**
 * UUID v4 generator with a non-crypto fallback.
 *
 * `crypto.randomUUID` is only exposed in secure contexts, and content scripts run inside
 * whatever page the user is on, including plain http:// ones. The fallback keeps ids unique
 * enough for tracing and event correlation; it is not for anything security sensitive.
 */
export function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const hex = (digits: number): string =>
    Math.floor(Math.random() * 16 ** digits)
      .toString(16)
      .padStart(digits, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}
