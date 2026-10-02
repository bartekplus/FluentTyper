import { isObjectRecord } from "./guards";

export const FIELD_PREFERENCE_LIMIT = 100;
export interface FieldPreference {
  version: 1;
  topOrigin: string;
  frameOrigin: string;
  signature: string;
  enabled: true;
  label: string;
}
export type FieldPreferenceRequest =
  | { action: "hash"; source: string }
  | { action: "list" }
  | { action: "enable"; signature: string; label: string }
  | { action: "rename"; topOrigin: string; frameOrigin: string; signature: string; label: string }
  | { action: "forget"; topOrigin: string; frameOrigin: string; signature: string }
  | { action: "clear"; topOrigin: string };
export type FieldPreferenceResponse =
  { ok: true; records: FieldPreference[]; signature?: string } | { ok: false; error: string };

export function webOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}
export function isFieldSignature(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function isFieldLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 80 &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  );
}
export function sanitizeFieldPreferences(raw: unknown): FieldPreference[] {
  if (!Array.isArray(raw)) return [];
  const result: FieldPreference[] = [];
  for (const item of raw.slice(0, FIELD_PREFERENCE_LIMIT)) {
    if (
      !isObjectRecord(item) ||
      item.version !== 1 ||
      item.enabled !== true ||
      !isFieldSignature(item.signature) ||
      !isFieldLabel(item.label) ||
      webOrigin(item.topOrigin) !== item.topOrigin ||
      webOrigin(item.frameOrigin) !== item.frameOrigin ||
      !item.topOrigin ||
      !item.frameOrigin
    )
      continue;
    const record: FieldPreference = {
      version: 1,
      enabled: true,
      signature: item.signature,
      label: item.label,
      topOrigin: item.topOrigin as string,
      frameOrigin: item.frameOrigin as string,
    };
    if (
      !result.some(
        (existing) =>
          existing.topOrigin === record.topOrigin &&
          existing.frameOrigin === record.frameOrigin &&
          existing.signature === record.signature,
      )
    )
      result.push(record);
  }
  return result;
}

/** Raw structural anchors are hashed ephemerally; callers persist only the digest. */
export async function hashFieldSource(source: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
