import { container, fail, htmlModel, loadScript, publish, SEED_HTML } from "./shared";

interface CKEditor4 {
  getData(): string;
  resetUndo(): void;
  on(event: string, listener: () => void): void;
}
declare global {
  interface Window {
    CKEDITOR_BASEPATH?: string;
  }
}

// The classic editor: the editable is the body of an editing iframe.
window.CKEDITOR_BASEPATH = "/node_modules/ckeditor4/";
const textarea = document.createElement("textarea");
textarea.id = "test-review-ckeditor4";
textarea.value = SEED_HTML;
container().append(textarea);
loadScript("/node_modules/ckeditor4/ckeditor.js")
  .then(() => {
    const ck = (
      window as unknown as {
        CKEDITOR: {
          config: Record<string, unknown>;
          replace(element: HTMLElement, config?: unknown): CKEditor4;
        };
      }
    ).CKEDITOR;
    // No banner about the age of the open-source release.
    ck.config.versionCheck = false;
    // The Review panel opens in the editing frame: give it room for the finding list.
    const editor = ck.replace(textarea, { height: 360 });
    editor.on("instanceReady", () => {
      editor.resetUndo();
      publish({
        frame: "iframe.cke_wysiwyg_frame",
        editable: "body",
        text: () => htmlModel(editor.getData()).text,
        runs: () => htmlModel(editor.getData()).runs,
      });
    });
  })
  .catch(fail);
