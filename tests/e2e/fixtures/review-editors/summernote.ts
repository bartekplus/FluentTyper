import jQuery from "jquery";
import "summernote/dist/summernote-lite.js";
import { container, fail, htmlModel, loadStylesheet, publish, SEED_HTML } from "./shared";

try {
  loadStylesheet("/node_modules/summernote/dist/summernote-lite.min.css");
  const target = jQuery(container());
  target.html(SEED_HTML).summernote({
    height: 120,
    toolbar: [],
    callbacks: {
      onInit() {
        publish({
          frame: null,
          editable: ".note-editable",
          text: () => htmlModel(target.summernote("code")).text,
          runs: () => htmlModel(target.summernote("code")).runs,
        });
      },
    },
  });
} catch (error) {
  fail(error);
}
