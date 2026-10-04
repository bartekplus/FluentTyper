import { container, fail, htmlModel, loadScript, publish, SEED_HTML } from "./shared";

interface CKEditor5 {
  getData(): string;
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
    publish({
      frame: null,
      editable: ".ck-editor__editable",
      text: () => htmlModel(editor.getData()).text,
      runs: () => htmlModel(editor.getData()).runs,
    });
  })
  .catch(fail);
