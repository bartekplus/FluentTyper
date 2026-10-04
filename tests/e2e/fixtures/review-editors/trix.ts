import "trix";
import { container, fail, flaggedRuns, LINK, publish } from "./shared";

interface TrixElement extends HTMLElement {
  editor: {
    getDocument(): {
      toString(): string;
      getCommonAttributesAtRange(range: [number, number]): { bold?: boolean; href?: string };
    };
  };
}

try {
  const input = document.createElement("input");
  input.type = "hidden";
  input.id = "test-review-trix-input";
  // Trix keeps blocks as <div>: this is the seed paragraph in its own markup.
  input.value = `<div>We saw <strong>teh</strong> cat and <a href="${LINK}">teh</a> dog.</div>`;
  const element = document.createElement("trix-editor") as TrixElement;
  element.setAttribute("input", input.id);
  element.addEventListener("trix-initialize", () => {
    // The Trix document: its string ends with the last block's newline.
    const text = () => element.editor.getDocument().toString().replace(/\n$/, "");
    const runs = (flag: (attributes: { bold?: boolean; href?: string }) => boolean) => {
      const document = element.editor.getDocument();
      return flaggedRuns(text(), (index) =>
        flag(document.getCommonAttributesAtRange([index, index + 1])),
      );
    };
    publish({
      frame: null,
      editable: "trix-editor",
      text,
      runs: () => ({
        bold: runs((attributes) => attributes.bold === true),
        links: runs((attributes) => attributes.href === LINK),
      }),
    });
  });
  container().append(input, element);
} catch (error) {
  fail(error);
}
