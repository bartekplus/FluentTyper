import { expect, jest, test } from "bun:test";
import { resolveCodeContext } from "../src/adapters/chrome/content-script/suggestions/CodeContextResolver";

type CaretRange = Pick<Range, "startContainer" | "startOffset" | "endContainer" | "endOffset">;

function withProperty(target: object, name: string, value: unknown, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  try {
    expect(Reflect.get(target, name)).toBe(value);
    run();
  } finally {
    if (previous) Object.defineProperty(target, name, previous);
    else Reflect.deleteProperty(target, name);
  }
}

function fixture() {
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  Object.defineProperty(root, "isContentEditable", { value: true });
  root.innerHTML = '<p>prose</p><div class="ql-code-block">code</div>';
  shadow.append(root);
  const prose = root.firstElementChild!.firstChild!;
  const code = root.lastElementChild!.firstChild!;
  const at = (node: Node): CaretRange => ({
    startContainer: node,
    startOffset: 2,
    endContainer: node,
    endOffset: 2,
  });
  return { root, shadow, prose, code, at, selection: document.getSelection()! };
}

test("scoped shadow selection fallback distinguishes code from prose", () => {
  const { root, shadow, prose, code, at, selection } = fixture();
  let node = code;
  const getRangeAt = jest.fn(() => at(node));
  const getSelection = jest.fn(() => ({ rangeCount: 1, getRangeAt }));
  withProperty(selection, "getComposedRanges", undefined, () => {
    withProperty(shadow, "getSelection", getSelection, () => {
      expect(resolveCodeContext(root)).toBe("code");
      node = prose;
      expect(resolveCodeContext(root)).toBe("prose");
      expect(getSelection).toHaveBeenCalledTimes(2);
      expect(getRangeAt).toHaveBeenCalledWith(0);
    });
  });
});

test("ordinary shadow range fallback validates the actual range endpoints", () => {
  const { root, shadow, prose, code, at, selection } = fixture();
  let node = code;
  const getRangeAt = jest.fn(() => at(node));
  withProperty(selection, "getComposedRanges", undefined, () => {
    withProperty(shadow, "getSelection", undefined, () => {
      withProperty(selection, "rangeCount", 1, () => {
        withProperty(selection, "getRangeAt", getRangeAt, () => {
          expect(resolveCodeContext(root)).toBe("code");
          node = prose;
          expect(resolveCodeContext(root)).toBe("prose");
          node = document.body;
          expect(resolveCodeContext(root)).toBe("unknown");
          expect(getRangeAt).toHaveBeenCalledTimes(3);
        });
      });
    });
  });
});

test("empty multiple and expanded composed ranges do not become prose", () => {
  const { root, prose, code, at, selection } = fixture();
  const ranges: CaretRange[][] = [
    [],
    [at(prose), at(code)],
    [{ ...at(prose), endOffset: 3 }],
    [{ ...at(prose), endContainer: code }],
  ];
  for (const result of ranges) {
    const getComposedRanges = jest.fn(() => result);
    withProperty(selection, "getComposedRanges", getComposedRanges, () => {
      expect(resolveCodeContext(root)).toBe("unknown");
      expect(getComposedRanges).toHaveBeenCalledTimes(1);
    });
  }
});

test("a throwing composed selection API does not fall back to a different caret", () => {
  const { root, shadow, prose, at, selection } = fixture();
  const fallback = jest.fn(() => ({ rangeCount: 1, getRangeAt: () => at(prose) }));
  const getComposedRanges = jest.fn(() => {
    throw new Error("Composed selection unavailable");
  });
  withProperty(shadow, "getSelection", fallback, () => {
    withProperty(selection, "getComposedRanges", undefined, () => {
      expect(resolveCodeContext(root)).toBe("prose");
    });
    fallback.mockClear();
    withProperty(selection, "getComposedRanges", getComposedRanges, () => {
      expect(resolveCodeContext(root)).toBe("unknown");
      expect(getComposedRanges).toHaveBeenCalledTimes(1);
      expect(fallback).not.toHaveBeenCalled();
    });
  });
});
