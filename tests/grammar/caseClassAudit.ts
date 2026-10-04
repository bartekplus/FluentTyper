import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A case class: `\p{Lu}`, `\p{Ll}`, `\p{Lt}` or an `[A-Z]` class without `a-z`. With the `i`
 * flag it matches letters of both cases, so the case test does nothing.
 */
export const CASE_CLASS = /\\[pP]\{(?:Lu|Ll|Lt)\}|\[(?![^\]]*a-z)[^\]]*A-Z[^\]]*\]/;

const REVIEW_DIR = "src/core/domain/grammar/review";
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );

// A regex literal: not after a value, a body of escapes, classes and other characters, flags.
const LITERAL = /(?<![\w)\]$"'`])\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuvy]*)/g;

/** Regex literals in the Review sources with the `i` flag and a case class, as "file:line". */
export function caseClassLiterals(): string[] {
  return files(REVIEW_DIR).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(LITERAL)]
      .filter(([, body, flags]) => flags.includes("i") && CASE_CLASS.test(body))
      .map((m) => `${file}:${text.slice(0, m.index).split("\n").length}`);
  });
}

const CLEAN: Record<string, string> = {
  fr_FR: "french",
  de_DE: "german",
  es_ES: "spanish",
  pt_BR: "portuguese",
  pl_PL: "polish",
  ar_SA: "arabic",
};
const LANGS = ["en_US", "fr_FR", "de_DE", "es_ES", "pt_BR", "pl_PL", "sv_SE", "el_GR", "ar_SA"];

/**
 * The sources of the regexes Review builds at run time (frames, tables, helpers) with the `i`
 * flag and a case class. A long s (U+017F) makes every string frame compile: the literal
 * prefilter cannot fold it, so it lets every frame scan. Run it in a fresh process, because a
 * module that loaded before the RegExp hook is not seen.
 */
export async function caseClassRegexes(): Promise<string[]> {
  const found = new Set<string>();
  const Native = RegExp;
  globalThis.RegExp = new Proxy(Native, {
    construct(target, args, newTarget) {
      const regex = Reflect.construct(target, args, newTarget) as RegExp;
      if (regex.flags.includes("i") && CASE_CLASS.test(regex.source)) found.add(regex.source);
      return regex;
    },
  });
  const { detectReviewDiagnostics } =
    await import("../../src/core/domain/grammar/review/reviewDiagnostics");
  const { REVIEW_SUPPORTED_RULE_IDS } =
    await import("../../src/core/domain/grammar/review/reviewCatalog");
  // This child process has no test preload.
  (await import("../../src/core/domain/grammar/review/reviewLanguageSources")).loadAllReviewData();
  const fixtures = "tests/fixtures/native-review-corpus";
  for (const lang of LANGS) {
    const clean = CLEAN[lang] ? readFileSync(`${fixtures}/${CLEAN[lang]}-clean.txt`, "utf8") : "";
    for (const text of ["ſ Ab cd.", clean]) {
      detectReviewDiagnostics(
        { id: "audit", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
        {
          lang,
          enabledRules: REVIEW_SUPPORTED_RULE_IDS,
          userDictionary: [],
          insertSpaceAfterAutocomplete: true,
        },
      );
    }
  }
  return [...found];
}

if (import.meta.main) console.log(JSON.stringify(await caseClassRegexes()));
