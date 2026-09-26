/**
 * jsdom has no DOMRect; the browser's is what the review geometry returns.
 * Installs a minimal one when missing; the returned function removes it again.
 */
export function installDomRect(): () => void {
  if (typeof globalThis.DOMRect === "function") return () => {};
  globalThis.DOMRect = class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
    get left() {
      return this.x;
    }
    get top() {
      return this.y;
    }
    get right() {
      return this.x + this.width;
    }
    get bottom() {
      return this.y + this.height;
    }
  } as unknown as typeof DOMRect;
  return () => {
    delete (globalThis as { DOMRect?: unknown }).DOMRect;
  };
}
