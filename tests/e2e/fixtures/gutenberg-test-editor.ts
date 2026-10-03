import {
  BlockEditorProvider,
  BlockList,
  WritingFlow,
  RichText,
  useBlockProps,
} from "@wordpress/block-editor";
import { createBlock, serialize, getBlockType, registerBlockType } from "@wordpress/blocks";
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
  createBlock("core/verse", { content: "We saw teh verse.<br>Second line" }),
  createBlock("core/details", { summary: "We saw teh summary.", showContent: true }, [
    createBlock("core/paragraph", { content: "A details body" }),
  ]),
  createBlock("core/pullquote", {
    value: "We saw teh pullquote.",
    citation: "We saw teh author.",
  }),
  createBlock("core/navigation-link", {
    label: "We saw teh navigation.",
    url: "https://example.com/navigation",
    kind: "custom",
  }),
  createBlock("core/search", {
    label: "We saw teh search label.",
    buttonText: "We saw teh search button.",
    showLabel: true,
  }),
  createBlock("core/image", {
    url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
    caption: "We saw teh image caption.",
    alt: "teh metadata",
  }),
];
const api = window as typeof window & {
  wp: unknown;
  __testGutenberg?: {
    text(): string;
    serialize(): string;
    reset(): void;
    loadProse(): void;
    loadWriting(html: string): string;
    loadSeparate(): void;
    registry?: ReturnType<typeof data.useRegistry>;
  };
  __testGutenbergSecond?: { serialize(): string };
};
api.wp = { data, richText, blocks: { getBlockType, serialize }, element: { flushSync } };
const initial = () => [
  createBlock("core/paragraph", { content: "<strong>We saw teh cat.</strong>" }),
  createBlock("core/heading", { content: "A second heading" }),
  createBlock("core/paragraph", { content: "We saw teh cat." }),
  createBlock("core/paragraph"),
];
function RegistryProbe() {
  const registry = data.useRegistry();
  if (api.__testGutenberg) api.__testGutenberg.registry = registry;
  return null;
}
function Editor({ secondary = false }: { secondary?: boolean }) {
  const [blocks, setBlocks] = useState(() => {
    const blocks = initial();
    // Each native provider has its own registry, even with the same block ID.
    blocks[0].clientId = "fluenttyper-shared-block";
    return blocks;
  });
  if (secondary) api.__testGutenbergSecond = { serialize: () => serialize(blocks) };
  else
    api.__testGutenberg = {
      text: () => blocks.map((block) => String(block.attributes.content ?? "")).join("\n"),
      serialize: () => serialize(blocks),
      reset: () => setBlocks(initial()),
      loadProse: () => setBlocks(prose()),
      loadSeparate: () => {
        const container = document.body.appendChild(document.createElement("div"));
        container.id = "test-gutenberg-second";
        createRoot(container).render(createElement(Editor, { secondary: true }));
      },
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
      secondary ? null : createElement(RegistryProbe),
      createElement(WritingFlow, null, createElement(BlockList)),
    ),
  );
}
createRoot(document.getElementById("test-gutenberg")!).render(createElement(Editor));
