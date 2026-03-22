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

const INTERCEPT_EVENT = "ft-shadow-attached";
export const SHADOW_ATTACH_MARKER_ATTR = "data-ft-shadow-attached";

// Idempotency flag stored on window to survive enable→disable→enable cycles
// without double-patching attachShadow.
const INTERCEPT_FLAG = "__ftShadowIntercepted";

const INTERCEPT_SNIPPET = `(function(){
  if(window[${JSON.stringify(INTERCEPT_FLAG)}]) return;
  window[${JSON.stringify(INTERCEPT_FLAG)}] = true;
  var orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    var root = orig.call(this, init);
    if (init && init.mode === 'open') {
      var host = this;
      setTimeout(function() {
        try {
          host.setAttribute(${JSON.stringify(SHADOW_ATTACH_MARKER_ATTR)}, 'true');
          host.dispatchEvent(new CustomEvent(${JSON.stringify(INTERCEPT_EVENT)}, {bubbles:true,composed:true}));
        } catch(e) {}
      }, 0);
    }
    return root;
  };
})();`;

export class ShadowRootInterceptor {
  private readonly handler: EventListener;
  private attached = false;
  private injected = false;

  constructor(
    private readonly onShadowAttached: (root: ShadowRoot) => void,
    private readonly doc: Document = document,
  ) {
    this.handler = this.onEvent.bind(this);
  }

  public attach(): void {
    if (this.attached) {
      return;
    }
    if (!this.injected) {
      this.inject();
      this.injected = true;
    }
    this.doc.addEventListener(INTERCEPT_EVENT, this.handler, true);
    this.attached = true;
  }

  public detach(): void {
    if (!this.attached) {
      return;
    }
    this.doc.removeEventListener(INTERCEPT_EVENT, this.handler, true);
    this.attached = false;
  }

  private inject(): void {
    // The script runs in the page's context (MAIN world), bypassing the
    // extension's isolated-world boundary. It degrades silently on pages with
    // a strict CSP that blocks inline scripts.
    const script = this.doc.createElement("script");
    script.textContent = INTERCEPT_SNIPPET;
    (this.doc.head ?? this.doc.documentElement).appendChild(script);
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
