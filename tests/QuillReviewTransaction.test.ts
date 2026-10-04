import { afterEach, expect, mock, test } from "bun:test";
import Delta from "quill-delta";
import {
  applyQuill,
  readQuill,
} from "../src/adapters/chrome/content-script/suggestions/QuillEditor";

// Model simulation for deterministic refusal/fault tests, not browser history proof.
function fixture() {
  const container = document.createElement("div");
  container.className = "ql-container";
  const root = document.createElement("div");
  root.className = "ql-editor";
  root.setAttribute("contenteditable", "true");
  Object.defineProperty(root, "isContentEditable", {
    get: () => root.getAttribute("contenteditable") === "true",
  });
  root.textContent = "teh and teh";
  container.append(root);
  document.body.append(container);
  let model = new Delta().insert(root.textContent);
  const quill = {
    root,
    container,
    selection: { composing: false },
    history: { cutoff: mock(() => {}) },
    isEnabled: () => true,
    getContents: (index = 0, length = model.length()) => model.slice(index, index + length),
    getText: (index = 0, length = model.length()) =>
      model.ops
        .map((op) => op.insert)
        .join("")
        .slice(index, index + length),
    getIndex: () => 0,
    updateContents: mock((delta: Delta) => {
      model = model.compose(delta);
      root.textContent = quill.getText();
    }),
  };
  Object.defineProperty(window, "Quill", {
    configurable: true,
    value: {
      find: (node: Node) => (node === container ? quill : node === root.firstChild ? {} : null),
    },
  });
  const snapshot = readQuill(root)!;
  const request = {
    before: snapshot.text,
    signature: snapshot.signature,
    after: "the and the",
    edits: [0, 8].map((start) => ({ start, end: start + 3, original: "teh", replacement: "the" })),
  };
  return { root, quill, request };
}

afterEach(() => {
  delete (window as Window & { Quill?: unknown }).Quill;
});

test("Quill submits one Delta between history boundaries", () => {
  const { root, quill, request } = fixture();
  expect(applyQuill(root, request)).toEqual({ status: "applied", signature: expect.any(String) });
  expect(quill.updateContents).toHaveBeenCalledTimes(1);
  expect(quill.history.cutoff).toHaveBeenCalledTimes(2);
  expect(root.textContent).toBe("the and the");
});

test("Quill rejects stale text, model offsets, detached editors and composition before a write", () => {
  for (const mode of ["text", "mapping", "detached", "composition"]) {
    const { root, quill, request } = fixture();
    if (mode === "text") root.firstChild!.textContent = "newer text";
    if (mode === "mapping") quill.getIndex = () => 1;
    if (mode === "detached") root.remove();
    if (mode === "composition") quill.selection.composing = true;
    const before = root.textContent;
    const result = applyQuill(root, request);
    expect(result.status).not.toBe("applied");
    if (mode === "composition") expect(result).toEqual({ status: "rejected", reason: "composing" });
    expect(quill.updateContents).not.toHaveBeenCalled();
    expect(root.textContent).toBe(before);
  }
});

test("Quill rejects duplicate edits before a model or history change", () => {
  const { root, quill, request } = fixture();
  request.edits.push(request.edits[0]);
  expect(applyQuill(root, request)).toEqual({ status: "rejected", reason: "host-refused" });
  expect(quill.updateContents).not.toHaveBeenCalled();
  expect(quill.history.cutoff).not.toHaveBeenCalled();
});

test("Quill reports refusal and unexpected host changes without a second write", () => {
  for (const newerText of [null, "host newer input"]) {
    const { root, quill, request } = fixture();
    quill.updateContents.mockImplementation(() => {
      if (newerText) root.textContent = newerText;
    });
    const result = applyQuill(root, request);
    expect(result.status).not.toBe("applied");
    expect(quill.updateContents).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe(newerText ?? request.before);
  }
});

test("Quill rejects a replaced model instance even when its text is unchanged", () => {
  const { root, quill, request } = fixture();
  Object.defineProperty(window, "Quill", {
    configurable: true,
    value: {
      find: () => ({ ...quill }),
    },
  });
  expect(applyQuill(root, request)).toEqual({ status: "stale" });
  expect(quill.updateContents).not.toHaveBeenCalled();
  expect(root.textContent).toBe(request.before);
});

