import { container, fail, flaggedRuns, LINK, loadScript, publish, SEED_HTML } from "./shared";

interface CKNode {
  data?: string;
  getAttribute(name: string): unknown;
}
interface CKEditor5 {
  model: {
    document: { getRoot(): { getChildren(): Iterable<{ getChildren(): Iterable<CKNode> }> } };
  };
}
type CKEditor5Global = Record<string, unknown> & {
  ClassicEditor: { create(element: HTMLElement, config: unknown): Promise<CKEditor5> };
};

// The browser build of the installed package, as on sites that load it from a CDN.
loadScript("/node_modules/ckeditor5/dist/browser/ckeditor5.umd.js")
  .then(async () => {
    const ck = (window as unknown as { CKEDITOR: CKEditor5Global }).CKEDITOR;
    const textarea = document.createElement("textarea");
    container().append(textarea);
    const editor = await ck.ClassicEditor.create(textarea, {
      licenseKey: "GPL",
      plugins: [ck.Essentials, ck.Paragraph, ck.Bold, ck.Link],
      toolbar: ["bold", "link", "undo", "redo"],
      initialData: SEED_HTML,
    });
    // The model: paragraphs of text nodes with their attributes.
    const blocks = () =>
      Array.from(editor.model.document.getRoot().getChildren(), (block) =>
        Array.from(block.getChildren()),
      );
    const runs = (flag: (node: CKNode) => boolean) =>
      blocks().flatMap((nodes) => {
        const flags = nodes.flatMap((node) => Array.from(node.data ?? "", () => flag(node)));
        return flaggedRuns(nodes.map((node) => node.data ?? "").join(""), (i) => flags[i]);
      });
    publish({
      frame: null,
      editable: ".ck-editor__editable",
      text: () =>
        blocks()
          .map((nodes) => nodes.map((node) => node.data ?? "").join(""))
          .join("\n"),
      runs: () => ({
        bold: runs((node) => node.getAttribute("bold") === true),
        links: runs((node) => node.getAttribute("linkHref") === LINK),
      }),
    });
  })
  .catch(fail);
