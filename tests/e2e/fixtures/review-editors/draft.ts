import React from "react";
import { createRoot } from "react-dom/client";
import {
  CompositeDecorator,
  Editor,
  EditorState,
  convertFromRaw,
  type ContentBlock,
  type ContentState,
} from "draft-js";
import {
  blockSeed,
  container,
  EXTRA_LIST_ITEM,
  EXTRA_PARAGRAPH,
  fail,
  flaggedRuns,
  LINK,
  publish,
  SEED_TEXT,
} from "./shared";

// Bundled with React 18: Draft.js uses ReactDOM.findDOMNode, which React 19 removed.
try {
  const decorator = new CompositeDecorator([
    {
      strategy(
        block: ContentBlock,
        callback: (start: number, end: number) => void,
        content: ContentState,
      ) {
        block.findEntityRanges((character: { getEntity(): string | null }) => {
          const key = character.getEntity();
          return key !== null && content.getEntity(key).getType() === "LINK";
        }, callback);
      },
      component: (props: {
        contentState: ContentState;
        entityKey: string;
        children: React.ReactNode;
      }) =>
        React.createElement(
          "a",
          {
            href: (props.contentState.getEntity(props.entityKey).getData() as { url: string }).url,
          },
          props.children,
        ),
    },
  ]);
  const initial = EditorState.createWithContent(
    convertFromRaw({
      blocks: [
        {
          key: "seed1",
          text: SEED_TEXT,
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [{ offset: 7, length: 3, style: "BOLD" }],
          entityRanges: [{ offset: 19, length: 3, key: 0 }],
          data: {},
        },
        ...(blockSeed()
          ? [
              { key: "seed2", text: EXTRA_PARAGRAPH, type: "unstyled" },
              { key: "seed3", text: EXTRA_LIST_ITEM, type: "unordered-list-item" },
            ].map((block) => ({
              ...block,
              depth: 0,
              inlineStyleRanges: [],
              entityRanges: [],
              data: {},
            }))
          : []),
      ],
      entityMap: { 0: { type: "LINK", mutability: "MUTABLE", data: { url: LINK } } },
    }),
    decorator,
  );
  let latest = initial;
  function App() {
    const [state, setState] = React.useState(initial);
    return React.createElement(Editor, {
      editorState: state,
      onChange(next: EditorState) {
        latest = next;
        setState(next);
      },
    });
  }
  createRoot(container()).render(React.createElement(App));
  const runs = (flag: (block: ContentBlock, index: number) => boolean) =>
    latest
      .getCurrentContent()
      .getBlocksAsArray()
      .flatMap((block: ContentBlock) =>
        flaggedRuns(block.getText(), (index) => flag(block, index)),
      );
  publish({
    frame: null,
    editable: "#test-review-editor .public-DraftEditor-content",
    text: () => latest.getCurrentContent().getPlainText("\n"),
    runs: () => ({
      bold: runs((block, index) => block.getInlineStyleAt(index).has("BOLD")),
      links: runs((block, index) => {
        const key = block.getEntityAt(index);
        return key !== null && latest.getCurrentContent().getEntity(key).getType() === "LINK";
      }),
    }),
  });
} catch (error) {
  fail(error);
}
