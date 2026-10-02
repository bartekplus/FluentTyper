import { afterEach, expect, jest, test } from "bun:test";
import { ReviewController } from "../src/adapters/chrome/content-script/review/ReviewController";
import { resolveReviewTarget } from "../src/adapters/chrome/content-script/review/ReviewTargets";
import {
  installWordReviewMainWorld,
  type WordDocument,
} from "../src/adapters/chrome/content-script/review/WordReviewMainWorld";
import { WordReviewTarget } from "../src/adapters/chrome/content-script/review/WordReviewTarget";
import {
  WORD_REVIEW_EVENT,
  WORD_REVIEW_RESPONSE,
  type WordReviewReply,
  type WordReviewRequest,
} from "../src/adapters/chrome/content-script/review/WordReviewProtocol";
import { NativeAutocompleteConflictDetector } from "../src/adapters/chrome/content-script/suggestions/NativeAutocompleteConflictDetector";
import { ReviewSession } from "../src/core/application/review/ReviewSession";
import { LocalReviewEngine } from "../src/core/application/review/LocalReviewEngine";
import type { ReviewAiProvider } from "../src/core/application/review/reviewAi";
import { AI_PROMPT_VERSION } from "../src/core/domain/grammar/review/ai/prompts";
import { GRAMMAR_RULE_IDS } from "../src/core/domain/grammar/ruleCatalog";

let cleanup = () => {};
afterEach(() => {
  cleanup();
  cleanup = () => {};
  delete (window as Window & { WordEditor?: unknown }).WordEditor;
});

function fixture(texts = ["We saw teh cat.", "We saw teh cat."], separator = "\r") {
  document.body.innerHTML = `<input aria-label="Document title" value="Do not review me"><div id="EditorContainer"><div id="WACViewPanel">${texts.map(() => `<p class="Paragraph"><b></b></p>`).join("")}<div id="WACViewPanel_EditingElement" contenteditable="true" tabindex="0"></div></div></div>`;
  const empty = { length: () => 0 };
  let writes = 0;
  let rangeReadCharacters = 0;
  let selection: [number, number] = [0, 0];
  let wrongWrite = false;
  let throwingSelection = false;
  let transactionActive = false;
  let commit: (() => void)[] = [];
  let commits = 0;
  const paragraphs = texts.map((value, index) => ({
    text: value,
    uniqueLocalId: `paragraph-${index}`,
    fields: empty,
    contentControls: empty,
    inlinePictures: empty,
    footnotes: empty,
    endnotes: empty,
    parentContentControlOrNullObject: null as { isNullObject?: boolean } | null,
    getNext() {
      return paragraphs[index + 1];
    },
    getRange(location: number) {
      const start = paragraphs
        .slice(0, index)
        .reduce((length, p) => length + p.text.length + separator.length, 0);
      return range(
        location === 1 ? start : start + this.text.length,
        location === 1 ? start : start + this.text.length,
      );
    },
    getSubrange(offset: number, length: number) {
      return {
        get text() {
          return paragraphs[index].text.slice(offset, offset + length);
        },
        isEmpty: length === 0,
        getRange() {
          throw new Error("unused");
        },
        expandTo() {
          throw new Error("unused");
        },
        insertText(replacement: string, location: number) {
          expect(location).toBe(4);
          expect(transactionActive).toBe(true);
          writes++;
          commit.push(() => {
            paragraphs[index].text =
              paragraphs[index].text.slice(0, offset) +
              (wrongWrite ? "wrong" : replacement) +
              paragraphs[index].text.slice(offset + length);
            document.querySelectorAll("p.Paragraph b")[index].textContent = paragraphs[index].text;
          });
          return this;
        },
      };
    },
  }));
  const raw = () => paragraphs.map((p) => p.text).join(separator);
  const range = (start: number, end: number) => ({
    start,
    end,
    get text() {
      const text = raw().slice(start, end);
      rangeReadCharacters += text.length;
      return text;
    },
    isEmpty: start === end,
    getRange(location: number) {
      return range(location === 1 ? start : end, location === 1 ? start : end);
    },
    expandTo(other: { start: number; end: number }) {
      return range(Math.min(start, other.start), Math.max(end, other.end));
    },
    insertText() {
      throw new Error("unused");
    },
  });
  const model: WordDocument = {
    changeTrackingMode: 0,
    body: {
      type: 0,
      get text() {
        return raw();
      },
      paragraphs: { length: () => paragraphs.length, getFirst: () => paragraphs[0] },
      getRange: (location) =>
        range(location === 1 ? 0 : raw().length, location === 1 ? 0 : raw().length),
    },
    getSelection: () => {
      if (throwingSelection) throw new Error("other story");
      return range(...selection);
    },
  };
  (window as Window & { WordEditor?: unknown }).WordEditor = {
    Extension: {
      AutomationUtility: { getDocument: () => model },
      AutomationTransaction: class {
        constructor() {
          expect(transactionActive).toBe(false);
          transactionActive = true;
        }
        dispose() {
          transactionActive = false;
          commit.forEach((write) => write());
          commit = [];
          commits++;
        }
      },
    },
  };
  document.querySelectorAll("p.Paragraph b").forEach((p, i) => {
    p.textContent = texts[i];
  });
  document.getElementById("WACViewPanel_EditingElement")!.focus();
  cleanup = installWordReviewMainWorld();
  const target = new WordReviewTarget(
    document.getElementById("WACViewPanel")!,
    document.getElementById("WACViewPanel_EditingElement")!,
  );
  return {
    model,
    paragraphs,
    target,
    get rangeReadCharacters() {
      return rangeReadCharacters;
    },
    get writes() {
      return writes;
    },
    get commits() {
      return commits;
    },
    setSelection: (start: number, end: number) => {
      selection = [start, end];
    },
    wrongWrite: () => {
      wrongWrite = true;
    },
    otherStory: () => {
      throwingSelection = true;
    },
  };
}

