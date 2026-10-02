import { baseKeymap } from "prosemirror-commands";
import { closeHistory, history, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { schema } from "prosemirror-schema-basic";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

declare global {
  interface Window {
    __testProseMirror?: EditorView;
    __testProseMirrorCloseHistory?: () => void;
    __testProseMirrorUndo?: () => boolean;
  }
}

const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [
    schema.text("Original ", [schema.marks.strong.create()]),
    schema.text("reference", [schema.marks.link.create({ href: "https://example.com/" })]),
  ]),
  schema.node("paragraph"),
]);
const view = new EditorView(document.getElementById("test-prosemirror")!, {
  state: EditorState.create({
    doc,
    selection: TextSelection.atEnd(doc),
    plugins: [history(), keymap({ "Mod-z": undo, ...baseKeymap })],
  }),
  attributes: { id: "test-prosemirror-editor", role: "textbox" },
});
window.__testProseMirror = view;
window.__testProseMirrorCloseHistory = () => view.dispatch(closeHistory(view.state.tr));
window.__testProseMirrorUndo = () => undo(view.state, view.dispatch);
