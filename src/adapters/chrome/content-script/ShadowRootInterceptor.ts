/**
 * Intercepts Element.prototype.attachShadow in the page's MAIN world and
 * notifies a callback whenever an open shadow root is created — including on
 * host elements that are already in the DOM when attachShadow() is called.
 *
 * The interception is implemented by injecting a tiny <script> tag that runs
 * in the page's JavaScript context (which the extension's isolated world
 * cannot patch directly). The patch both dispatches a CustomEvent and toggles
 * a data attribute on the host so the content script can recover via its
 * existing MutationObserver pipeline even when cross-world CustomEvent delivery
 * is unreliable.
 *
 * The notification (setAttribute + dispatchEvent) is deferred via setTimeout(0)
 * to avoid breaking custom element constructors — Firefox enforces the spec
 * requirement that constructors must not add attributes, and a synchronous
 * setAttribute inside a patched attachShadow kills the entire constructor.
 *
 * Closed shadow roots are intentionally left unhandled.
 */

const DETACH_EVENT = "ft-shadow-detach";
const INTERCEPT_EVENT = "ft-shadow-attached";
export const SHADOW_ATTACH_MARKER_ATTR = "data-ft-shadow-attached";

// Idempotency flag stored on window to survive enable→disable→enable cycles
// without double-patching attachShadow.
const INTERCEPT_FLAG = "__ftShadowIntercepted";

const INTERCEPT_SNIPPET = `(function(){
  var existing = window[${JSON.stringify(INTERCEPT_FLAG)}];
  if(existing) { existing.active = true; return; }
  var state = { active: true };
  window[${JSON.stringify(INTERCEPT_FLAG)}] = state;
  var orig = Element.prototype.attachShadow;
  var wrapper = function(init) {
    var root = orig.call(this, init);
    if (state.active && init && init.mode === 'open') {
      var host = this;
      setTimeout(function() {
        if (!state.active) return;
        try {
          host.setAttribute(${JSON.stringify(SHADOW_ATTACH_MARKER_ATTR)}, 'true');
          host.dispatchEvent(new CustomEvent(${JSON.stringify(INTERCEPT_EVENT)}, {bubbles:true,composed:true}));
        } catch(e) {}
      }, 0);
    }
    return root;
  };
  state.original = orig;
  state.wrapper = wrapper;
  Element.prototype.attachShadow = wrapper;
  var detach = function() {
    state.active = false;
    if (Element.prototype.attachShadow === wrapper) {
      Element.prototype.attachShadow = orig;
      delete window[${JSON.stringify(INTERCEPT_FLAG)}];
      document.removeEventListener(${JSON.stringify(DETACH_EVENT)}, detach);
    }
  };
  document.addEventListener(${JSON.stringify(DETACH_EVENT)}, detach);
})();`;

export class ShadowRootInterceptor {
  private readonly handler: EventListener = this.onEvent.bind(this);
  private attached = false;

  constructor(private readonly onShadowAttached: (root: ShadowRoot) => void) {}

  public attach(): void {
    if (this.attached) {
      return;
    }
    this.inject(INTERCEPT_SNIPPET);
    document.addEventListener(INTERCEPT_EVENT, this.handler, true);
    this.attached = true;
  }

  public detach(): void {
    if (!this.attached) {
      return;
    }
    document.removeEventListener(INTERCEPT_EVENT, this.handler, true);
    this.attached = false;
    // Cleanup uses the listener installed with the successful patch. A page
    // can tighten CSP afterwards; disabling must not require a new script.
    document.dispatchEvent(new Event(DETACH_EVENT));
    document
      .querySelectorAll(`[${SHADOW_ATTACH_MARKER_ATTR}]`)
      .forEach((node) => node.removeAttribute(SHADOW_ATTACH_MARKER_ATTR));
  }

  private inject(source: string): void {
    // The script runs in the page's context (MAIN world), bypassing the
    // extension's isolated-world boundary. It degrades silently on pages with
    // a strict CSP that blocks inline scripts.
    const script = document.createElement("script");
    script.textContent = source;
    (document.head ?? document.documentElement).appendChild(script);
    script.remove();
  }

  private onEvent(event: Event): void {
    // For composed events crossing a shadow boundary, `event.target` is retargeted
    // to the nearest visible host. The first composedPath() entry remains the
    // original host that called attachShadow(), which is the root we need.
    const source = event.composedPath()[0];
    if (!(source instanceof Element)) {
      return;
    }
    const { shadowRoot } = source;
    if (!shadowRoot) {
      return;
    }
    this.onShadowAttached(shadowRoot);
  }
}