function bridge(request: WordReviewRequest): WordReviewReply {
  const root = document.getElementById("WACViewPanel")!;
  root.dispatchEvent(
    new CustomEvent(WORD_REVIEW_EVENT, { bubbles: true, detail: JSON.stringify(request) }),
  );
  const reply = JSON.parse(root.getAttribute(WORD_REVIEW_RESPONSE)!) as WordReviewReply;
  root.removeAttribute(WORD_REVIEW_RESPONSE);
  return reply;
}

test("Word Review reads the model, applies the exact duplicate occurrence and preserves formatting", async () => {
  const h = fixture();
  const before = h.target.read();
  expect(before.ok && before.text).toBe("We saw teh cat.\nWe saw teh cat.");
  if (!before.ok) throw new Error("read failed");
  const start = h.paragraphs[0].text.length + 1 + 7;
  const edit = { start, end: start + 3, original: "teh", replacement: "the" };
  const after = before.text.slice(0, start) + "the" + before.text.slice(start + 3);
  expect(
    await h.target.apply({
      edits: [edit],
      before: before.text,
      after,
      signature: before.signature,
    }),
  ).toEqual({ status: "applied" });
  expect(h.paragraphs.map((p) => p.text)).toEqual(["We saw teh cat.", "We saw the cat."]);
  expect(document.querySelectorAll("p b")).toHaveLength(2);
  expect(h.writes).toBe(1);
  expect(h.commits).toBe(1);
  expect(h.target.element.hasAttribute(WORD_REVIEW_RESPONSE)).toBe(false);
});

