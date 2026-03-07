import { $createParagraphNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { registerRichText } from "@lexical/rich-text";

declare global {
  interface Window {
    __testLexical?: LexicalEditor;
    __testLexicalReady?: boolean;
    __testLexicalError?: string | null;
  }
}

function ensureInitialParagraph(editor: LexicalEditor): void {
  editor.update(() => {
    const root = $getRoot();
    if (root.getFirstChild() === null) {
      root.append($createParagraphNode());
    }
  });
}

function setLexicalError(error: unknown): void {
  window.__testLexicalError = error instanceof Error ? error.message : String(error);
}

function initLexicalTestEditor(): void {
  const rootElement = document.getElementById("test-lexical-editor");
  if (!(rootElement instanceof HTMLElement)) {
    setLexicalError("Lexical root element not found");
    return;
  }

  window.__testLexicalReady = false;
  window.__testLexicalError = null;

  const editor = createEditor({
    namespace: "FluentTyperE2ELexical",
    onError(error) {
      setLexicalError(error);
      throw error;
    },
  });

  registerRichText(editor);
  editor.setRootElement(rootElement);
  ensureInitialParagraph(editor);

  window.__testLexical = editor;
  window.__testLexicalReady = true;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLexicalTestEditor, { once: true });
} else {
  initLexicalTestEditor();
}
