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

beforeEach(() => {
  resetDom();
  document.execCommand = simulateNativeEdit;
});

afterEach(() => {
  resetDom();
});
