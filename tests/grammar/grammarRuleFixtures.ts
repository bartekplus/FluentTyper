import { UI_LANGUAGES } from "../../src/core/domain/grammar/engine/compiler";
import type { CheckSpec } from "../../src/core/domain/grammar/engine/types";

/** A Review check with settings copy in each UI language, for the compiler tests. */
export const demoCheck = (overrides: Partial<CheckSpec> = {}): CheckSpec => ({
  text: {
    title: Object.fromEntries(UI_LANGUAGES.map((l) => [l, "Demo"])),
    description: Object.fromEntries(UI_LANGUAGES.map((l) => [l, "Demo."])),
  },
  example: { lang: "en_US", before: "a", after: "b" },
  id: "demoCheck",
  modes: ["review"],
  priority: 5,
  category: "grammar",
  kind: "usage",
  ...overrides,
});

/** The message of the error that `run` throws, or "". */
export const errorsOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return String(error);
  }
  return "";
};
