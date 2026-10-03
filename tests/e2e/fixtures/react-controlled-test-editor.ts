import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";

const mount = document.createElement("div");
document.body.prepend(mount);
const state = { input: "", textarea: "", submitted: "", inputEvents: 0, beforeInputEvents: 0 };
declare global {
  interface Window {
    __testReactControlled: typeof state;
  }
}
window.__testReactControlled = state;
mount.addEventListener("input", () => state.inputEvents++);
mount.addEventListener("beforeinput", () => state.beforeInputEvents++);

function ControlledForm() {
  const [input, setInput] = useState("");
  const [textarea, setTextarea] = useState("");
  state.input = input;
  state.textarea = textarea;
  return createElement(
    "form",
    {
      id: "test-react-form",
      onSubmit: (event: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
        event.preventDefault();
        state.submitted = JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)));
      },
    },
    createElement("input", {
      id: "test-react-input",
      name: "input",
      value: input,
      onChange: (event: { target: HTMLInputElement }) => setInput(event.target.value),
    }),
    createElement("textarea", {
      id: "test-react-textarea",
      name: "textarea",
      value: textarea,
      onChange: (event: { target: HTMLTextAreaElement }) => setTextarea(event.target.value),
    }),
    createElement("button", { type: "submit" }, "Save"),
  );
}
createRoot(mount).render(createElement(ControlledForm));
