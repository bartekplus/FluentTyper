import { jest } from "bun:test";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";
import {
  setTextExpansions,
  setUserDictionaryList,
} from "../src/adapters/chrome/background/PresageFiles";

describe("PresageFiles", () => {
  test("writes lowercase expansions to file and updates all presage engines", () => {
    const writeFile = jest.fn();
    const configEn = jest.fn();
    const configFr = jest.fn();

    const module = {
      FS: { writeFile },
    } as unknown as PresageModule;

    setTextExpansions(
      module,
      {
        en_US: { libPresage: { config: configEn } },
        fr_FR: { libPresage: { config: configFr } },
      } as never,
      [
        ["BRB", "be right back" as never],
        ["IDK", "I don't know\nreally" as never],
        // Not a string: never written (PresageHandler drops it too).
        ["OBJ", { phrase: "dropped" }],
      ],
    );

    expect(writeFile).toHaveBeenCalledWith(
      "/textExpansions.txt",
      'brb\t"be right back"\n' + 'idk\t"I don\'t know\\nreally"\n',
    );
    expect(configEn).toHaveBeenCalledWith(
      "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
      "/textExpansions.txt",
    );
    expect(configFr).toHaveBeenCalledWith(
      "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
      "/textExpansions.txt",
    );
  });

  test("handles empty expansion lists by writing an empty file", () => {
    const writeFile = jest.fn();
    const config = jest.fn();
    const module = {
      FS: { writeFile },
    } as unknown as PresageModule;

    setTextExpansions(module, { en_US: { libPresage: { config } } } as never, []);

    expect(writeFile).toHaveBeenCalledWith("/textExpansions.txt", "");
    expect(config).toHaveBeenCalledWith(
      "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
      "/textExpansions.txt",
    );
  });

  test("writes the user dictionary as newline separated words", () => {
    const writeFile = jest.fn();
    const config = jest.fn();
    const module = {
      FS: { writeFile },
    } as unknown as PresageModule;

    setUserDictionaryList(module, { en_US: { libPresage: { config } } } as never, [
      "fluenttyper",
      "presage",
    ]);

    expect(writeFile).toHaveBeenCalledWith("/userDictionary.txt", "fluenttyper\npresage");
    expect(config).toHaveBeenCalledWith(
      "Presage.Predictors.DefaultDictionaryPredictor.DICTIONARY",
      "/userDictionary.txt",
    );
  });
});
