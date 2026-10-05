import FroalaEditor from "froala-editor";
import { container, domModel, fail, loadStylesheet, publish, seedHtml } from "./shared";

interface Froala {
  el: HTMLElement;
}

try {
  loadStylesheet("/node_modules/froala-editor/css/froala_editor.min.css");
  const target = container();
  target.innerHTML = seedHtml();
  new FroalaEditor(target, {
    events: {
      initialized(this: Froala) {
        const editable = this.el;
        publish({
          frame: null,
          editable: ".fr-element",
          text: () => domModel(editable).text,
          runs: () => domModel(editable).runs,
        });
      },
    },
  });
} catch (error) {
  fail(error);
}
