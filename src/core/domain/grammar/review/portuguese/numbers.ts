import { finding } from "../finding";
import { frameMatches, isLang, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

const UNITS = (
  "zero um dois três quatro cinco seis sete oito nove dez onze doze treze catorze quinze " +
  "dezesseis dezessete dezoito dezenove"
).split(" ");
const TENS = ",,vinte,trinta,quarenta,cinquenta,sessenta,setenta,oitenta,noventa".split(",");
const HUNDREDS =
  ",cento,duzentos,trezentos,quatrocentos,quinhentos,seiscentos,setecentos,oitocentos,novecentos".split(
    ",",
  );

/** 1 to 999 in words, masculine: 21 -> "vinte e um", 100 -> "cem", 305 -> "trezentos e cinco". */
function words(n: number): string {
  if (n === 100) return "cem";
  const parts = [HUNDREDS[Math.floor(n / 100)]];
  const rest = n % 100;
  if (rest < 20) parts.push(rest ? UNITS[rest] : "");
  else parts.push(TENS[Math.floor(rest / 10)], rest % 10 ? UNITS[rest % 10] : "");
  return parts.filter(Boolean).join(" e ");
}
// "uma", "duas" and "-entas" agree with a feminine noun.
const feminine = (text: string) =>
  text
    .replace(/\bum$/, "uma")
    .replace(/\bdois$/, "duas")
    .replace(/entos\b/g, "entas");

// A figure that opens a sentence, before a lowercase word: "12 pessoas chegaram." A line with
// no full stop is a list item or a recipe line ("2 xícaras de farinha"), not a sentence; one
// with another figure is a date, an address or a measure ("29 fevereiro 2000.").
const OPENING = `(?=[1-9])(?<=(?:^|[.!?]${SPACE}|\\n[ \\t\\u00a0]{0,8}))(?<target>[1-9]\\d{0,2})(?=${SPACE}(?<noun>\\p{L}{3,})${WORD_END}(?<rest>[^\\n.!?]*)[.!?])`;
// Months and abbreviations that follow a day or a page number.
const NOT_NOUNS =
  /^(?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|pag|pág|págs|pags)$/;

/**
 * Optional number style (styleSpelledNumbers): a sentence starts with a word, not a figure.
 * The gender follows the noun's ending; both forms when the ending does not tell it.
 */
export function sentenceStartNumbers(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, OPENING)) {
    const { noun, rest } = m.groups!;
    if (noun !== noun.toLowerCase() || NOT_NOUNS.test(noun) || /\d/.test(rest)) continue;
    const masculine = words(Number(m.groups!.target));
    const female = feminine(masculine);
    let forms = [masculine, female];
    if (female === masculine || /(?:o|os|or|ores)$|^dias?$/.test(noun)) forms = [masculine];
    else if (/(?:[^m]as?|ção|ções|dade|dades|gem|gens)$/.test(noun)) forms = [female];
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding(
        "styleSpelledNumbers",
        "review_msg_spelled_numbers",
        start,
        end,
        forms.map((form) => form[0].toUpperCase() + form.slice(1)),
        forms.length > 1 ? { requiresChoice: true } : undefined,
      ),
    );
  }
  return findings;
}
