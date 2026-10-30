// @ts-expect-error CodeMirror 5 ships no types.
import CodeMirror from "codemirror";

interface CodeMirror5 {
  getValue(): string;
}

declare global {
  interface Window {
    __testCodeMirror?: CodeMirror5;
    __testCodeMirrorError?: string;
  }
}

// CodeMirror 5 made from a hidden form textarea, as on Rentry. Its "contenteditable"
// input (Rentry) inserts typed characters itself and fires no input event for them.
// Its default "textarea" input empties a hidden textarea after each command.
// It measures its font once, when it starts: it starts after its stylesheet loads.
const link = document.createElement("link");
link.rel = "stylesheet";
link.href = "/node_modules/codemirror/lib/codemirror.css";
link.addEventListener("load", () => {
  try {
    window.__testCodeMirror = CodeMirror.fromTextArea(document.getElementById("test-codemirror"), {
      inputStyle: new URLSearchParams(location.search).get("codeMirrorInput"),
      lineWrapping: true,
      spellcheck: true,
    }) as CodeMirror5;
  } catch (error) {
    window.__testCodeMirrorError = error instanceof Error ? error.message : String(error);
  }
});
document.head.appendChild(link);
