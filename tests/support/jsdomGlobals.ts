import type { JSDOM } from "jsdom";

/**
 * Points the DOM globals at dom, and also sets each key of extra.
 * Returns a function that puts back the previous values. It also puts back chrome,
 * because the tests replace chrome after they load a page.
 */
export function installJsdom(dom: JSDOM, extra: Record<string, unknown> = {}): () => void {
  const win = dom.window;
  const values: Record<string, unknown> = {
    window: win,
    document: win.document,
    navigator: win.navigator,
    Node: win.Node,
    HTMLElement: win.HTMLElement,
    HTMLButtonElement: win.HTMLButtonElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    Element: win.Element,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    MutationObserver: win.MutationObserver,
    getComputedStyle: win.getComputedStyle.bind(win),
    ...extra,
  };
  const globals = globalThis as Record<string, unknown>;
  const saved = Object.fromEntries(
    [...Object.keys(values), "chrome"].map((key) => [key, globals[key]]),
  );
  Object.assign(globalThis, values);
  return () => {
    Object.assign(globalThis, saved);
  };
}