test("Word Review distinguishes null-object parents from protected content controls", async () => {
  const h = fixture(["teh"]);
  h.paragraphs[0].parentContentControlOrNullObject = { isNullObject: true };
  const before = h.target.read();
  if (!before.ok) throw new Error("read failed");
  expect(before.protectedRanges).toEqual([]);
  expect(
    await h.target.apply({
      before: before.text,
      after: "the",
      signature: before.signature,
      edits: [{ start: 0, end: 3, original: "teh", replacement: "the" }],
    }),
  ).toEqual({ status: "applied" });
  for (const parent of [{ isNullObject: false }, {}]) {
    h.paragraphs[0].parentContentControlOrNullObject = parent;
    const protectedRead = h.target.read();
    if (!protectedRead.ok) throw new Error("read failed");
    expect(protectedRead.protectedRanges).toContainEqual({ start: 0, end: 3, reason: "structure" });
    expect(
      await h.target.apply({
        before: protectedRead.text,
        after: "teh",
        signature: protectedRead.signature,
        edits: [{ start: 0, end: 3, original: "the", replacement: "teh" }],
      }),
    ).toEqual({ status: "rejected", reason: "unsupported" });
  }
  expect(h.writes).toBe(1);
});

test("Word paragraph offsets read linear native ranges and retain gap and ordering checks", () => {
  const h = fixture(
    Array.from({ length: 500 }, (_, i) => (i % 3 ? "😀 teh duplicate" : "")),
    "\r\u0007",
  );
  const before = h.target.read();
  if (!before.ok) throw new Error("read failed");
  expect(before.text).toBe(h.model.body.text.replace(/\r/g, "\n"));
  expect(h.rangeReadCharacters).toBeLessThanOrEqual(h.model.body.text.length);
  expect(before.protectedRanges).toContainEqual({ start: 0, end: 2, reason: "structure" });
  expect(before.protectedRanges).toContainEqual({ start: 18, end: 20, reason: "structure" });
  h.paragraphs[499].getRange = () => h.paragraphs[498].getRange(1);
  expect(h.target.read()).toEqual({ ok: false, reason: "unsupported" });
  expect(h.writes).toBe(0);
});

test("Word Review commits deletion-only fixes through the native transaction", async () => {
  const h = fixture(["Test.."]);
  const before = h.target.read();
  if (!before.ok) throw new Error("read failed");
  expect(
    await h.target.apply({
      edits: [{ start: 5, end: 6, original: ".", replacement: "" }],
      before: before.text,
      after: "Test.",
      signature: before.signature,
    }),
  ).toEqual({ status: "applied" });
  expect(h.paragraphs[0].text).toBe("Test.");
  expect(h.commits).toBe(1);
});

test("Word Review refuses stale text, changed protection and replayed tokens", () => {
  const h = fixture(["teh"]);
  for (const drift of ["text", "protection", "id", "tracking"] as const) {
    h.paragraphs[0].text = "teh";
    h.paragraphs[0].fields = { length: () => 0 };
    h.model.changeTrackingMode = 0;
    const read = bridge({ action: "read", selection: false });
    if (!("ok" in read) || !read.ok) throw new Error("read failed");
    const request: WordReviewRequest = {
      action: "apply",
      token: read.token,
      before: read.text,
      after: "the",
      signature: read.signature,
      edits: [{ start: 0, end: 3, original: "teh", replacement: "the" }],
    };
    if (drift === "text") h.paragraphs[0].text = "new";
    if (drift === "protection") h.paragraphs[0].fields = { length: () => 1 };
    if (drift === "id") h.paragraphs[0].uniqueLocalId += "changed";
    if (drift === "tracking") h.model.changeTrackingMode = 1;
    expect(bridge(request)).toEqual({ status: "stale" });
    expect(bridge(request)).toEqual({ status: "stale" });
  }
  expect(h.writes).toBe(0);
});

