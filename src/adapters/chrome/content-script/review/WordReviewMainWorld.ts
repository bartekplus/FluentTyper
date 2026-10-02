import type { ProtectedRange } from "@core/domain/grammar/review/types";
import {
  applyEdits,
  editTouches,
  isGraphemeBoundary,
} from "@core/domain/grammar/review/textRanges";
import { isCredentialField } from "../suggestions/FieldEligibility";
import { isNonWritingControl, isWordInputProxy } from "../suggestions/CodeContextResolver";
import {
  wordEditor,
  WORD_REVIEW_EVENT,
  WORD_REVIEW_RESPONSE,
  WORD_REVIEW_MAX_MESSAGE,
  type WordReviewRequest,
  type WordReviewReply,
  type WordReviewSnapshot,
} from "./WordReviewProtocol";

interface Collection {
  length(): number;
}
interface WordRange {
  text: string;
  parentBody?: WordBody;
  isEmpty: boolean;
  getRange(location: number): WordRange;
  expandTo(range: WordRange): WordRange;
  insertText(text: string, location: number): WordRange;
}
interface WordParagraph {
  text: string;
  uniqueLocalId: string;
  fields: Collection;
  contentControls: Collection;
  inlinePictures: Collection;
  footnotes: Collection;
  endnotes: Collection;
  parentContentControlOrNullObject: { isNullObject?: boolean } | null | undefined;
  getNext(): WordParagraph;
  getRange(location: number): WordRange;
  getSubrange(offset: number, length: number): WordRange;
}
interface WordBody {
  type?: number;
  text: string;
  paragraphs: Collection & { getFirst(): WordParagraph };
  getRange(location: number): WordRange;
}
export interface WordDocument {
  changeTrackingMode: number;
  body: WordBody;
  getSelection(): WordRange;
}
type WordWindow = Window & {
  WordEditor?: {
    Extension?: {
      BodyType?: Record<number, unknown>;
      AutomationUtility?: { getDocument(): WordDocument };
      AutomationTransaction?: {
        new (): { dispose(): void };
        prototype: { dispose(): void };
      };
    };
  };
};
interface ModelSnapshot {
  body: WordBody;
  text: string;
  signature: string;
  protectedRanges: ProtectedRange[];
  paragraphs: { model: WordParagraph; start: number; text: string }[];
}

/** Named Word automation methods only; no minified properties or rendered-DOM writes. */
function readModel(model: WordDocument, body = model.getSelection().parentBody): ModelSnapshot {
  if (!body) throw new Error("unsupported");
  const raw = body.text;
  // ponytail: bound model enumeration; a windowed reader is needed above the existing DOM-map ceiling.
  if (typeof raw !== "string" || raw.length > 200_000) throw new Error("unsupported");
  const count = body.paragraphs.length();
  if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error("unsupported");
  const paragraphs: ModelSnapshot["paragraphs"] = [];
  const protectedRanges: ProtectedRange[] = [];
  const ids: unknown[] = [];
  const seen = new Set<string>();
  let paragraph = body.paragraphs.getFirst();
  const text = raw.replace(/\r/g, "\n");
  let cursor = 0;
  let anchor = body.getRange(1);
  let anchorOffset = 0;
  for (let i = 0; i < count; i++) {
    if (
      typeof paragraph.text !== "string" ||
      typeof paragraph.uniqueLocalId !== "string" ||
      !paragraph.uniqueLocalId ||
      paragraph.uniqueLocalId.length > 64 ||
      seen.has(paragraph.uniqueLocalId)
    )
      throw new Error("unsupported");
    seen.add(paragraph.uniqueLocalId);
    // Consecutive start-to-start ranges cover each character once, rather than
    // rematerializing the whole body prefix for every paragraph on each poll.
    const paragraphStart = paragraph.getRange(1);
    const preceding = anchor.expandTo(paragraphStart).text;
    const start = anchorOffset + preceding.length;
    const end = start + paragraph.text.length;
    if (
      start < cursor ||
      end > raw.length ||
      preceding !== raw.slice(anchorOffset, start) ||
      paragraph.text !== raw.slice(start, end)
    )
      throw new Error("unsupported");
    if (start > cursor) protectedRanges.push({ start: cursor, end: start, reason: "structure" });
    const parent = paragraph.parentContentControlOrNullObject;
    const protectedContent =
      (!!parent && parent.isNullObject !== true) ||
      [
        paragraph.fields,
        paragraph.contentControls,
        paragraph.inlinePictures,
        paragraph.footnotes,
        paragraph.endnotes,
      ]
        .map((collection) => collection.length())
        .some((length) => {
          if (!Number.isInteger(length) || length < 0) throw new Error("unsupported");
          return length > 0;
        });
    if (protectedContent && end > start) protectedRanges.push({ start, end, reason: "structure" });
    else
      for (let offset = 0; offset < paragraph.text.length; offset++) {
        if (/[\r\n\v\f\uFFFC]/.test(paragraph.text[offset]))
          protectedRanges.push({
            start: start + offset,
            end: start + offset + 1,
            reason: "structure",
          });
      }
    paragraphs.push({ model: paragraph, start, text: paragraph.text });
    ids.push([paragraph.uniqueLocalId, protectedContent]);
    cursor = end;
    anchor = paragraphStart;
    anchorOffset = start;
    if (i + 1 < count) paragraph = paragraph.getNext();
  }
  if (cursor < raw.length)
    protectedRanges.push({ start: cursor, end: raw.length, reason: "structure" });
  return {
    body,
    text,
    paragraphs,
    protectedRanges,
    signature: JSON.stringify([model.changeTrackingMode, body.type ?? null, ids]),
  };
}

