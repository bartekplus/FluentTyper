import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { PORTUGUESE_R_STEMS } from "./verbs.generated";

/**
 * Object pronoun placement.
 * - Proclisis: a negation, an indefinite pronoun, a subordinating word or one of a few
 *   adverbs right before the verb pulls the pronoun in front of it ("Não diga-me" -> "Não
 *   me diga", "Já conhecia-te" -> "Já te conhecia", "Não dir-lhe-ei" -> "Não lhe direi").
 *   Infinitives and gerunds, where both orders are correct, stay.
 * - Mesoclisis: the future and the conditional take no pronoun after them; it goes inside
 *   ("poderia-se" -> "poder-se-ia", "traria-o" -> "trá-lo-ia").
 */

// Negations, indefinite pronouns and a few adverbs. Subordinating words ("que deve-lhe",
// "quando perguntei-lhe") and "ainda", "também" or "sempre" before enclisis are still
// written in Portugal, so they stay out.
const ATTRACTORS =
  "não|nunca|jamais|ninguém|nada|nenhum|nenhuma|algum|alguma|quem|tampouco|tudo|todos|todas|alguém|algo|já|só|talvez|apenas|quase";
const SIMPLE = "me|te|se|lhe|lhes|nos|vos";
// "bebemo-lo", "dão-no", "conhecia-a": the forms "o/a" take after -r/-s/-z, a nasal or a vowel.
const OBJECT = "l[oa]s?|n[oa]s?|[oa]s?";
const PROCLISIS = `(?<attractor>${ATTRACTORS})${SPACE}(?<target>(?<verb>\\p{Ll}+)-(?<pronoun>${SIMPLE}|${OBJECT}))${WORD_END}`;
// "dir-lhe-ei", "amá-la-ei", "far-nos-iam".
const FUTURE_ENDINGS = "ei|ás|á|emos|eis|ão|ia|ias|íamos|íeis|iam";
const MESOCLITIC = `(?:${ATTRACTORS})${SPACE}(?<target>(?<stem>\\p{Ll}+)-(?<pronoun>${SIMPLE}|l[oa]s?)-(?<ending>${FUTURE_ENDINGS}))${WORD_END}`;
// "poderia-se", "encontraremos-nos", "traria-o", "teriam-na". The first person singular
// "-rei" is left out: "tirei-lhe" and "preparei-te" are past tenses. "-á-lo" is an
// infinitive ("ignorá-lo").
const ENCLITIC_FUTURE = `(?<target>(?<stem>\\p{Ll}{0,24}[aeiouáéíóúâêô]r)(?<ending>ia|ias|íamos|íamo|íeis|iam|ás|á|emos|emo|eis|ão)-(?<pronoun>${SIMPLE}|n[oa]s?|[oa]s?))${WORD_END}`;
// Imperfects and presents of -rer/-rir verbs end like a conditional or future ("queria",
// "preferia", "queremos"), but their stem is no infinitive.
const NOT_INFINITIVE =
  /^(?:\p{Ll}*(?:quer|quir|fer)|ger|diger|suger|inser|asser|ader|coer|iner|enxer|preter|par|color|flor|exaur)$/u;

// Infinitives (personal ones too) and gerunds allow enclisis after an attractor.
const NON_FINITE = /(?:[aeioô]r|[aeio]rem|[aeio]rmos|[aeio]res|ndo)$/;
// "querem", "esperes", "preferem" end like a personal infinitive (fazerem, saberes), but their
// stem is no infinitive: "quer" is the stem of "querer".
let rStems: Set<string> | undefined;
const finiteLookalike = (verb: string) =>
  /[aeio]r(?:em|es)$/.test(verb) &&
  (rStems ??= new Set(PORTUGUESE_R_STEMS.split(" "))).has(verb.slice(0, -2));
const ACCENTED_STEM: Record<string, string> = { á: "a", ê: "e", í: "i", ô: "o" };
const STEM_ACCENT: Record<string, string> = { a: "á", e: "ê", i: "i", o: "ô" };
/** "lo" -> "o", "nas" -> "as"; "nos" (us) stays. */
const plainObject = (pronoun: string) =>
  pronoun === "nos" ? pronoun : pronoun.replace(/^[ln](?=[oa]s?$)/, "");

