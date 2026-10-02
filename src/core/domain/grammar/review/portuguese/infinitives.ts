import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  PORTUGUESE_AR_STEMS,
  PORTUGUESE_ER_STEMS,
  PORTUGUESE_IR_STEMS,
} from "./verbStems.generated";

/**
 * "vão dormi" -> "dormir", "pode fala" -> "falar", "vou come" -> "comer": after "ir" as the
 * future auxiliary, "poder" or "conseguir" comes an infinitive, so a finite form of an
 * everyday verb that lost its -r is the infinitive. Verbs that also take a noun ("quer
 * ajuda", "deve dinheiro", "precisa ajuda") stay out, as do stems two conjugations share.
 */

const AUXILIARY =
  "vou|vais|vai|vamos|vão|ia|ias|íamos|iam|pode|posso|podes|podemos|podem|podia|podiam|poderá|poderia|consigo|consegue|conseguimos|conseguem";
// The verb right after, maybe with a hyphenated pronoun: "vão lembra-se" -> "lembrar-se".
const PATTERN = `(?:${AUXILIARY})${SPACE}(?:(?:não|já|também|ainda|logo|sempre)${SPACE})?(?<target>\\p{Ll}{2,}[aei])(?=-(?:me|te|se|nos|vos|lhes?)${WORD_END}|${WORD_END})`;
// Words that end like such a form but are none after an auxiliary.
const NOT_VERBS = new Set(["para", "nada", "cada", "casa", "toda", "fora", "pra", "agora"]);

let stems: { ar: Set<string>; er: Set<string>; ir: Set<string> } | undefined;

/** The infinitive of a finite form ("fala" -> "falar", "dormi" -> "dormir"), or null. */
function infinitive(word: string): string | null {
  stems ??= {
    ar: new Set(PORTUGUESE_AR_STEMS.split(" ")),
    er: new Set(PORTUGUESE_ER_STEMS.split(" ")),
    ir: new Set(PORTUGUESE_IR_STEMS.split(" ")),
  };
  const stem = word.slice(0, -1);
  const vowel = word.slice(-1);
  const ar = vowel === "a" && stems.ar.has(stem);
  const er = vowel !== "a" && stems.er.has(stem);
  const ir = vowel !== "a" && stems.ir.has(stem);
  if (Number(ar) + Number(er) + Number(ir) !== 1) return null;
  return `${stem}${ar ? "ar" : er ? "er" : "ir"}`;
}

export function auxiliaryInfinitives(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PATTERN)) {
    const word = m.groups!.target;
    if (word.length < 4 || NOT_VERBS.has(word) || ctx.dictionary.has(word)) continue;
    const fixed = infinitive(word);
    if (!fixed) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "portugueseAgreement",
      messageKey: "review_msg_pt_auxiliary_infinitive",
      range: { start, end },
      alternatives: [fixed],
      context: { start: m.index, end },
    });
  }
  return findings;
}