test("Quill refuses eligibility changes at entry, model lookup and history callbacks", () => {
  for (const [attribute, value] of [
    ["inert", ""],
    ["aria-readonly", "true"],
    ["autocomplete", "cc-number"],
    ["contenteditable", "false"],
    ["hidden", ""],
    ["aria-hidden", "true"],
  ]) {
    for (const phase of ["entry", "lookup", "history"]) {
      const { root, quill, request } = fixture();
      const lock = () => root.setAttribute(attribute, value);
      if (phase === "entry") {
        lock();
        expect(readQuill(root)).toBeNull();
      }
      if (phase === "lookup")
        quill.getIndex = () => {
          lock();
          return 0;
        };
      if (phase === "history") quill.history.cutoff.mockImplementation(lock);
      expect(applyQuill(root, request).status).not.toBe("applied");
      expect(quill.updateContents).not.toHaveBeenCalled();
      expect(root.textContent).toBe(request.before);
      root.parentElement!.remove();
    }
  }
});

test("Quill refuses focus changes during model lookup without taking focus back", () => {
  const { root, quill, request } = fixture();
  const other = document.createElement("textarea");
  document.body.append(other);
  quill.getIndex = () => {
    other.focus();
    return 0;
  };
  expect(applyQuill(root, request)).toEqual({ status: "stale" });
  expect(quill.updateContents).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(other);
  expect(root.textContent).toBe(request.before);
});

test("Quill verifies committed text when the final history boundary fails", () => {
  for (const mode of ["throw", "replace", "readback"]) {
    const { root, quill, request } = fixture();
    const update = quill.updateContents.getMockImplementation()!;
    const read = mock(quill.getContents);
    quill.getContents = read;
    quill.updateContents.mockImplementation((delta) => {
      update(delta);
      read.mockClear();
      if (mode === "replace") quill.history = { cutoff: mock(() => {}) };
      else
        quill.history.cutoff.mockImplementation(() => {
          throw new Error("host history failure");
        });
      if (mode === "readback")
        read.mockImplementation(() => {
          throw new Error("host read failure");
        });
    });
    expect(applyQuill(root, request)).toEqual({ status: "unverified" });
    expect(read).toHaveBeenCalled();
    expect(root.textContent).toBe("the and the");
    expect(quill.updateContents).toHaveBeenCalledTimes(1);
  }
});

test("Quill rejects DOM changes made by model snapshot callbacks", () => {
  for (const html of ["newer host text", "<b>teh and teh</b>"]) {
    const { root, quill, request } = fixture();
    const getContents = quill.getContents;
    quill.getContents = (index, length) => {
      const result = getContents(index, length);
      root.innerHTML = html;
      return result;
    };
    expect(readQuill(root)).toBeNull();
    root.textContent = request.before;
    expect(applyQuill(root, request).status).not.toBe("applied");
    expect(quill.updateContents).not.toHaveBeenCalled();
    expect(root.innerHTML).toBe(html);
  }
});

test("Quill refuses stable DOM and model text divergence before writing", () => {
  const { root, quill, request } = fixture();
  const newer = new Delta().insert("teh and new\n");
  quill.getContents = (index = 0, length = newer.length()) => newer.slice(index, index + length);
  expect(readQuill(root)).toBeNull();
  expect(applyQuill(root, request).status).not.toBe("applied");
  expect(quill.updateContents).not.toHaveBeenCalled();
  expect(root.textContent).toBe(request.before);
  expect(quill.getContents().ops).toEqual(newer.ops);
});

test("Quill snapshot text accounts for embeds and exactly one terminal newline", () => {
  const { root, quill } = fixture();
  root.innerHTML = "<p>teh <img src='local.png'> cat.</p><p><br></p>";
  const model = new Delta().insert("teh ").insert({ image: "local.png" }).insert(" cat.\n\n");
  quill.getContents = (index = 0, length = model.length()) => model.slice(index, index + length);
  expect(readQuill(root)?.text).toBe("teh \ufffc cat.\n");
  root.querySelector("p")!.lastChild!.textContent = " dog.";
  expect(readQuill(root)).toBeNull();
});
