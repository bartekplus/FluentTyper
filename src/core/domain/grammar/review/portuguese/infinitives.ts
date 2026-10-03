import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { graphWords } from "../wordGraph";
import {
  PORTUGUESE_AR_STEMS,
  PORTUGUESE_ER_STEMS,
  PORTUGUESE_IR_STEMS,
} from "./verbStems.generated";
import { finding } from "../finding";

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
// "quero come" -> "comer", "deve existe" -> "existir", "tentou abri" -> "abrir": modals that
// take a noun too ("quero ajuda", "deve dinheiro") only count before an -e or -i form, which
// is a verb of the second or third conjugation and seldom a noun.
const MODAL =
  "quero|queria|quer|queremos|querem|queriam|preciso|precisa|precisamos|precisam|precisava|devo|deve|devemos|devem|devia|deviam|deveria|deveriam|tento|tenta|tentei|tentou|tentamos|tentam|tentar|tentava";
const MODAL_PATTERN = `(?:${MODAL})${SPACE}(?:(?:não|já|também|ainda|logo|sempre)${SPACE})?(?<target>\\p{Ll}{2,}[ei])(?=-(?:me|te|se|nos|vos|lhes?)${WORD_END}|${WORD_END})`;
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
function infinitive(word: string): string | null {
  stems ??= {
    ar: new Set(graphWords(PORTUGUESE_AR_STEMS)),
    er: new Set(graphWords(PORTUGUESE_ER_STEMS)),
    ir: new Set(graphWords(PORTUGUESE_IR_STEMS)),
  };
  const stem = word.slice(0, -1);
  const vowel = word.slice(-1);
  const ar = vowel === "a" && stems.ar.has(stem);
  const er = vowel !== "a" && stems.er.has(stem);
  const ir = vowel !== "a" && stems.ir.has(stem);
  if (Number(ar) + Number(er) + Number(ir) !== 1) return null;
  return `${stem}${ar ? "ar" : er ? "er" : "ir"}`;
}

// "começou a escrevendo" -> "escrever": "começar a", "passar a", "voltar a" and "tornar a" take
// the infinitive. "continuar a seguindo" stays out: there "a" may be the object pronoun.
const BEGINS =
  "(?:começ|comec|pass|volt|torn)(?:o|a|as|am|amos|ou|ei|aram|ava|avam|ar|ará|arão|aria|ariam|e|em|ando)";
const GERUND = `${BEGINS}${SPACE}a${SPACE}(?<target>\\p{Ll}+(?:ando|endo|indo)|pondo)${WORD_END}(?!-)`;
const GERUND_ENDING: Record<string, string> = { ando: "ar", endo: "er", indo: "ir" };

export function auxiliaryInfinitives(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, GERUND)) {
    const word = m.groups!.target;
    if (ctx.dictionary.has(word.toLowerCase())) continue;
    const lower = word.toLowerCase();
    const fixed =
      lower === "pondo" ? "pôr" : `${lower.slice(0, -4)}${GERUND_ENDING[lower.slice(-4)]}`;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding("portugueseAgreement", "review_msg_pt_auxiliary_infinitive", start, end, [fixed], {
        context: { start: m.index, end },
      }),
    );
  }
  for (const m of [...frameMatches(ctx, PATTERN), ...frameMatches(ctx, MODAL_PATTERN)]) {
    const word = m.groups!.target;
    if (word.length < 4 || NOT_VERBS.has(word) || ctx.dictionary.has(word)) continue;
    const fixed = infinitive(word);
    if (!fixed) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding("portugueseAgreement", "review_msg_pt_auxiliary_infinitive", start, end, [fixed], {
        context: { start: m.index, end },
      }),
    );
  }
  return findings;
}
