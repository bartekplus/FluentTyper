import jQuery from "jquery";
import "summernote/dist/summernote-lite.js";
import { container, domModel, fail, loadStylesheet, publish, seedHtml } from "./shared";

try {
  loadStylesheet("/node_modules/summernote/dist/summernote-lite.min.css");
  const target = jQuery(container());
  target.html(seedHtml()).summernote({
    height: 120,
    toolbar: [],
    callbacks: {
      onInit() {
        const editable = document.querySelector<HTMLElement>(".note-editable")!;
        publish({
          frame: null,
          editable: ".note-editable",
          text: () => domModel(editable).text,
          runs: () => domModel(editable).runs,
        });
      },
    },
  });
} catch (error) {
  fail(error);
}
