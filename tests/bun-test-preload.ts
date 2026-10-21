import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  test,
} from "bun:test";
import { JSDOM } from "jsdom";
import { simulateNativeEdit } from "./nativeEditingTestUtils";
import { restoreReviewDay } from "./reviewTestClock";

// A test run without bun run test (an IDE, one file) compiles the rule files here: the test files
// import the generated modules. Once per process: the hash check reads all the inputs.
if (!process.env.FT_GRAMMAR_COMPILED) {
  const compile = Bun.spawnSync([process.execPath, "scripts/compile-grammar-rules.ts"], {
    cwd: `${import.meta.dir}/..`,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (compile.exitCode !== 0) throw new Error("bun run compile:grammar failed");
  process.env.FT_GRAMMAR_COMPILED = "1";
}
const { loadAllReviewData } =
  await import("../src/core/domain/grammar/review/reviewLanguageSources");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  location: dom.window.location,
  history: dom.window.history,
  localStorage: dom.window.localStorage,
  Node: dom.window.Node,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Event: dom.window.Event,
  InputEvent: dom.window.InputEvent,
  StaticRange: dom.window.StaticRange,
  NodeFilter: dom.window.NodeFilter,
  Option: dom.window.Option,
  CustomEvent: dom.window.CustomEvent,
  DOMRect: dom.window.DOMRect,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

Object.assign(globalThis, {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  test,
});

const resetDom = (): void => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  for (const element of [document.documentElement, document.body]) {
    for (const attribute of [...element.attributes]) {
      element.removeAttribute(attribute.name);
    }
  }
  delete (document.body as { isContentEditable?: boolean }).isContentEditable;
  document.designMode = "off";
  window.getSelection()?.removeAllRanges();
};

// Review's date checks read today's date. A fixed day keeps every suite stable.
restoreReviewDay();
// background.js loads each language's generated Review data on first use; tests load it all now.
loadAllReviewData();

beforeEach(() => {
  resetDom();
  document.execCommand = simulateNativeEdit;
});

afterEach(() => {
  resetDom();
});