function selectionScope(model: WordDocument, snapshot: ModelSnapshot) {
  const selected = model.getSelection();
  const prefix = snapshot.body.getRange(1).expandTo(selected.getRange(1)).text;
  const start = prefix.length;
  const end = start + selected.text.length;
  const raw = snapshot.body.text;
  if (
    prefix !== raw.slice(0, start) ||
    selected.text !== raw.slice(start, end) ||
    end > snapshot.text.length
  )
    throw new Error("unsupported");
  return selected.isEmpty ? null : { start, end };
}

/** Page messages grant no extension APIs. Text exists only for the explicitly opened review. */
export function installWordReviewMainWorld(doc: Document = document): () => void {
  let story: { body: WordBody; root: HTMLElement; input: HTMLElement; url: string } | null = null;
  let pending: { token: string; snapshot: ModelSnapshot; root: HTMLElement; url: string } | null =
    null;
  let composing: HTMLElement | null = null;
  const composition = (event: Event) => {
    if (!(event.target instanceof HTMLElement) || !isWordInputProxy(event.target)) return;
    composing = event.type === "compositionstart" ? event.target : null;
    pending = null;
  };
  const listener = (event: Event) => {
    const root = wordEditor(doc);
    if (!root || event.target !== root) return;
    let writing = false;
    let reply: WordReviewReply = { ok: false, reason: "unsupported" };
    try {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "string" || detail.length > WORD_REVIEW_MAX_MESSAGE) {
        pending = null;
        return;
      }
      const request = JSON.parse(detail) as WordReviewRequest;
      if (request.action === "close") {
        pending = null;
        story = null;
        return;
      }
      if (story && (story.root !== root || story.url !== doc.URL)) {
        pending = null;
        const active = doc.activeElement;
        if (
          request.action !== "read" ||
          request.selection !== true ||
          !(active instanceof HTMLElement) ||
          !root.contains(active) ||
          !isWordInputProxy(active)
        )
          throw new Error("unsupported");
        story = null; // Only a focused initial Review read can bind a replacement editor.
      }
      const input = story?.input ?? doc.activeElement;
      if (!(input instanceof HTMLElement) || !root.contains(input) || !isWordInputProxy(input))
        throw new Error("unsupported");
      if (composing?.isConnected && root.contains(composing)) {
        reply = { ok: false, reason: "composing" };
        pending = null;
      } else if (
        isCredentialField(input) ||
        isNonWritingControl(input) ||
        input.matches("[readonly], [disabled]") ||
        input.closest('[aria-readonly="true"], [aria-disabled="true"], [inert]') ||
        root.closest('[hidden], [inert], [aria-hidden="true"]') ||
        (typeof root.checkVisibility === "function" &&
          !root.checkVisibility({ visibilityProperty: true }))
      ) {
        reply = { ok: false, reason: "ineligible" };
        pending = null;
      } else {
        const extension = (doc.defaultView as WordWindow | null)?.WordEditor?.Extension;
        const model = extension?.AutomationUtility?.getDocument();
        if (!model) throw new Error("unsupported");
        if (request.action === "matches-selection") {
          const selected = model.getSelection().parentBody;
          if (!selected) throw new Error("unsupported");
          const id = selected.paragraphs.getFirst().uniqueLocalId;
          root.setAttribute(
            WORD_REVIEW_RESPONSE,
            JSON.stringify({
              matchesSelection:
                !!story &&
                selected.type === story.body.type &&
                typeof id === "string" &&
                id.length > 0 &&
                id === story.body.paragraphs.getFirst().uniqueLocalId,
            }),
          );
          return; // Identity probe never scans text or replaces a pending token.
        }
        // The caret can move between stories while a panel stays open. Retain
        // the native body selected on first read until that review closes.
        const current = readModel(model, story?.body);
        if (request.action === "read") {
          const token = crypto.randomUUID();
          const selection = request.selection ? selectionScope(model, current) : null;
          story ??= { body: current.body, root, input, url: doc.URL };
          // Header/footer geometry requires a named host enum, never a guess
          // from an opaque nonzero body type or matching rendered text.
          const kind = Number.isInteger(current.body.type)
            ? extension?.BodyType?.[current.body.type!]
            : null;
          pending = { token, snapshot: current, root, url: doc.URL };
          const snapshot: WordReviewSnapshot = {
            ok: true,
            text: current.text,
            protectedRanges: current.protectedRanges,
            signature: current.signature,
            token,
            selection,
            bodyType: Number.isInteger(current.body.type) ? current.body.type! : null,
            headerFooter: kind === "Header" || kind === "Footer" ? kind : null,
          };
          reply = snapshot;
        } else if (request.action === "apply") {
          const previous = pending;
          pending = null; // Every token is consumed, including rejected writes.
          reply = { status: "stale" };
          if (
            previous &&
            previous.token === request.token &&
            previous.root === root &&
            previous.url === doc.URL &&
            current.text === request.before &&
            current.text === previous.snapshot.text &&
            current.signature === request.signature &&
            current.signature === previous.snapshot.signature
          ) {
            reply = { status: "rejected", reason: "unsupported" };
            const edits = request.edits;
            if (
              Array.isArray(edits) &&
              edits.length > 0 &&
              edits.length <= 1000 &&
              typeof request.after === "string" &&
              request.after.length <= 200_000 &&
              edits.every(
                (edit) =>
                  edit &&
                  Number.isInteger(edit.start) &&
                  Number.isInteger(edit.end) &&
                  edit.start >= 0 &&
                  edit.end >= edit.start &&
                  edit.end <= current.text.length &&
                  typeof edit.original === "string" &&
                  typeof edit.replacement === "string" &&
                  !/[\r\n\v\f\uFFFC]/.test(edit.replacement) &&
                  isGraphemeBoundary(current.text, edit.start) &&
                  isGraphemeBoundary(current.text, edit.end) &&
                  !current.protectedRanges.some((range) => editTouches(edit, range)),
              ) &&
              applyEdits(current.text, edits) === request.after &&
              model.changeTrackingMode === 0
            ) {
              const Transaction = extension?.AutomationTransaction;
              if (
                typeof Transaction !== "function" ||
                typeof Transaction.prototype.dispose !== "function"
              )
                throw new Error("unsupported");
              const transaction = new Transaction();
              try {
                const fresh = readModel(extension!.AutomationUtility!.getDocument(), current.body);
                if (fresh.text !== current.text || fresh.signature !== current.signature)
                  throw new Error("stale");
                // Validate every native range before the first write. Descending offsets
                // keep earlier ranges stable, including multiple edits in one paragraph.
                const ranges = [...edits]
                  .sort((a, b) => b.start - a.start)
                  .map((edit) => {
                    const paragraph = fresh.paragraphs.find(
                      (p) => edit.start >= p.start && edit.end <= p.start + p.text.length,
                    );
                    if (!paragraph) throw new Error("unsupported");
                    const range = paragraph.model.getSubrange(
                      edit.start - paragraph.start,
                      edit.end - edit.start,
                    );
                    if (range.text !== edit.original) throw new Error("stale");
                    return { range, edit };
                  });
                for (const { range, edit } of ranges) {
                  writing = true;
                  range.insertText(edit.replacement, 4); // Native Replace preserves formatting.
                }
              } finally {
                transaction.dispose(); // One native Undo step for the complete batch.
              }
              if (writing) {
                const after = readModel(extension!.AutomationUtility!.getDocument(), current.body);
                reply =
                  after.text === request.after && after.signature === current.signature
                    ? { status: "applied" }
                    : { status: "unverified" };
              }
            }
          }
        }
      }
    } catch {
      pending = null;
      reply = writing ? { status: "unverified" } : { ok: false, reason: "unsupported" };
    }
    root.setAttribute(WORD_REVIEW_RESPONSE, JSON.stringify(reply));
  };
  doc.addEventListener(WORD_REVIEW_EVENT, listener);
  doc.addEventListener("compositionstart", composition, true);
  doc.addEventListener("compositionend", composition, true);
  return () => {
    pending = null;
    story = null;
    doc.removeEventListener(WORD_REVIEW_EVENT, listener);
    doc.removeEventListener("compositionstart", composition, true);
    doc.removeEventListener("compositionend", composition, true);
  };
}