test("Word Review refuses protected, cross-paragraph, malformed and split-grapheme edits", () => {
  const h = fixture(["teh", "😀 teh"]);
  for (const [start, end, replacement] of [
    [2, 5, "x"],
    [4, 5, "x"],
    [0, 3, "new\nparagraph"],
    [-1, 3, "x"],
  ] as const) {
    const read = bridge({ action: "read", selection: false });
    if (!("ok" in read) || !read.ok) throw new Error("read failed");
    expect(
      bridge({
        action: "apply",
        token: read.token,
        before: read.text,
        after: read.text.slice(0, start) + replacement + read.text.slice(end),
        signature: read.signature,
        edits: [{ start, end, original: read.text.slice(start, end), replacement }],
      }),
    ).toEqual({ status: "rejected", reason: "unsupported" });
  }
  h.paragraphs[0].contentControls = { length: () => 1 };
  const read = h.target.read();
  expect(read.ok && read.protectedRanges).toContainEqual({ start: 0, end: 3, reason: "structure" });
  if (!read.ok) throw new Error("read failed");
  const protectedSnapshot = bridge({ action: "read", selection: false });
  if (!("ok" in protectedSnapshot) || !protectedSnapshot.ok) throw new Error("read failed");
  expect(
    bridge({
      action: "apply",
      token: protectedSnapshot.token,
      before: protectedSnapshot.text,
      after: "the\n😀 teh",
      signature: protectedSnapshot.signature,
      edits: [{ start: 0, end: 3, original: "teh", replacement: "the" }],
    }),
  ).toEqual({ status: "rejected", reason: "unsupported" });
  expect(h.writes).toBe(0);
});

test("Word Review maps model selection offsets and never widens an unsupported selection", () => {
  const h = fixture();
  h.setSelection(22, 25);
  h.target.read(true);
  expect(h.target.scope).toEqual({ start: 22, end: 25 });
  h.otherStory();
  const other = new WordReviewTarget(h.target.element, h.target.inputProxy);
  expect(other.read(true)).toEqual({ ok: false, reason: "unsupported" });
  expect(other.read()).toEqual({ ok: false, reason: "unsupported" });
  expect(h.writes).toBe(0);
});

test("Word Review reads and fixes the active body without touching the main body", async () => {
  const h = fixture(["teh"]);
  const activeBody = h.model.body;
  const selection = h.model.getSelection.bind(h.model);
  h.model.getSelection = () => ({ ...selection(), parentBody: activeBody });
  h.model.body = { ...activeBody, text: "Main body stays unchanged." };
  h.setSelection(0, 3);
  const before = h.target.read(true);
  if (!before.ok) throw new Error("read failed");
  expect(before.text).toBe("teh");
  expect(h.target.scope).toEqual({ start: 0, end: 3 });
  expect(
    await h.target.apply({
      before: before.text,
      after: "the",
      signature: before.signature,
      edits: [{ start: 0, end: 3, original: "teh", replacement: "the" }],
    }),
  ).toEqual({ status: "applied" });
  expect(activeBody.text).toBe("the");
  expect(h.model.body.text).toBe("Main body stays unchanged.");
  expect(h.commits).toBe(1);
});

test("Word Review rejects composing and detached editors and never retries an unverified write", async () => {
  const h = fixture(["teh"]);
  const before = h.target.read();
  if (!before.ok) throw new Error("read failed");
  const request = {
    edits: [{ start: 0, end: 3, original: "teh", replacement: "the" }],
    before: before.text,
    after: "the",
    signature: before.signature,
  };
  const input = document.getElementById("WACViewPanel_EditingElement")!;
  input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
  expect(h.target.read()).toEqual({ ok: false, reason: "composing" });
  input.dispatchEvent(new Event("compositionend", { bubbles: true }));
  h.target.read();
  h.wrongWrite();
  expect(await h.target.apply(request)).toEqual({ status: "unverified" });
  expect(await h.target.apply(request)).toEqual({ status: "rejected", reason: "unsupported" });
  expect(h.writes).toBe(1);
  h.target.element.remove();
  expect(h.target.read()).toEqual({ ok: false, reason: "detached" });
});

