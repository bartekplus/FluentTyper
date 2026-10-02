import type { ReviewTargetRead, ReviewApplyResult } from "@core/application/review/ReviewSession";
import { editTouches } from "@core/domain/grammar/review/textRanges";
import type { TextRange } from "@core/domain/grammar/review/types";
import type { ReviewTargetHandle } from "./ReviewTargets";
import {
  WORD_REVIEW_EVENT,
  WORD_REVIEW_RESPONSE,
  WORD_REVIEW_MAX_MESSAGE,
  type WordReviewRequest,
  type WordReviewReply,
  type WordReviewSnapshot,
} from "./WordReviewProtocol";

type RenderedSegment = { node: Text | Element; start: number; end: number };

/** Word's rendered pages are not contenteditable; all reads and edits use its model. */
export class WordReviewTarget implements ReviewTargetHandle {
  readonly kind = "model-editor" as const;
  readonly capabilities = { inline: true, apply: true, bulk: true, undo: "single-step" as const };
  composing = false;
  private snapshot: WordReviewSnapshot | null = null;
  private disposed = false;
  private initialFailure: ReviewTargetRead | null = null;
  private segments: RenderedSegment[] | null | undefined;
  private renderedRoot: Element | undefined;
  private readonly observer: MutationObserver;
  constructor(
    readonly element: HTMLElement,
    readonly inputProxy: HTMLElement,
  ) {
    this.observer = new MutationObserver(() => {
      this.segments = undefined;
    });
    this.observer.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "aria-hidden"],
    });
  }

  private request(request: WordReviewRequest): WordReviewReply | null {
    if (this.disposed || !this.element.isConnected) return null;
    this.element.removeAttribute(WORD_REVIEW_RESPONSE);
    try {
      const win = this.element.ownerDocument.defaultView!;
      this.element.dispatchEvent(
        new win.CustomEvent(WORD_REVIEW_EVENT, { bubbles: true, detail: JSON.stringify(request) }),
      );
      const raw = this.element.getAttribute(WORD_REVIEW_RESPONSE);
      if (!raw || raw.length > WORD_REVIEW_MAX_MESSAGE) return null;
      const reply = JSON.parse(raw) as WordReviewReply;
      if ("matchesSelection" in reply)
        return typeof reply.matchesSelection === "boolean" ? reply : null;
      if ("ok" in reply) {
        if (!reply.ok)
          return ["unsupported", "detached", "ineligible", "composing"].includes(reply.reason)
            ? reply
            : null;
        const validRange = (range: TextRange) =>
          Number.isInteger(range.start) &&
          Number.isInteger(range.end) &&
          range.start >= 0 &&
          range.end >= range.start &&
          range.end <= reply.text.length;
        if (
          typeof reply.text !== "string" ||
          reply.text.length > 200_000 ||
          typeof reply.signature !== "string" ||
          typeof reply.token !== "string" ||
          (reply.bodyType !== null && !Number.isInteger(reply.bodyType)) ||
          !Array.isArray(reply.protectedRanges) ||
          !reply.protectedRanges.every(
            (range) => validRange(range) && range.reason === "structure",
          ) ||
          (reply.selection !== null && !validRange(reply.selection))
        )
          return null;
        return reply;
      }
      return ["applied", "stale", "unverified"].includes(reply.status) ||
        (reply.status === "rejected" &&
          ["unsupported", "detached", "ineligible", "composing", "host-refused"].includes(
            reply.reason,
          ))
        ? reply
        : null;
    } catch {
      return null;
    } finally {
      this.element.removeAttribute(WORD_REVIEW_RESPONSE);
    }
  }

  matchesSelection(): boolean {
    const reply = this.request({ action: "matches-selection" });
    return !!reply && "matchesSelection" in reply && reply.matchesSelection;
  }

  read(selection = false): ReviewTargetRead {
    if (this.disposed || !this.element.isConnected) return { ok: false, reason: "detached" };
    if (this.composing) return { ok: false, reason: "composing" };
    // A selection we could not map never widens to the whole document on the next read.
    if (this.initialFailure) return this.initialFailure;
    const result = this.request({ action: "read", selection });
    if (result && "ok" in result) {
      if (
        !result.ok ||
        result.signature !== this.snapshot?.signature ||
        result.text !== this.snapshot?.text
      )
        this.segments = undefined;
      this.snapshot = result.ok ? result : null;
      if (result.ok) this.captureRenderedRoot();
      if (selection && !result.ok) this.initialFailure = result;
      return result;
    }
    this.snapshot = null;
    const failure: ReviewTargetRead = { ok: false, reason: "unsupported" };
    if (selection) this.initialFailure = failure;
    return failure;
  }

  sourceChanged(text: string): boolean {
    const signature = this.snapshot?.signature;
    const read = this.read();
    return (
      !read.ok || read.text !== text || (signature !== undefined && read.signature !== signature)
    );
  }

  get scope(): TextRange | null {
    return this.snapshot?.selection ?? null;
  }

  apply(request: Parameters<ReviewTargetHandle["apply"]>[0]): Promise<ReviewApplyResult> {
    if (this.composing) return Promise.resolve({ status: "rejected", reason: "composing" });
    if (this.disposed || !this.element.isConnected)
      return Promise.resolve({ status: "rejected", reason: "detached" });
    const token = this.snapshot?.token;
    this.snapshot = null;
    if (!token || request.edits.length === 0)
      return Promise.resolve({ status: "rejected", reason: "unsupported" });
    const result = this.request({
      action: "apply",
      token,
      before: request.before,
      after: request.after,
      signature: request.signature,
      edits: request.edits,
    });
    return Promise.resolve(
      result && "status" in result ? result : { status: "rejected", reason: "host-refused" },
    );
  }

  private captureRenderedRoot(): void {
    if (this.renderedRoot || !this.snapshot) return;
    const view = this.inputProxy.closest(".WACInteractiveView") ?? this.element;
    if (this.snapshot.bodyType !== 0) {
      // Bind only while the native selection still belongs to this Review. A
      // later caret move must not choose an identical header from another story.
      if (!this.matchesSelection()) return;
      const boxes = [...view.querySelectorAll(".Header, .Footer")].filter(
        (box) => !box.closest(".InactiveBoxRendering"),
      );
      if (boxes.length === 1) this.renderedRoot = boxes[0];
      // Non-main stories sharing the main proxy need an active story box.
      // Notes use their own sibling interactive view.
      else if (boxes.length === 0 && !view.matches("#WACViewPanel.WACInteractiveView"))
        this.renderedRoot = view;
      return;
    }
    this.renderedRoot = view;
  }

  /** Word renders tabs as spans and paragraph marks as synthetic text. Only an
   * exact, complete ordered model/DOM match establishes offsets; never search
   * for a finding's text (identical paragraphs must remain distinct). */
  private renderedSegments(): RenderedSegment[] | null {
    if (!this.snapshot || !this.element.isConnected) return null;
    if (this.observer.takeRecords().length) this.segments = undefined;
    this.captureRenderedRoot();
    const view = this.renderedRoot;
    if (!view?.isConnected || view.closest(".InactiveBoxRendering")) return null;
    if (this.segments !== undefined) return this.segments;
    const segments: RenderedSegment[] = [];
    let text = "";
    const paragraphs = [...view.querySelectorAll(".Paragraph")].filter(
      (paragraph) =>
        !paragraph.closest(".InactiveBoxRendering") &&
        (view.matches(".Header, .Footer") || !paragraph.closest(".Header, .Footer")),
    );
    for (const [index, paragraph] of paragraphs.entries()) {
      if (index) text += "\n";
      const visit = (node: Node): void => {
        if (node.nodeType === 3) {
          // Word renders ordinary leading spaces as NBSP; only normalize where
          // the model has a same-width ordinary space at this exact offset.
          const value = (node.textContent ?? "").replace(/\u00a0/g, (space, offset: number) =>
            this.snapshot!.text[text.length + offset] === " " ? " " : space,
          );
          if (value)
            segments.push({
              node: node as Text,
              start: text.length,
              end: text.length + value.length,
            });
          text += value;
          return;
        }
        if (node.nodeType !== 1) return;
        const element = node as Element;
        if (element.matches(".EOP, .ListMarker, .BlobObject, [aria-hidden='true']")) return;
        if (element.matches(".TabRun")) {
          segments.push({ node: element, start: text.length, end: text.length + 1 });
          text += "\t";
          return;
        }
        for (const child of element.childNodes) visit(child);
      };
      visit(paragraph);
    }
    this.segments = text === this.snapshot.text ? segments : null;
    return this.segments;
  }

  rangeRects(range: TextRange): DOMRect[] {
    const dom = this.domRange(range);
    return dom ? [...dom.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0) : [];
  }
  domRange(range: TextRange): Range | null {
    if (
      !this.snapshot ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > this.snapshot.text.length ||
      this.snapshot.protectedRanges.some((protectedRange) => editTouches(range, protectedRange))
    )
      return null;
    const segments = this.renderedSegments();
    if (!segments) return null;
    const first = segments.find(
      (segment) => range.start >= segment.start && range.start < segment.end,
    );
    const last = segments.find((segment) => range.end > segment.start && range.end <= segment.end);
    if (!first || !last) return null;
    const dom = this.element.ownerDocument.createRange();
    if (first.node.nodeType === 3) dom.setStart(first.node, range.start - first.start);
    else dom.setStartBefore(first.node);
    if (last.node.nodeType === 3) dom.setEnd(last.node, range.end - last.start);
    else dom.setEndAfter(last.node);
    return dom;
  }
  reveal(range: TextRange): void {
    const dom = this.domRange(range);
    const parent =
      dom?.startContainer.nodeType === 1
        ? (dom.startContainer as Element)
        : dom?.startContainer.parentElement;
    parent?.scrollIntoView({ block: "center", inline: "nearest" });
  }
  setMeasurementRoot(_root: ShadowRoot): void {}
  focusEditor(): void {
    if (this.inputProxy.isConnected && this.element.contains(this.inputProxy))
      this.inputProxy.focus({ preventScroll: true });
  }
  dispose(): void {
    if (this.disposed) return;
    this.request({ action: "close" });
    this.snapshot = null;
    this.segments = undefined;
    this.observer.disconnect();
    this.disposed = true;
  }
}
