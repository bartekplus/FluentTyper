import {
  hashFieldSource,
  isFieldSignature,
  type FieldPreferenceResponse,
} from "@core/domain/fieldPreferences";
// Only conservative structural anchors; values, labels, URL paths and text never enter the key.
function anchor(element: Element): string | null {
  const root = element.getRootNode() as Document | ShadowRoot;
  for (const attribute of ["id", "name"]) {
    const value = element.getAttribute(attribute);
    if (
      !value ||
      !/^[A-Za-z]{2,}(?:[-_][A-Za-z]{2,})*$/.test(value) ||
      value.length > 64 ||
      /^(?:react|radix|headlessui|mui)[-_]/i.test(value)
    )
      continue;
    if (root.querySelectorAll(`[${attribute}="${value}"]`).length === 1)
      return `${attribute}:${value}`;
  }
  return null;
}

export function fieldSignatureSource(element: HTMLElement): string | null {
  if (!element.isConnected) return null;
  const own = anchor(element);
  if (!own) return null;
  const parts = [
    "1",
    element.tagName,
    element.getAttribute("type") ?? "text",
    element.getAttribute("role") ?? "",
    (element.getAttribute("autocomplete") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((token) =>
        /^(?:name|given-name|family-name|additional-name|honorific-prefix|honorific-suffix|nickname|email|url|tel(?:-[a-z]+)?|street-address|address-level[1-4]|address-line[1-3]|postal-code|username)$/.test(
          token,
        ),
      )
      .join(" "),
    own,
  ];
  const form = element.closest("form");
  if (form) {
    const formAnchor = anchor(form);
    if (!formAnchor) return null;
    parts.push(`form:${formAnchor}`);
  }
  let root = element.getRootNode();
  while ("host" in root) {
    const host = (root as ShadowRoot).host;
    const hostAnchor = anchor(host);
    if (!hostAnchor) return null;
    parts.push(`host:${host.tagName}:${hostAnchor}`);
    root = host.getRootNode();
  }
  return JSON.stringify(parts);
}

export async function hashFieldSignature(source: string): Promise<string> {
  if (globalThis.crypto?.subtle) return hashFieldSource(source);
  // HTTP pages lack Web Crypto; the extension background is a secure context.
  const response: FieldPreferenceResponse = await chrome.runtime.sendMessage({
    command: "CMD_FIELD_PREFERENCES",
    context: { action: "hash", source },
  });
  if (response?.ok && isFieldSignature(response.signature)) return response.signature;
  throw new Error("Could not identify this field. Temporary activation still works.");
}