test("Word Review runs native proofreading while its input proxy stays unmanaged", async () => {
  const h = fixture(["We saw teh cat."]);
  expect(
    new NativeAutocompleteConflictDetector().classify(
      document.getElementById("WACViewPanel_EditingElement")!,
    ),
  ).toEqual({ kind: "blocked" });
  const session = new ReviewSession({
    target: h.target,
    engine: new LocalReviewEngine(),
    options: {
      lang: "en_US",
      enabledRules: ["englishTypoWhitelistCorrection"],
      userDictionary: [],
    },
    onChange: () => {},
  });
  await session.start();
  expect(session.getState().diagnostics.some((d) => d.range.start === 7)).toBe(true);
  session.close();
  h.target.dispose();
  expect(h.writes).toBe(0);
});

test("Word Review resolves the document instead of its empty input proxy", () => {
  document.body.innerHTML = `<div id="EditorContainer"><div id="WACViewPanel"><p class="Paragraph">We saw teh cat.</p><div id="WACViewPanel_EditingElement" contenteditable="true" tabindex="0"></div></div></div>`;
  document.getElementById("WACViewPanel_EditingElement")!.focus();
  const result = resolveReviewTarget(document);
  expect(result.ok && result.target.kind).toBe("model-editor");
  expect(result.ok && result.target.element.id).toBe("WACViewPanel");
  if (result.ok) result.target.dispose();
});

test("Word repeated resolution preserves the active target and its single-use correction token", async () => {
  const h = fixture(["teh"]);
  const before = h.target.read();
  if (!before.ok) throw new Error("read failed");
  const again = resolveReviewTarget(document, h.target);
  try {
    expect(again.ok && again.target).toBe(h.target);
    expect(
      await h.target.apply({
        before: before.text,
        after: "the",
        signature: before.signature,
        edits: [{ start: 0, end: 3, original: "teh", replacement: "the" }],
      }),
    ).toEqual({ status: "applied" });
  } finally {
    if (again.ok && again.target !== h.target) again.target.dispose();
    h.target.dispose();
  }
});

test("Word repeated controller invocation reuses the active target without another model read", () => {
  const h = fixture(["teh"]);
  h.target.dispose();
  const read = jest.spyOn(WordReviewTarget.prototype, "read");
  const review = new ReviewController({
    createEngine: () => new LocalReviewEngine(),
    getOptions: () => ({ lang: "en_US", enabledRules: GRAMMAR_RULE_IDS, userDictionary: [] }),
    suspend: () => {},
    resume: () => {},
    addToDictionary: async () => true,
    getDocsSurface: () => null,
    uiLanguage: "en",
  });
  try {
    review.invoke();
    const reads = read.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    document.getElementById("WACViewPanel_EditingElement")!.focus();
    review.invoke();
    expect(read.mock.calls.length).toBe(reads);
    expect(review.reviewedElement).toBe(h.target.element);
    expect(document.querySelectorAll("[data-fluenttyper-review]")).toHaveLength(1);
  } finally {
    review.close();
    read.mockRestore();
  }
});

test("Word Review only resolves recognized editor proxies", () => {
  const h = fixture(["teh"]);
  const reads = jest.spyOn(WordReviewTarget.prototype, "read");
  try {
    for (const id of [
      "WACViewPanel_ClipboardElement",
      "WACViewPanel_FootnoteEndnoteEditControl_EditingElement",
    ]) {
      const proxy = document.createElement("textarea");
      proxy.id = id;
      h.target.element.append(proxy);
      proxy.focus();
      const result = resolveReviewTarget(document);
      expect(result.ok && result.target.kind).toBe("model-editor");
      if (result.ok) result.target.dispose();
    }
    const control = document.createElement("button");
    h.target.element.append(control);
    control.focus();
    reads.mockClear();
    expect(resolveReviewTarget(document, h.target)).toEqual({ ok: false, reason: "no-editor" });
    expect(reads.mock.calls).toHaveLength(0);
  } finally {
    h.target.dispose();
    reads.mockRestore();
  }
});

