import { describe, expect, test } from "bun:test";
import { isNativeUndoChord } from "../src/adapters/chrome/content-script/suggestions/keyboardShortcuts";

type Chord = { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };

describe("keyboardShortcuts", () => {
  test.each<[Chord, string, boolean]>([
    [{ metaKey: true }, "MacIntel", true],
    [{ ctrlKey: true }, "MacIntel", false],
    [{ ctrlKey: true }, "Win32", true],
    [{ metaKey: true }, "Linux x86_64", false],
    [{ ctrlKey: true, metaKey: true }, "MacIntel", false],
    [{ ctrlKey: true, metaKey: true }, "Win32", false],
    [{ ctrlKey: true, shiftKey: true }, "Win32", false],
    [{ metaKey: true, altKey: true }, "MacIntel", false],
  ])("Z with %o on %s gives %p", (chord, platform, expected) => {
    const event = new window.KeyboardEvent("keydown", { key: "z", ...chord });
    expect(isNativeUndoChord(event, platform)).toBe(expected);
  });
});
