import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
  test,
} from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
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

const jestCompat = jest as typeof jest & {
  unstable_mockModule?: (moduleId: string, factory: () => unknown) => unknown;
  resetModules?: () => void;
};

if (!jestCompat.unstable_mockModule) {
  jestCompat.unstable_mockModule = (moduleId: string, factory: () => unknown) =>
    mock.module(moduleId, factory);
}

if (!jestCompat.resetModules) {
  // Bun has no direct equivalent to Jest's full module reset.
  // Restoring module mocks keeps tests isolated enough for this suite.
  jestCompat.resetModules = () => {
    mock.restore();
  };
}
