import type { PresageModule } from "./PresageTypes";
import type { PresageEngine } from "./PresageEngine";

type PresageEngines = Record<string, PresageEngine>;

function writePresageFile(
  module: PresageModule,
  engines: PresageEngines,
  path: string,
  contents: string,
  configKey: string,
): void {
  module.FS.writeFile(path, contents);
  for (const presageEngine of Object.values(engines)) {
    presageEngine.libPresage.config(configKey, path);
  }
}

export function setTextExpansions(
  module: PresageModule,
  engines: PresageEngines,
  textExpansions: Array<[string, object]> | null | undefined,
): void {
  // Only string expansions are written, JSON-quoted so a value keeps its line breaks and
  // PresageEngine.parsePrediction tells it apart from a dictionary word.
  const lines = (Array.isArray(textExpansions) ? textExpansions : []).flatMap(
    ([shortcut, value]) =>
      typeof value === "string" ? [`${shortcut.toLowerCase()}\t${JSON.stringify(value)}`] : [],
  );
  writePresageFile(
    module,
    engines,
    "/textExpansions.txt",
    lines.length > 0 ? `${lines.join("\n")}\n` : "",
    "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
  );
}

// Hunspell's n-gram pass compares an unknown word with every dictionary entry,
// so its cost grows with the dictionary. Measured per unknown word with
// scripts/benchmark-review-spelling.ts: 250-670 ms for the pt_BR, pl_PL and
// el_GR dictionaries (2-20 MB), under 80 ms for those below 2 MB. On the large
// ones it mostly fills foreign words and stray letters with far-fetched
// entries; near-miss typos keep their first suggestion without it.
const LARGE_DICTIONARY_BYTES = 2_000_000;
const COMPOUNDING = /^(?:COMPOUNDFLAG|COMPOUNDBEGIN|COMPOUNDRULE)\b/m;

/** `aff` with `key` set to `value`: an existing line replaced (Hunspell refuses a parameter set twice), else appended. */
function setAffixParameter(aff: string, key: string, value: string): string {
  const line = new RegExp(`^${key}\\b.*$`, "m");
  if (line.test(aff)) return aff.replace(line, `${key} ${value}`);
  return `${aff}${aff === "" || aff.endsWith("\n") ? "" : "\n"}${key} ${value}\n`;
}

/**
 * Hunspell suggestion settings that keep an unknown word's lookup short.
 * Without compounding in the affix file, the compound suggestion passes find
 * nothing yet take as long as the main one: MAXCPDSUGS 0 skips them and the
 * suggestions stay the same. A large dictionary also skips the n-gram pass.
 */
export function tunedAffix(aff: string, dictionaryBytes: number): string {
  let tuned = aff;
  if (!COMPOUNDING.test(aff)) tuned = setAffixParameter(tuned, "MAXCPDSUGS", "0");
  if (dictionaryBytes >= LARGE_DICTIONARY_BYTES) {
    tuned = setAffixParameter(tuned, "MAXNGRAMSUGS", "0");
  }
  return tuned;
}

/**
 * Rewrites the language's bundled affix file in the in-memory file system
 * before Presage loads it (see tunedAffix). Typing predictions and Review
 * spelling share the engine, so both get the faster suggestions. A language
 * without a Hunspell dictionary is left alone.
 */
export function tuneHunspellSuggestions(module: PresageModule, lang: string): void {
  try {
    const xml = module.FS.readFile(`/resources_js/${lang}/presage.xml`, { encoding: "utf8" });
    const base = /<DICTIONARYBASE>([^<]+)<\/DICTIONARYBASE>/.exec(xml)?.[1].trim();
    if (!base) return;
    const aff = module.FS.readFile(`${base}.aff`, { encoding: "utf8" });
    const tuned = tunedAffix(aff, module.FS.stat(`${base}.dic`).size);
    if (tuned !== aff) module.FS.writeFile(`${base}.aff`, tuned);
  } catch {
    // No such files: Presage reports a missing dictionary itself.
  }
}

export function setUserDictionaryList(
  module: PresageModule,
  engines: PresageEngines,
  userDictionaryList: string[],
): void {
  writePresageFile(
    module,
    engines,
    "/userDictionary.txt",
    userDictionaryList.join("\n"),
    "Presage.Predictors.DefaultDictionaryPredictor.DICTIONARY",
  );
}
