/**
 * Intercepts Element.prototype.attachShadow in the page's MAIN world and
 * notifies a callback whenever an open shadow root is created — including on
 * host elements that are already in the DOM when attachShadow() is called.
 *
 * The interception is implemented by injecting a tiny <script> tag that runs
 * in the page's JavaScript context (which the extension's isolated world
 * cannot patch directly). A CustomEvent is dispatched on the host element when
 * an open shadow root is created; the content script's document listener picks
 * it up and forwards the shadow root to the caller.
 *
 * Closed shadow roots are intentionally left unhandled.
 */

const INTERCEPT_EVENT = "ft-shadow-attached";

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
      this.dispatchEvent(new CustomEvent(${JSON.stringify(INTERCEPT_EVENT)}, {bubbles:true}));
    }
    return root;
  };
})();`;

export class ShadowRootInterceptor {
  private readonly onShadowAttached: (root: ShadowRoot) => void;
  private readonly doc: Document;
  private readonly handler: EventListener;
  private attached = false;
  private injected = false;

  constructor(onShadowAttached: (root: ShadowRoot) => void, doc: Document = document) {
    this.onShadowAttached = onShadowAttached;
    this.doc = doc;
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
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const { shadowRoot } = target;
    if (!shadowRoot) {
      return;
    }
    this.onShadowAttached(shadowRoot);
  }
}
