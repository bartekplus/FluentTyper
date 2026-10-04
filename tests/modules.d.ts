/// <reference types="bun-types/test-globals" />

// Packages that ship no types.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
    serialize(): string;
  }
  export class VirtualConsole {}
}
declare module "@wordpress/block-editor";
declare module "@wordpress/block-library";
