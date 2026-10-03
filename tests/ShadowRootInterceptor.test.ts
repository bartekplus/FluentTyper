import { JSDOM } from "jsdom";
import { describe, test, expect, jest, beforeEach, afterEach } from "bun:test";
import { ShadowRootInterceptor } from "../src/adapters/chrome/content-script/ShadowRootInterceptor";

// jsdom does not execute inline <script> content, so the MAIN-world patch
// cannot be tested in unit tests. We test the event-listener logic directly by
// manually dispatching the custom event that the injected snippet would fire.
const INTERCEPT_EVENT = "ft-shadow-attached";

describe("ShadowRootInterceptor", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    host.attachShadow({ mode: "open" });
  });

  afterEach(() => {
    host.remove();
  });

  test("calls onShadowAttached with the shadow root when the intercept event fires", () => {
    const onShadowAttached = jest.fn();
    const interceptor = new ShadowRootInterceptor(onShadowAttached);
    interceptor.attach();

    host.dispatchEvent(new CustomEvent(INTERCEPT_EVENT, { bubbles: true }));

    expect(onShadowAttached).toHaveBeenCalledTimes(1);
    expect(onShadowAttached).toHaveBeenCalledWith(host.shadowRoot);

    interceptor.detach();
  });

  test("does not call onShadowAttached after detach()", () => {
    const onShadowAttached = jest.fn();
    const interceptor = new ShadowRootInterceptor(onShadowAttached);
    interceptor.attach();
    interceptor.detach();

    host.dispatchEvent(new CustomEvent(INTERCEPT_EVENT, { bubbles: true }));

    expect(onShadowAttached).not.toHaveBeenCalled();
  });

  test("resumes listening after re-attach()", () => {
    const onShadowAttached = jest.fn();
    const interceptor = new ShadowRootInterceptor(onShadowAttached);
    interceptor.attach();
    interceptor.detach();
    interceptor.attach();

    host.dispatchEvent(new CustomEvent(INTERCEPT_EVENT, { bubbles: true }));

    expect(onShadowAttached).toHaveBeenCalledTimes(1);
    interceptor.detach();
  });

  test("ignores the event when the host has no shadow root", () => {
    const bare = document.createElement("div");
    document.body.appendChild(bare);

    const onShadowAttached = jest.fn();
    const interceptor = new ShadowRootInterceptor(onShadowAttached);
    interceptor.attach();

    bare.dispatchEvent(new CustomEvent(INTERCEPT_EVENT, { bubbles: true }));

    expect(onShadowAttached).not.toHaveBeenCalled();
    bare.remove();
    interceptor.detach();
  });

  test("multiple attach() calls are idempotent — callback fires exactly once per event", () => {
    const onShadowAttached = jest.fn();
    const interceptor = new ShadowRootInterceptor(onShadowAttached);
    interceptor.attach();
    interceptor.attach(); // second call is a no-op

    host.dispatchEvent(new CustomEvent(INTERCEPT_EVENT, { bubbles: true }));

    expect(onShadowAttached).toHaveBeenCalledTimes(1);
    interceptor.detach();
  });

  // Regression: without composed:true the event stops at the shadow root and
  // never reaches the document listener, so a host inside an existing shadow
  // tree would be silently missed.
  test("fires callback when the host is itself inside an existing shadow root (composed:true)", () => {
    // Create an outer shadow root already in the document.
    const outerHost = document.createElement("div");
    document.body.appendChild(outerHost);
    const outerShadow = outerHost.attachShadow({ mode: "open" });

    // The inner host lives inside the outer shadow root.
    const innerHost = document.createElement("div");
    outerShadow.appendChild(innerHost);
    innerHost.attachShadow({ mode: "open" });

    const onShadowAttached = jest.fn();
    const interceptor = new ShadowRootInterceptor(onShadowAttached);
    interceptor.attach();

    // Simulate browser retargeting by forcing composedPath()[0] to stay on the
    // original dispatcher while the event bubbles out to document.
    const event = new CustomEvent(INTERCEPT_EVENT, { bubbles: true, composed: true });
    Object.defineProperty(event, "composedPath", {
      value: () =>
        [
          innerHost,
          outerShadow,
          outerHost,
          document.body,
          document.documentElement,
          document,
        ].filter(Boolean),
    });
    innerHost.dispatchEvent(event);

    expect(onShadowAttached).toHaveBeenCalledWith(innerHost.shadowRoot);

    interceptor.detach();
    outerHost.remove();
  });

  test("does NOT fire callback when event is not composed (stops at shadow boundary)", () => {
    const outerHost = document.createElement("div");
    document.body.appendChild(outerHost);
    const outerShadow = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    outerShadow.appendChild(innerHost);
    innerHost.attachShadow({ mode: "open" });

    const onShadowAttached = jest.fn();
    const interceptor = new ShadowRootInterceptor(onShadowAttached);
    interceptor.attach();

    // Without composed:true the event is blocked at the outer shadow boundary.
    innerHost.dispatchEvent(new CustomEvent(INTERCEPT_EVENT, { bubbles: true, composed: false }));

    expect(onShadowAttached).not.toHaveBeenCalled();

    interceptor.detach();
    outerHost.remove();
  });

  test("uses the original dispatcher from composedPath instead of the retargeted event.target", () => {
    const outerHost = document.createElement("div");
    document.body.appendChild(outerHost);
    const outerShadow = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    outerShadow.appendChild(innerHost);
    innerHost.attachShadow({ mode: "open" });

    const onShadowAttached = jest.fn();
    const interceptor = new ShadowRootInterceptor(onShadowAttached);
    interceptor.attach();

    const event = new CustomEvent(INTERCEPT_EVENT, { bubbles: true, composed: true });
    Object.defineProperty(event, "composedPath", {
      value: () =>
        [
          innerHost,
          outerShadow,
          outerHost,
          document.body,
          document.documentElement,
          document,
        ].filter(Boolean),
    });
    Object.defineProperty(event, "target", { value: outerHost });

    document.dispatchEvent(event);

    expect(onShadowAttached).toHaveBeenCalledTimes(1);
    expect(onShadowAttached.mock.calls[0]?.[0]).toBe(innerHost.shadowRoot);

    interceptor.detach();
    outerHost.remove();
  });
});

