import Quill from "quill";
import { container, fail, flaggedRuns, LINK, loadStylesheet, publish, seedHtml } from "./shared";

// Quill 2 bundled into the page: no window.Quill, and no instance on its container.
try {
  loadStylesheet("/node_modules/quill/dist/quill.core.css");
  const target = container();
  target.innerHTML = seedHtml();
  const quill = new Quill(target);
  if ("Quill" in window) throw new Error("The bundled Quill 2 must not set window.Quill");
  quill.history.clear();
  // Quill's text ends with the last line's newline.
  const text = () => quill.getText().replace(/\n$/, "");
  const runs = (flag: (format: { bold?: unknown; link?: unknown }) => boolean) =>
    flaggedRuns(text(), (index) => flag(quill.getFormat(index, 1)));
  publish({
    frame: null,
    editable: ".ql-editor",
    text,
    runs: () => ({
      bold: runs((format) => format.bold === true),
      links: runs((format) => format.link === LINK),
    }),
  });
} catch (error) {
  fail(error);
}
