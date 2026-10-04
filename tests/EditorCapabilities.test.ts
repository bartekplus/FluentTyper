import { afterEach, expect, jest, test } from "bun:test";
import { editorCapabilities } from "../src/adapters/chrome/content-script/suggestions/EditorCapabilities";
import {
  TextControlReviewTarget,
  ContentEditableReviewTarget,
} from "../src/adapters/chrome/content-script/review/ReviewTargets";
import { createEditor, setCaret } from "./codeContextTestUtils";

afterEach(() => document.body.replaceChildren());

function input(): HTMLInputElement {
  const field = document.createElement("input");
  document.body.append(field);
  return field;
}

test("metadata does not suppress prose and diagnostics contain no field text", () => {
  const field = input();
  field.value = "private fixture text";
  field.setAttribute("role", "combobox");
  field.setAttribute("aria-autocomplete", "list");
  field.setAttribute("aria-expanded", "true");
  field.setAttribute("aria-controls", "missing");
  expect(editorCapabilities(field)).toMatchObject({
    inspectProse: true,
    displaySuggestions: true,
    renderReview: true,
    consumeAcceptanceKey: true,
    conflict: "none",
    reason: "available",
  });
  expect(JSON.stringify(editorCapabilities(field))).not.toContain(field.value);
});

test("a linked popup changes key ownership without changing Review eligibility", () => {
  const field = input();
  field.setAttribute("aria-controls", "choices");
  const popup = document.createElement("div");
  popup.id = "choices";
  popup.setAttribute("role", "listbox");
  popup.innerHTML = '<div role="option" id="choice">Synthetic option</div>';
  for (const node of [popup, popup.firstElementChild!]) {
    node.getClientRects = () =>
      [{ left: 10, top: 10, right: 110, bottom: 30 }] as unknown as DOMRectList;
  }
  document.body.append(popup);
  const review = new TextControlReviewTarget(field);
  for (const open of [true, false, true, false]) {
    popup.hidden = !open;
    field.setAttribute("aria-activedescendant", open ? "choice" : "missing");
    // Deliberately stale metadata must not poison later classifications.
    field.setAttribute("aria-expanded", "true");
    expect(editorCapabilities(field)).toMatchObject({
      consumeAcceptanceKey: !open,
      renderReview: true,
      conflict: open ? "native-popup" : "none",
    });
    expect(review.read().ok).toBe(true);
  }
  field.removeAttribute("aria-controls");
  popup.hidden = false;
  expect(editorCapabilities(field).consumeAcceptanceKey).toBe(true);
});

test("unverified model editors remain readable without a generic writer", async () => {
  const field = createEditor("<p>Readable <b>prose</b></p><pre>const value = 1;</pre>");
  field.classList.add("DraftEditor-root");
  setCaret(field.firstElementChild!.firstChild!);
  const target = new ContentEditableReviewTarget(field);
  expect(
    editorCapabilities(field, { fieldActivated: true, review: target.capabilities }),
  ).toMatchObject({
    inspectProse: true,
    renderReview: true,
    displaySuggestions: false,
    reviewApply: false,
    consumeAcceptanceKey: false,
    reason: "unverified-writer",
  });
  expect(target.read().ok).toBe(true);
  expect(await target.apply({ before: "", after: "", signature: "", edits: [] })).toEqual({
    status: "rejected",
    reason: "unsupported",
  });
});

test("sensitive transitions never read a value, including with explicit activation", () => {
  const field = input();
  const read = jest.fn(() => {
    throw new Error("Sensitive value was read.");
  });
  Object.defineProperty(field, "value", { get: read });
  for (const autocomplete of ["current-password", "one-time-code", "cc-number"]) {
    field.setAttribute("autocomplete", autocomplete);
    expect(
      editorCapabilities(field, { fieldActivated: true, preferNativeAutocomplete: false })
        .inspectProse,
    ).toBe(false);
    expect(new TextControlReviewTarget(field).read().ok).toBe(false);
  }
  expect(read).not.toHaveBeenCalled();
});

test("locked state, shadow ancestors, and replacement do not persist negative state", () => {
  const field = input();
  const host = document.createElement("div");
  document.body.append(host);
  host.attachShadow({ mode: "open" }).append(field);
  host.setAttribute("aria-disabled", "true");
  expect(editorCapabilities(field).inspectProse).toBe(false);
  host.removeAttribute("aria-disabled");
  expect(editorCapabilities(field).inspectProse).toBe(true);
  field.readOnly = true;
  expect(editorCapabilities(field).displaySuggestions).toBe(false);
  field.readOnly = false;
  expect(editorCapabilities(field).displaySuggestions).toBe(true);
  const replacement = field.cloneNode() as HTMLInputElement;
  field.replaceWith(replacement);
  expect(editorCapabilities(field).reason).toBe("detached");
  expect(editorCapabilities(replacement).reason).toBe("available");
});

test("weak CSS hints do not exclude a document and mixed code stays range protected", () => {
  const field = createEditor("<p>prose</p><code>literal</code>");
  field.className = "code-snippet-document";
  setCaret(field.firstElementChild!.firstChild!);
  expect(editorCapabilities(field).renderReview).toBe(true);
  setCaret(field.lastElementChild!.firstChild!);
  expect(editorCapabilities(field)).toMatchObject({ context: "code", renderReview: true });
  const read = new ContentEditableReviewTarget(field).read();
  expect(read.ok && read.protectedRanges.length > 0).toBe(true);
});

test("a model mounted during Review cannot inherit the previous generic writer", async () => {
  const field = createEditor("<p>teh</p>");
  const target = new ContentEditableReviewTarget(field);
  field.setAttribute("data-slate-editor", "true");
  expect(target.capabilities.apply).toBe(false);
  const before = field.innerHTML;
  const result = await target.apply({
    before: "teh",
    after: "the",
    signature: "",
    edits: [{ start: 0, end: 3, original: "teh", replacement: "the" }],
  });
  expect(result.status).toBe("rejected");
  expect(field.innerHTML).toBe(before);
  field.removeAttribute("data-slate-editor");
  expect(editorCapabilities(field).reason).toBe("available");
});
