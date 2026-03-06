import { describe, expect, test } from "bun:test";
import { isNativeUndoChord } from "../src/adapters/chrome/content-script/suggestions/keyboardShortcuts";

function createEvent(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  const event = new Event("keydown", { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, "key", { value: key });
  Object.defineProperty(event, "ctrlKey", { value: options.ctrlKey ?? false });
  Object.defineProperty(event, "metaKey", { value: options.metaKey ?? false });
  Object.defineProperty(event, "altKey", { value: options.altKey ?? false });
  Object.defineProperty(event, "shiftKey", { value: options.shiftKey ?? false });
  return event;
}

describe("keyboardShortcuts", () => {
  test("accepts Cmd+Z on macOS", () => {
    expect(isNativeUndoChord(createEvent("z", { metaKey: true }), "MacIntel")).toBe(true);
  });

  test("rejects Ctrl+Z on macOS", () => {
    expect(isNativeUndoChord(createEvent("z", { ctrlKey: true }), "MacIntel")).toBe(false);
  });

  test("accepts Ctrl+Z on non-macOS", () => {
    expect(isNativeUndoChord(createEvent("z", { ctrlKey: true }), "Win32")).toBe(true);
  });

  test("rejects Meta+Z on non-macOS", () => {
    expect(isNativeUndoChord(createEvent("z", { metaKey: true }), "Linux x86_64")).toBe(false);
  });

  test("rejects mixed or modified combinations", () => {
    expect(isNativeUndoChord(createEvent("z", { ctrlKey: true, metaKey: true }), "MacIntel")).toBe(
      false,
    );
    expect(isNativeUndoChord(createEvent("z", { ctrlKey: true, metaKey: true }), "Win32")).toBe(
      false,
    );
    expect(isNativeUndoChord(createEvent("z", { ctrlKey: true, shiftKey: true }), "Win32")).toBe(
      false,
    );
    expect(isNativeUndoChord(createEvent("z", { metaKey: true, altKey: true }), "MacIntel")).toBe(
      false,
    );
  });
});
