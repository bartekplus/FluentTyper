/**
 * The common contract of the Review editor fixtures. Each fixture loads one real
 * editor into #test-review-editor with the same seeded paragraph and no undo
 * history, and publishes its model readers on `window.__testReviewEditor`.
 */
export const LINK = "https://example.com/keep";
export const SEED_TEXT = "We saw teh cat and teh dog.";
export const SEED_HTML = `<p>We saw <strong>teh</strong> cat and <a href="${LINK}">teh</a> dog.</p>`;
/** With `?reviewSeed=blocks`, the typing tests get these blocks after the seeded paragraph. */
export const EXTRA_PARAGRAPH = "Second line here.";
export const EXTRA_LIST_ITEM = "List item here.";

export function blockSeed(): boolean {
  return new URLSearchParams(location.search).get("reviewSeed") === "blocks";
}

/** The seed in the HTML that the editor reads, with its blocks when the page asks for them. */
export function seedHtml(paragraph = SEED_HTML, tag = "p"): string {
  return blockSeed()
    ? `${paragraph}<${tag}>${EXTRA_PARAGRAPH}</${tag}><ul><li>${EXTRA_LIST_ITEM}</li></ul>`
    : paragraph;
}

export interface ReviewEditorRuns {
  bold: string[];
  links: string[];
}

export interface TestReviewEditor {
  /** Selector of the iframe that holds the editable, or null for the top document. */
  frame: string | null;
  /** Selector of the editable element in its own document. */
  editable: string;
  /** The editor's own model text, blocks joined by "\n". */
  text(): string;
  /** Bold and link runs of the editor's own model. */
  runs(): ReviewEditorRuns;
}

declare global {
  interface Window {
    __testReviewEditor?: TestReviewEditor;
    __testReviewEditorError?: string;
  }
}

export function container(): HTMLElement {
  return document.getElementById("test-review-editor")!;
}

export function publish(editor: TestReviewEditor): void {
  window.__testReviewEditor = editor;
}

export function fail(error: unknown): void {
  window.__testReviewEditorError = error instanceof Error ? error.message : String(error);
}

/** Text and runs of an editable element: the model of an editor that keeps it in the DOM. */
export function domModel(editable: HTMLElement): { text: string; runs: ReviewEditorRuns } {
  const blocks = Array.from(editable.children);
  const text = (blocks.length ? blocks : [editable])
    .map((block) => block.textContent ?? "")
    .join("\n");
  const texts = (selector: string) =>
    Array.from(editable.querySelectorAll(selector), (element) => element.textContent ?? "");
  return { text, runs: { bold: texts("strong, b"), links: texts(`a[href="${LINK}"]`) } };
}

/** Consecutive characters that have a flag, as strings. */
export function flaggedRuns(text: string, flagged: (index: number) => boolean): string[] {
  const runs: string[] = [];
  let run = "";
  for (let index = 0; index < text.length; index += 1) {
    if (flagged(index)) {
      run += text[index];
    } else if (run) {
      runs.push(run);
      run = "";
    }
  }
  if (run) runs.push(run);
  return runs;
}

export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(script);
  });
}

export function loadStylesheet(href: string): void {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}
