import "tinymce/tinymce";
import "tinymce/icons/default";
import "tinymce/themes/silver";
import "tinymce/models/dom";
import type { Editor, TinyMCE } from "tinymce";

declare global {
  interface Window {
    tinymce: TinyMCE;
    __testTinyMCE?: Editor;
    __testTinyMCEError?: string;
  }
}

void window.tinymce
  .init({
    target: document.getElementById("test-tinymce")!,
    inline: new URLSearchParams(window.location.search).get("tinyMceMode") === "inline",
    license_key: "gpl",
    skin_url: "/tinymce-skin",
    suffix: ".min",
    content_css: false,
    menubar: false,
    toolbar: false,
    statusbar: false,
    promotion: false,
    height: 160,
    init_instance_callback(editor) {
      editor.setContent(
        '<p><strong>Original </strong><a href="https://example.com/">reference</a></p><p></p>',
      );
      window.__testTinyMCE = editor;
    },
  })
  .catch((error: unknown) => {
    window.__testTinyMCEError = String(error);
  });