test("Word caret layout mutations do not read the document model", async () => {
  const h = fixture(["teh"]);
  h.target.dispose();
  const review = new ReviewController({
    createEngine: () => new LocalReviewEngine(),
    getOptions: () => ({ lang: "en_US", enabledRules: GRAMMAR_RULE_IDS, userDictionary: [] }),
    suspend: () => {},
    resume: () => {},
    addToDictionary: async () => true,
    getDocsSurface: () => null,
    uiLanguage: "en",
  });
  const read = jest.spyOn(WordReviewTarget.prototype, "read");
  try {
    review.invoke();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reads = read.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      h.target.element.classList.toggle("caret-blink");
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(read.mock.calls.length).toBe(reads);
    expect(review.reviewedElement).toBe(h.target.element);
  } finally {
    review.close();
    read.mockRestore();
  }
});

test("Word Review restores the originating footnote proxy on close and after switching stories", () => {
  const h = fixture(["teh"]);
  h.target.dispose();
  const footnote = document.createElement("textarea");
  footnote.id = "WACViewPanel_FootnoteEndnoteEditControl_EditingElement";
  h.target.element.append(footnote);
  const review = new ReviewController({
    createEngine: () => new LocalReviewEngine(),
    getOptions: () => ({ lang: "en_US", enabledRules: GRAMMAR_RULE_IDS, userDictionary: [] }),
    suspend: () => {},
    resume: () => {},
    addToDictionary: async () => true,
    getDocsSurface: () => null,
    uiLanguage: "en",
  });
  try {
    footnote.focus();
    review.invoke();
    expect(document.activeElement).not.toBe(footnote);
    review.close();
    expect(document.activeElement).toBe(footnote);
    const main = document.getElementById("WACViewPanel_EditingElement")!;
    main.focus();
    review.invoke();
    footnote.focus();
    review.invoke();
    review.close();
    expect(document.activeElement).toBe(footnote);
    footnote.focus();
    review.invoke();
    footnote.remove();
    review.close();
    expect(document.activeElement).not.toBe(main);
  } finally {
    review.close();
  }
});

test("Word Fix all commits multiple offsets and paragraphs in one native transaction", async () => {
  const h = fixture(["teh teh", "teh"]);
  const before = h.target.read();
  if (!before.ok) throw new Error("read failed");
  const edits = [
    { start: 0, end: 3, original: "teh", replacement: "the" },
    { start: 4, end: 7, original: "teh", replacement: "a much longer word" },
    { start: 8, end: 11, original: "teh", replacement: "" },
  ];
  expect(
    await h.target.apply({
      before: before.text,
      after: "the a much longer word\n",
      signature: before.signature,
      edits,
    }),
  ).toEqual({ status: "applied" });
  expect(h.paragraphs.map((p) => p.text)).toEqual(["the a much longer word", ""]);
  expect(h.writes).toBe(3);
  expect(h.commits).toBe(1);
});

test("Word batch validation rejects the whole batch before any write", async () => {
  const h = fixture(["teh teh"]);
  for (const edits of [
    [
      { start: 0, end: 3, original: "teh", replacement: "the" },
      { start: 4, end: 7, original: "bad", replacement: "the" },
    ],
    [
      { start: 0, end: 3, original: "teh", replacement: "the" },
      { start: 2, end: 5, original: "h t", replacement: "x" },
    ],
  ]) {
    const before = h.target.read();
    if (!before.ok) throw new Error("read failed");
    expect(
      await h.target.apply({
        before: before.text,
        after: "the the",
        signature: before.signature,
        edits,
      }),
    ).toEqual({ status: "rejected", reason: "unsupported" });
  }
  expect(h.writes).toBe(0);
});

