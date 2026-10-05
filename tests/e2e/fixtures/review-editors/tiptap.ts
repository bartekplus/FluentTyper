import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { container, fail, flaggedRuns, LINK, publish, seedHtml } from "./shared";

// Tiptap renders a ProseMirror view: FluentTyper finds it through the ProseMirror path.
try {
  const editor = new Editor({
    element: container(),
    // No empty paragraph after the list of the "blocks" seed: the model text stays the seed.
    extensions: [StarterKit.configure({ link: { openOnClick: false }, trailingNode: false })],
    content: seedHtml(),
  });
  const textNodes = () => {
    const nodes: { text: string; marks: { type: { name: string }; attrs: { href?: string } }[] }[] =
      [];
    editor.state.doc.descendants((node) => {
      if (node.isText) nodes.push({ text: node.text ?? "", marks: [...node.marks] });
    });
    return nodes;
  };
  const runs = (mark: string, href?: string) => {
    const nodes = textNodes();
    const flags = nodes.flatMap((node) =>
      Array.from(node.text, () =>
        node.marks.some((m) => m.type.name === mark && (!href || m.attrs.href === href)),
      ),
    );
    return flaggedRuns(nodes.map((node) => node.text).join(""), (index) => flags[index]);
  };
  publish({
    frame: null,
    editable: "#test-review-editor .tiptap",
    text: () => {
      const blocks: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.isTextblock) blocks.push(node.textContent);
      });
      return blocks.join("\n");
    },
    runs: () => ({ bold: runs("bold"), links: runs("link", LINK) }),
  });
} catch (error) {
  fail(error);
}
