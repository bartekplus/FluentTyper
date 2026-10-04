import type {
  ReviewApplyResult,
  ReviewCapabilities,
  ReviewTargetRead,
} from "@core/application/review/ReviewSession";
import type { TextRange } from "@core/domain/grammar/review/types";
import type { GutenbergApplyRequest, GutenbergSnapshot } from "../suggestions/GutenbergEditor";
import { gutenbergCanvas, gutenbergFields } from "../suggestions/GutenbergEnvironment";
import { InjectedHostEditorPageBridge } from "../suggestions/HostEditorPageBridge";
import { buildContentEditableTextMap, offsetRangeToDomRange } from "./ContentEditableTextMap";
import type { ReviewTargetHandle } from "./ReviewTargets";

/** One Review session spans the active Gutenberg canvas and its post title. */
export class GutenbergReviewTarget implements ReviewTargetHandle {
  get element(): HTMLElement {
    return gutenbergCanvas(this.source) ?? this.source;
  }
  readonly capabilities: ReviewCapabilities = { apply: true, bulk: true };
  composing = false;
  scope: TextRange | null = null;
  private snapshot: GutenbergSnapshot | null = null;
  private readonly bridge: InjectedHostEditorPageBridge;

  constructor(private readonly source: HTMLElement) {
    this.bridge = new InjectedHostEditorPageBridge(source.ownerDocument);
  }
  captureSelection(): boolean {
    this.snapshot = this.bridge.readGutenberg(this.source, true);
    if (!this.snapshot) return false;
    this.scope = this.snapshot?.scope ?? null;
    return true;
  }
  read(): ReviewTargetRead {
    if (!this.element.isConnected || !this.source.isConnected)
      return { ok: false, reason: "detached" };
    if (this.composing) return { ok: false, reason: "composing" };
    this.snapshot = this.bridge.readGutenberg(this.source);
    return this.snapshot ? { ok: true, ...this.snapshot } : { ok: false, reason: "unsupported" };
  }
  sourceChanged(): boolean {
    const next = this.bridge.readGutenberg(this.source);
    return next?.signature !== this.snapshot?.signature || !!next !== !!this.snapshot;
  }
  async apply(request: GutenbergApplyRequest): Promise<ReviewApplyResult> {
    if (this.composing) return { status: "rejected", reason: "composing" };
    const result = this.bridge.applyGutenberg(this.source, request);
    if (result.status !== "applied") return result;
    await new Promise<void>((resolve) => {
      const win = this.source.ownerDocument.defaultView!;
      const timer = win.setTimeout(resolve, 50);
      win.requestAnimationFrame(() => {
        win.clearTimeout(timer);
        resolve();
      });
    });
    const read = this.read();
    return read.ok && read.text === request.after
      ? { status: "applied", signature: read.signature }
      : { status: "unverified" };
  }
  domRange(range: TextRange): Range | null {
    if (!this.snapshot) return null;
    const field = this.snapshot.fields.find(
      (part) => range.start >= part.start && range.end <= part.end,
    );
    const element = field ? gutenbergFields(this.source)[field.index] : null;
    if (!field || !element?.isConnected) return null;
    const map = buildContentEditableTextMap(element);
    if (map.text !== this.snapshot.text.slice(field.start, field.end)) return null;
    return offsetRangeToDomRange(
      map,
      { start: range.start - field.start, end: range.end - field.start },
      element.ownerDocument,
    );
  }
  rangeRects(range: TextRange): DOMRect[] {
    const dom = this.domRange(range);
    if (!dom) return [];
    if (dom.startContainer.ownerDocument === this.element.ownerDocument)
      return Array.from(dom.getClientRects());
    try {
      const frame = this.element.ownerDocument.defaultView?.frameElement;
      if (
        !frame ||
        frame.nodeType !== 1 ||
        frame.ownerDocument !== dom.startContainer.ownerDocument
      )
        return [];
      const box = frame.getBoundingClientRect();
      return Array.from(
        dom.getClientRects(),
        (rect) =>
          new DOMRect(
            rect.x - box.x - frame.clientLeft,
            rect.y - box.y - frame.clientTop,
            rect.width,
            rect.height,
          ),
      );
    } catch {
      return [];
    }
  }
  reveal(range: TextRange): void {
    this.domRange(range)?.startContainer.parentElement?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }
  focusEditor(): void {
    this.source.focus({ preventScroll: true });
  }
  setMeasurementRoot(): void {}
  dispose(): void {
    this.snapshot = null;
  }
}
