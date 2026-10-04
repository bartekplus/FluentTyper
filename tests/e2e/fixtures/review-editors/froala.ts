import FroalaEditor from "froala-editor";
import { container, fail, htmlModel, loadStylesheet, publish, SEED_HTML } from "./shared";

interface Froala {
  html: { get(): string };
}

try {
  loadStylesheet("/node_modules/froala-editor/css/froala_editor.min.css");
  const target = container();
  target.innerHTML = SEED_HTML;
  new FroalaEditor(target, {
    events: {
      initialized(this: Froala) {
        const html = this.html;
        publish({
          frame: null,
          editable: ".fr-element",
          text: () => htmlModel(html.get()).text,
          runs: () => htmlModel(html.get()).runs,
        });
      },
    },
  });
} catch (error) {
  fail(error);
}