test("Word highlights map duplicate paragraphs, formatting and synthetic tabs without editor writes", () => {
  const h = fixture(["teh\tteh", "teh\tteh"]);
  for (const p of document.querySelectorAll(".Paragraph")) {
    p.innerHTML =
      '<b><span class="TextRun">teh</span></b><span class="TabRun"><span class="TabChar"> </span></span><i class="TextRun">teh</i><span class="EOP">&nbsp;</span>';
  }
  h.target.read();
  expect(h.target.domRange({ start: 12, end: 15 })?.toString()).toBe("teh");
  expect(h.target.domRange({ start: 12, end: 15 })?.startContainer.parentElement?.tagName).toBe(
    "I",
  );
  expect(h.target.domRange({ start: 8, end: 11 })?.startContainer.parentElement?.closest("p")).toBe(
    document.querySelectorAll("p")[1],
  );
  expect(h.target.domRange({ start: 7, end: 9 })).toBeNull(); // Paragraph separator.
  document.querySelectorAll(".Paragraph")[0].remove();
  expect(h.target.domRange({ start: 8, end: 11 })).toBeNull(); // Never guess an identical offscreen occurrence.
  expect(h.writes).toBe(0);
});

test("Word highlights exclude inactive header and footer previews, even with identical text", () => {
  const h = fixture(["teh", "teh"]);
  h.target.element.insertAdjacentHTML(
    "afterbegin",
    '<div class="Header InactiveBoxRendering"><p class="Paragraph">teh</p></div>',
  );
  h.target.element.insertAdjacentHTML(
    "beforeend",
    '<div class="Footer InactiveBoxRendering"><p class="Paragraph">teh</p></div>',
  );
  h.target.read();
  expect(h.target.domRange({ start: 4, end: 7 })?.startContainer.parentElement?.closest("p")).toBe(
    document.querySelectorAll("p")[2],
  );
  expect(h.writes).toBe(0);
});

test("Word applies accepted Local AI rewrite hunks in one native transaction", async () => {
  const h = fixture(["We saw teh cat. She go home now."]);
  const ai: ReviewAiProvider = {
    status: async () => ({
      enabled: true,
      consented: true,
      tier: "standard",
      modelId: "model-a",
      displayName: "Standard",
      downloadBytes: 1,
      install: "complete",
      runtime: "ready",
      offerSetup: false,
    }),
    onStatus: () => () => {},
    generate: async (request) => ({
      outcome: {
        ok: true,
        segments: request.segments.map(({ id, text }) => ({
          id,
          text: text.replace("teh", "the").replace("She go ", "She goes "),
        })),
      },
      modelId: "model-a",
      promptVersion: AI_PROMPT_VERSION,
    }),
    openSetup: () => {},
    dismissSetupOffer: () => {},
    dispose: () => {},
  };
  let ready = () => {};
  let rewritten = () => {};
  const available = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const preview = new Promise<void>((resolve) => {
    rewritten = resolve;
  });
  const session = new ReviewSession({
    target: h.target,
    engine: new LocalReviewEngine(),
    options: { lang: "en_US", enabledRules: [], userDictionary: [] },
    ai,
    onChange: (state) => {
      if (state.ai.availability === "ready") ready();
      if (state.rewrite?.status === "ready") rewritten();
    },
  });
  try {
    await session.start();
    await available;
    session.setMode("rewrite");
    session.setRewriteStyle("keep-voice");
    session.generateRewrite();
    await preview;
    expect(session.getState().rewrite?.canApply).toBe(true);
    expect(h.writes).toBe(0);
    expect(await session.applyRewrite()).toEqual({ status: "applied" });
    expect(h.paragraphs[0].text).toBe("We saw the cat. She goes home now.");
    expect(h.writes).toBeGreaterThan(1);
    expect(h.commits).toBe(1);
  } finally {
    session.close();
    h.target.dispose();
  }
});