/** The verb a hyphenated object pronoun was attached to, or null when it cannot be told. */
function finiteVerb(verb: string, pronoun: string): string | null {
  if (NON_FINITE.test(verb) && !finiteLookalike(verb)) return null;
  // "encontramo-nos", "bebemo-lo": the first person plural drops its -s.
  if (verb.endsWith("mo") && (pronoun === "nos" || /^l[oa]s?$/.test(pronoun))) return `${verb}s`;
  // "fi-lo", "comprá-lo": an -r, -s or -z fell off; "comprá-lo" may be an infinitive.
  if (/^l[oa]s?$/.test(pronoun)) return null;
  // "dão-no", "têm-nas": "o/a" after a nasal.
  if (/^n[oa]s?$/.test(pronoun) && pronoun !== "nos")
    return /(?:ão|õe|[aeê]m)$/.test(verb) ? verb : null;
  // "beba-o", "conhecia-a": after a vowel.
  if (/^[oa]s?$/.test(pronoun)) return /[aeiouáéíóúâêô]$/.test(verb) ? verb : null;
  return verb;
}

function push(
  findings: RawFinding[],
  ctx: DetectContext,
  m: RegExpExecArray,
  replacement: string,
  messageKey: "review_msg_pt_proclisis" | "review_msg_pt_mesoclisis",
): void {
  const target = m.groups!.target;
  if (ctx.dictionary.has(target.toLowerCase())) return;
  const [start, end] = m.indices!.groups!.target;
  findings.push({
    ruleId: "portugueseCliticPlacement",
    messageKey,
    range: { start, end },
    alternatives: [applyWordCase(replacement, detectWordCase(target))],
    context: { start: m.index, end },
  });
}

export function cliticPlacement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PROCLISIS)) {
    const { verb, pronoun } = m.groups!;
    if (verb.length < 2 || pronoun !== pronoun.toLowerCase()) continue;
    const finite = finiteVerb(verb, pronoun);
    if (finite)
      push(findings, ctx, m, `${plainObject(pronoun)} ${finite}`, "review_msg_pt_proclisis");
  }
  for (const m of frameMatches(ctx, MESOCLITIC)) {
    const { stem, pronoun, ending } = m.groups!;
    // "amá-la-ei": an object "o/a" hides the -r and accents the stem.
    const base = /^l[oa]s?$/.test(pronoun)
      ? /[áêíô]$/.test(stem)
        ? `${stem.slice(0, -1)}${ACCENTED_STEM[stem.slice(-1)]}r`
        : null
      : /r$/.test(stem)
        ? stem
        : null;
    if (!base) continue;
    push(findings, ctx, m, `${plainObject(pronoun)} ${base}${ending}`, "review_msg_pt_proclisis");
  }
  const proclitic = new Set(findings.map((finding) => finding.range.start));
  for (const m of frameMatches(ctx, ENCLITIC_FUTURE)) {
    if (proclitic.has(m.indices!.groups!.target[0])) continue;
    const { stem, pronoun } = m.groups!;
    if (NOT_INFINITIVE.test(stem.toLowerCase())) continue;
    // "encontraremo-nos" lost the -s of "encontraremos" before "nos".
    const ending = m.groups!.ending.replace(/mo$/, "mos");
    if (ending !== m.groups!.ending && pronoun !== "nos") continue;
    if (/^[oa]s?$/.test(pronoun) || (/^n[oa]s?$/.test(pronoun) && pronoun !== "nos")) {
      // The object "o/a" turns into "lo/la" and accents the stem: "trá-lo-ia", "tê-la-iam".
      const vowel = stem.slice(-2, -1);
      if (!STEM_ACCENT[vowel]) continue;
      const accented = `${stem.slice(0, -2)}${STEM_ACCENT[vowel]}`;
      push(
        findings,
        ctx,
        m,
        `${accented}-l${plainObject(pronoun)}-${ending}`,
        "review_msg_pt_mesoclisis",
      );
      continue;
    }
    push(findings, ctx, m, `${stem}-${pronoun}-${ending}`, "review_msg_pt_mesoclisis");
  }
  return findings;
}
