import "trix";
import { container, fail, htmlModel, LINK, publish } from "./shared";

interface TrixElement extends HTMLElement {
  value: string;
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
    publish({
      frame: null,
      editable: "trix-editor",
      text: () => htmlModel(element.value).text,
      runs: () => htmlModel(element.value).runs,
    });
  });
  container().append(input, element);
} catch (error) {
  fail(error);
}
