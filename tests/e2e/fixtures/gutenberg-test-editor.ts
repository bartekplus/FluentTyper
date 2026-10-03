import {
  BlockEditorProvider,
  BlockList,
  WritingFlow,
  RichText,
  useBlockProps,
} from "@wordpress/block-editor";
import { createBlock, serialize, registerBlockType } from "@wordpress/blocks";
import { registerCoreBlocks } from "@wordpress/block-library";
import { createElement, createRoot, useState, flushSync } from "@wordpress/element";
import * as data from "@wordpress/data";
import * as richText from "@wordpress/rich-text";
import { SlotFillProvider } from "@wordpress/components";

registerCoreBlocks();
for (const [name, tagName] of [
  ["bold", "strong"],
  ["italic", "em"],
]) {
  richText.registerFormatType(`core/${name}`, { title: name, tagName, className: null });
}
registerBlockType("fluenttyper/prose", {
  apiVersion: 3,
  title: "Test prose",
  category: "text",
  attributes: { content: { type: "rich-text", source: "rich-text", selector: "p" } },
  edit: ({ attributes, setAttributes }) =>
    createElement(RichText, {
      ...useBlockProps(),
      tagName: "p",
      identifier: "content",
      value: attributes.content,
      onChange: (content: unknown) => setAttributes({ content }),
    }),
  save: ({ attributes }) =>
    createElement(RichText.Content, { tagName: "p", value: attributes.content }),
});
const prose = () => [
  createBlock("core/group", {}, [createBlock("core/paragraph", { content: "Nested content" })]),
  createBlock("core/list", {}, [createBlock("core/list-item", { content: "A list item" })]),
  createBlock("core/quote", { citation: "A citation" }, [
    createBlock("core/paragraph", { content: "A quotation" }),
  ]),
  createBlock("core/table", {
    body: [
      {
        cells: [
          { content: "We saw teh table cell.", tag: "td" },
          { content: "Second cell", tag: "td" },
        ],
      },
    ],
    caption: "A table caption",
  }),
  createBlock("core/button", { text: "Read more", url: "https://example.com" }),
  createBlock("fluenttyper/prose", { content: "We saw teh custom cat." }),
];
const api = window as typeof window & {
  wp: unknown;
  __testGutenberg?: {
    text(): string;
    serialize(): string;
    reset(): void;
    loadProse(): void;
    loadWriting(html: string): string;
  };
};
api.wp = { data, richText, element: { flushSync } };
const initial = () => [
  createBlock("core/paragraph", { content: "<strong>We saw teh cat.</strong>" }),
  createBlock("core/heading", { content: "A second heading" }),
  createBlock("core/paragraph", { content: "We saw teh cat." }),
  createBlock("core/paragraph"),
];
function Editor() {
  const [blocks, setBlocks] = useState(initial);
  api.__testGutenberg = {
    text: () => blocks.map((block) => String(block.attributes.content ?? "")).join("\n"),
    serialize: () => serialize(blocks),
    reset: () => setBlocks(initial()),
    loadProse: () => setBlocks(prose()),
    loadWriting: (html) => {
      const block = createBlock("core/paragraph", { content: html });
      setBlocks([block]);
      return block.clientId;
    },
  };
  return createElement(
    SlotFillProvider,
    null,
    createElement(
      BlockEditorProvider,
      {
        value: blocks,
        onInput: setBlocks,
        onChange: setBlocks,
        settings: { hasFixedToolbar: false, isPreviewMode: false },
      },
      createElement(WritingFlow, null, createElement(BlockList)),
    ),
  );
}
createRoot(document.getElementById("test-gutenberg")!).render(createElement(Editor));
