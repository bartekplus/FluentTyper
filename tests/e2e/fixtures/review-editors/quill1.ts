// @ts-expect-error Quill 1.3.7 ships no types.
import Quill from "quill1";
import { container, fail, flaggedRuns, LINK, loadStylesheet, publish, seedHtml } from "./shared";

interface Quill1 {
  root: HTMLElement;
  history: { clear(): void };
  getText(): string;
  getFormat(index: number, length: number): { bold?: boolean; link?: string };
}

// Slack's composer: a Quill 1 fork bundled into the page, with no window.Quill.
try {
  loadStylesheet("/node_modules/quill1/dist/quill.core.css");
  const target = container();
  target.innerHTML = seedHtml();
  const quill = new Quill(target) as Quill1;
  if ("Quill" in window) throw new Error("The bundled Quill 1 must not set window.Quill");
  quill.history.clear();
  // Quill's text ends with the last line's newline.
  const text = () => quill.getText().replace(/\n$/, "");
  const runs = (flag: (format: { bold?: boolean; link?: string }) => boolean) =>
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
