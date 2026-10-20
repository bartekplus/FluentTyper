import type { MatchFixer } from "../../engine/reviewRules";
import { graphWords } from "../wordGraph";
import type * as Data from "./verbStems.generated";
import { reviewData } from "../reviewLanguageData";
import { finding } from "../finding";

/**
 * "vão dormi" -> "dormir", "pode fala" -> "falar", "vou come" -> "comer": after "ir" as the
 * future auxiliary, "poder" or "conseguir" comes an infinitive, so a finite form of an
 * everyday verb that lost its -r is the infinitive. Verbs that also take a noun ("quer
 * ajuda", "deve dinheiro", "precisa ajuda") stay out, as do stems two conjugations share.
 * The frames are in grammar/rules/pt_BR.yaml.
 */

// Words that end like such a form but are none after an auxiliary.
const NOT_VERBS = new Set([
  "para",
  "nada",
  "cada",
  "casa",
  "toda",
  "fora",
  "pra",
  "agora",
  "parte",
  "sorte",
  "mente",
  "corte",
  "porte",
  "forte",
  "norte",
  "peste",
  "vale",
  "sede",
]);

let stems: { ar: Set<string>; er: Set<string>; ir: Set<string> } | undefined;

/** The infinitive of a finite form ("fala" -> "falar", "dormi" -> "dormir"), or null. */
export function infinitive(word: string): string | null {
  stems ??= {
    ar: new Set(graphWords(reviewData<typeof Data>("pt").PORTUGUESE_AR_STEMS)),
    er: new Set(graphWords(reviewData<typeof Data>("pt").PORTUGUESE_ER_STEMS)),
    ir: new Set(graphWords(reviewData<typeof Data>("pt").PORTUGUESE_IR_STEMS)),
  };
  const stem = word.slice(0, -1);
  const vowel = word.slice(-1);
  const ar = vowel === "a" && stems.ar.has(stem);
  const er = vowel !== "a" && stems.er.has(stem);
  const ir = vowel !== "a" && stems.ir.has(stem);
  if (Number(ar) + Number(er) + Number(ir) !== 1) return null;
  return `${stem}${ar ? "ar" : er ? "er" : "ir"}`;
}

const GERUND_ENDING: Record<string, string> = { ando: "ar", endo: "er", indo: "ir" };

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  infinitiveGerund: (m, ctx) => {
    const word = m.groups!.target;
    if (ctx.dictionary.has(word.toLowerCase())) return null;
    const lower = word.toLowerCase();
    const fixed =
      lower === "pondo" ? "pôr" : `${lower.slice(0, -4)}${GERUND_ENDING[lower.slice(-4)]}`;
    const [start, end] = m.indices!.groups!.target;
    return finding(
      "portugueseAgreement",
      "review_msg_pt_auxiliary_infinitive",
      start,
      end,
      [fixed],
      {
        context: { start: m.index, end },
      },
    );
  },
  infinitivePersonal: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    const typed = ctx.text.slice(start, end + 2);
    if (ctx.dictionary.has(typed.toLowerCase())) return null;
    return finding(
      "portugueseAgreement",
      "review_msg_pt_auxiliary_infinitive",
      start,
      end + 2,
      [m.groups!.target],
      { context: { start: m.index, end: end + 2 } },
    );
  },
  infinitiveFinite: (m, ctx) => {
    const word = m.groups!.target;
    if (word.length < 4 || NOT_VERBS.has(word) || ctx.dictionary.has(word)) return null;
    const fixed = infinitive(word);
    if (!fixed) return null;
    const [start, end] = m.indices!.groups!.target;
    return finding(
      "portugueseAgreement",
      "review_msg_pt_auxiliary_infinitive",
      start,
      end,
      [fixed],
      {
        context: { start: m.index, end },
      },
    );
  },
} satisfies Record<string, MatchFixer>;
