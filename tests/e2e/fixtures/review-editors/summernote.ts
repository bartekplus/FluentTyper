import jQuery from "jquery";
import "summernote/dist/summernote-lite.js";
import { container, domModel, fail, loadStylesheet, publish, SEED_HTML } from "./shared";

try {
  loadStylesheet("/node_modules/summernote/dist/summernote-lite.min.css");
  const target = jQuery(container());
  target.html(SEED_HTML).summernote({
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
