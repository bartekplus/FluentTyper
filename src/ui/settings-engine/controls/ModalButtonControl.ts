import type { ModalButtonConfig, FieldConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import type { FieldControl } from "./FieldControl.js";
import {
  BaseControl,
  appendLabel,
  createButtonInput,
  createControlContainer,
  createFieldRoot,
} from "./FieldControl.js";

type ControlFactory = (params: FieldConfig) => FieldControl;

export class ModalButtonControl extends BaseControl<string> {
  private readonly backdrop: HTMLDivElement;

  constructor(params: ModalButtonConfig, store: Store, createControl: ControlFactory) {
    super(params, store);

    const root = createFieldRoot();
    this._rootElement = root;

    const control = createControlContainer();
    appendLabel(control, params.label);

    const btn = createButtonInput(params.text);

    control.appendChild(btn);
    root.appendChild(control);
    this._element = btn;

    // --- Modal overlay ---
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop is-hidden";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", params.modal?.title ?? params.label ?? "Settings");
    this.backdrop = backdrop;

    const modalBox = document.createElement("div");
    modalBox.className = "modal-box";

    if (params.modal?.title) {
      const title = document.createElement("h2");
      title.className = "subtitle";
      title.innerHTML = params.modal.title;
      modalBox.appendChild(title);
    }

    // Render nested controls inside the modal
    for (const nestedParams of params.modal?.contents ?? []) {
      const nestedControl = createControl(nestedParams);
      modalBox.appendChild(nestedControl.rootElement);
    }

    const doneBtn = createButtonInput("Done");
    modalBox.appendChild(doneBtn);

    backdrop.appendChild(modalBox);
    root.appendChild(backdrop);

    // --- Open/close behaviour ---
    const open = (): void => {
      backdrop.classList.remove("is-hidden");
      doneBtn.focus();
      this.trapFocus();
    };

    const close = (): void => {
      backdrop.classList.add("is-hidden");
      btn.focus();
      this.emitter.fireEvent("modal_done");
    };

    btn.addEventListener("click", open);
    doneBtn.addEventListener("click", close);

    // Backdrop click closes
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        close();
      }
    });

    // Escape key closes
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
  }

  private trapFocus(): void {
    const focusable = Array.from(
      this.backdrop.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    this.backdrop.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") {
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  get(): string {
    return (this._element as HTMLInputElement).value;
  }

  set(value: string): this {
    (this._element as HTMLInputElement).value = value;
    return this;
  }
}