test("FT-INV-3 disabling restores the MAIN-world shadow hook and cancels queued mutations", () => {
  // A separate page prevents other suites' retained document listeners from
  // treating this test's patch notifications as real extension lifecycle work.
  const originalGlobals = { document, window, Element, Event, CustomEvent };
  const page = new JSDOM("<html><head></head><body></body></html>");
  Object.assign(globalThis, {
    document: page.window.document,
    window: page.window,
    Element: page.window.Element,
    Event: page.window.Event,
    CustomEvent: page.window.CustomEvent,
  });
  // Execute the actual injected source; jsdom normally leaves script tags inert.
  const append = document.head.appendChild.bind(document.head);
  const queued: (() => void)[] = [];
  let allowInline = true;
  const injection = jest.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (allowInline && node instanceof page.window.HTMLElement && node.tagName === "SCRIPT")
      new Function(
        "window",
        "Element",
        "CustomEvent",
        "setTimeout",
        "document",
        node.textContent ?? "",
      )(window, Element, CustomEvent, (callback: () => void) => queued.push(callback), document);
    return append(node);
  });
  const native = Element.prototype.attachShadow;
  const interceptor = new ShadowRootInterceptor(() => undefined);
  try {
    interceptor.attach();
    expect(Element.prototype.attachShadow).not.toBe(native);
    const host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({ mode: "open" });
    allowInline = false; // CSP tightens after the original successful injection.
    interceptor.detach();
    queued.splice(0).forEach((callback) => callback());
    expect(Element.prototype.attachShadow).toBe(native);
    expect(host.hasAttribute("data-ft-shadow-attached")).toBe(false);
    allowInline = true;
    interceptor.attach();
    const next = document.createElement("div");
    document.body.append(next);
    next.attachShadow({ mode: "open" });
    queued.splice(0).forEach((callback) => callback());
    expect(next.hasAttribute("data-ft-shadow-attached")).toBe(true);
    interceptor.detach();
    expect(next.hasAttribute("data-ft-shadow-attached")).toBe(false);
  } finally {
    interceptor.detach();
    injection.mockRestore();
    Object.assign(globalThis, originalGlobals);
    page.window.close();
  }
});
