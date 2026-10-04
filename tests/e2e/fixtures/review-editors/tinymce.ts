import "tinymce/tinymce";
import "tinymce/icons/default";
import "tinymce/themes/silver";
import "tinymce/models/dom";
import type { TinyMCE } from "tinymce";
import { container, domModel, fail, publish, SEED_HTML } from "./shared";

// The classic (iframe) editor: the editable is the body of an editing iframe.
const target = document.createElement("div");
target.id = "test-review-tinymce";
container().append(target);
void (window as unknown as { tinymce: TinyMCE }).tinymce
  .init({
    target,
    license_key: "gpl",
    skin_url: "/node_modules/tinymce/skins/ui/oxide",
    suffix: ".min",
    content_css: false,
    menubar: false,
    toolbar: false,
    statusbar: false,
    promotion: false,
    height: 160,
    init_instance_callback(editor) {
      editor.setContent(SEED_HTML);
      editor.undoManager.clear();
      editor.undoManager.add();
      publish({
        frame: "#test-review-tinymce_ifr",
        editable: "body",
        text: () => domModel(editor.getBody()).text,
        runs: () => domModel(editor.getBody()).runs,
      });
    },
  })
  .catch(fail);
