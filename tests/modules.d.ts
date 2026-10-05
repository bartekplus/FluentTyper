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
declare module "jquery" {
  interface JQueryElement {
    html(html: string): JQueryElement;
    summernote(options: Record<string, unknown>): JQueryElement;
    summernote(command: "code"): string;
  }
  const jQuery: (element: Element) => JQueryElement;
  export default jQuery;
}
declare module "summernote/dist/summernote-lite.js";
declare module "draft-js" {
  import type { ComponentType } from "react";
  export interface ContentBlock {
    getText(): string;
    getInlineStyleAt(index: number): { has(style: string): boolean };
    getEntityAt(index: number): string | null;
    findEntityRanges(
      filter: (character: { getEntity(): string | null }) => boolean,
      callback: (start: number, end: number) => void,
    ): void;
  }
  export interface ContentState {
    getBlockForKey(key: string): ContentBlock;
    getEntity(key: string): { getType(): string; getData(): unknown };
    getBlocksAsArray(): ContentBlock[];
    getPlainText(delimiter?: string): string;
  }
  export class SelectionState {
    static createEmpty(blockKey: string): SelectionState;
    merge(values: Record<string, unknown>): SelectionState;
    getAnchorOffset(): number;
    getFocusOffset(): number;
  }
  export class EditorState {
    static createWithContent(content: ContentState, decorator?: CompositeDecorator): EditorState;
    static push(state: EditorState, content: ContentState, changeType: string): EditorState;
    static acceptSelection(state: EditorState, selection: SelectionState): EditorState;
    static undo(state: EditorState): EditorState;
    getCurrentContent(): ContentState;
    getSelection(): SelectionState;
    isInCompositionMode(): boolean;
  }
  export const Modifier: {
    insertText(content: ContentState, selection: SelectionState, text: string): ContentState;
    applyInlineStyle(content: ContentState, selection: SelectionState, style: string): ContentState;
  };
  export class CompositeDecorator {
    constructor(
      decorators: {
        strategy(
          block: ContentBlock,
          callback: (start: number, end: number) => void,
          content: ContentState,
        ): void;
        component: ComponentType<never>;
      }[],
    );
  }
  export const Editor: ComponentType<{
    editorState: EditorState;
    onChange(state: EditorState): void;
  }>;
  export function convertFromRaw(raw: unknown): ContentState;
}
declare module "trix";
