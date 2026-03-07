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

    // Simulate the patch firing from innerHost — composed:true so the event
    // crosses the outer shadow boundary and reaches document.
    innerHost.dispatchEvent(new CustomEvent(INTERCEPT_EVENT, { bubbles: true, composed: true }));

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
});
