import { expect, jest, test } from "bun:test";
import { resolveCodeContext } from "../src/adapters/chrome/content-script/suggestions/CodeContextResolver";

test("nested shadow selection resolves from the supplied composed range", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const outer = host.attachShadow({ mode: "open" });
  const innerHost = document.createElement("div");
  outer.append(innerHost);
  const inner = innerHost.attachShadow({ mode: "open" });
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  Object.defineProperty(editor, "isContentEditable", { value: true });
  editor.innerHTML = '<div class="ql-code-block">code</div>';
  inner.append(editor);
  const block = editor.firstElementChild!;
  const node = block.firstChild!;
  const range = { startContainer: node, startOffset: 2, endContainer: node, endOffset: 2 };
  const getComposedRanges = jest.fn(() => [range]);
  const selection = { getComposedRanges } as unknown as Selection;
  const spy = jest.spyOn(document, "getSelection").mockReturnValue(selection);
  try {
    expect(editor.ownerDocument).toBe(document);
    expect(editor.getRootNode()).toBe(inner);
    expect(inner.host.getRootNode()).toBe(outer);
    expect(outer.host.getRootNode()).toBe(document);
    expect(editor.ownerDocument.getSelection()).toBe(selection);
    expect(editor.contains(node)).toBe(true);
    expect(block.matches("code, pre, kbd, samp, .ql-code-block, .ql-code-block-container")).toBe(
      true,
    );
    const context = resolveCodeContext(editor);
    expect(getComposedRanges).toHaveBeenCalledWith({ shadowRoots: [inner, outer] });
    expect(context).toBe("code");
  } finally {
    spy.mockRestore();
    host.remove();
  }
});
