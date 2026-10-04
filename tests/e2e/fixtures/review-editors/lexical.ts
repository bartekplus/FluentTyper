import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  createEditor,
  type LexicalNode,
} from "lexical";
import { registerRichText, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";
import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";
import { container, fail, flaggedRuns, LINK, publish } from "./shared";

try {
  const root = container();
  root.contentEditable = "true";
  const editor = createEditor({
    namespace: "FluentTyperE2EReviewLexical",
    nodes: [HeadingNode, QuoteNode, LinkNode],
    onError(error) {
      fail(error);
      throw error;
    },
  });
  editor.setRootElement(root);
  registerRichText(editor);
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append(
        $createTextNode("We saw "),
        $createTextNode("teh").toggleFormat("bold"),
        $createTextNode(" cat and "),
        $createLinkNode(LINK).append($createTextNode("teh")),
        $createTextNode(" dog."),
      );
      $getRoot().clear().append(paragraph);
    },
    { discrete: true },
  );
  // The seeded text is the user's document: the base state of the history, not a change.
  const history = createEmptyHistoryState();
  history.current = { editor, editorState: editor.getEditorState() };
  registerHistory(editor, history, 300);
  const textNodes = () => $getRoot().getAllTextNodes();
  const runs = (flag: (node: LexicalNode) => boolean) => {
    const parts = textNodes().map((node) => ({ text: node.getTextContent(), flag: flag(node) }));
    const text = parts.map((part) => part.text).join("");
    const flags = parts.flatMap((part) => Array.from(part.text, () => part.flag));
    return flaggedRuns(text, (index) => flags[index]);
  };
  publish({
    frame: null,
    editable: "#test-review-editor",
    text: () => editor.getEditorState().read(() => $getRoot().getTextContent()),
    runs: () =>
      editor.getEditorState().read(() => ({
        bold: runs((node) => $isTextNode(node) && node.hasFormat("bold")),
        links: runs((node) => $isLinkNode(node.getParent())),
      })),
  });
} catch (error) {
  fail(error);
}
