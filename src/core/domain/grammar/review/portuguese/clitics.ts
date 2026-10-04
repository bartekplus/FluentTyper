import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END, isLang } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { graphWords } from "../wordGraph";
import type * as Data from "./verbs.generated";
import { reviewData } from "../reviewLanguageData";

/**
 * Object pronoun placement.
 * - Proclisis: a negation, an indefinite pronoun, a subordinating word or one of a few
 *   adverbs right before the verb pulls the pronoun in front of it ("Não diga-me" -> "Não
 *   me diga", "Já conhecia-te" -> "Já te conhecia", "Não dir-lhe-ei" -> "Não lhe direi").
 *   Infinitives and gerunds, where both orders are correct, stay.
 * - Mesoclisis: the future and the conditional take no pronoun after them; it goes inside
 *   ("poderia-se" -> "poder-se-ia", "traria-o" -> "trá-lo-ia").
 */

// Negations, indefinite pronouns, adverbs and subordinating words ("que deve-lhe" ->
// "que lhe deve", "quando perguntei-lhe" -> "quando lhe perguntei"); Portugal is, if anything,
// stricter about these than Brazil. A comma after the attractor breaks the pull, and the
// frame needs the verb right after it.
const ATTRACTORS =
  "não|nunca|jamais|ninguém|nada|nenhum|nenhuma|algum|alguma|quem|tampouco|tudo|todos|todas|alguém|algo|já|só|talvez|apenas|quase|ainda|também|sempre|que|quando|porque|embora|enquanto|onde|conforme";
const SIMPLE = "me|te|se|lhe|lhes|nos|vos";
// "bebemo-lo", "dão-no", "conhecia-a": the forms "o/a" take after -r/-s/-z, a nasal or a vowel.
const OBJECT = "l[oa]s?|n[oa]s?|[oa]s?";
const PROCLISIS = `(?<attractor>${ATTRACTORS})${SPACE}(?:(?:eu|tu|ele|ela|eles|elas|nós|vós|você|vocês)${SPACE})?(?<target>(?<verb>\\p{L}+)-(?<pronoun>${SIMPLE}|${OBJECT}))${WORD_END}`;
// "Se comprá-las" -> "Se as comprar", "Quando fizé-lo" -> "Quando o fizer": after a
// conditional "se" or "quando" the verb is the future subjunctive, not an infinitive, and the
// pronoun goes before it. "se" counts only at the start of a clause, where it is no pronoun.
const SUBJUNCTIVE_ENCLISIS = `(?:(?<=^|[.!?;:,\\n][ \\t\\u00a0]{0,8}|(?<![\\p{L}])(?:e|mas|ou)${SPACE})se|quando)${SPACE}(?<target>(?<stem>\\p{L}{2,}[áéêí])-(?<pronoun>l[oa]s?))${WORD_END}`;
const UNACCENT: Record<string, string> = { á: "a", é: "e", ê: "e", í: "i" };
// "dir-lhe-ei", "amá-la-ei", "far-nos-iam".
const FUTURE_ENDINGS = "ei|ás|á|emos|eis|ão|ia|ias|íamos|íeis|iam";
const MESOCLITIC = `(?:${ATTRACTORS})${SPACE}(?<target>(?<stem>\\p{L}+)-(?<pronoun>${SIMPLE}|l[oa]s?)-(?<ending>${FUTURE_ENDINGS}))${WORD_END}`;
// "poderia-se", "encontraremos-nos", "traria-o", "teriam-na". The first person singular
// "-rei" only counts for the irregular "farei", "direi" and "trarei": "tirei-lhe" and
// "preparei-te" are past tenses. "-á-lo" is an infinitive ("ignorá-lo").
const ENCLITIC_FUTURE = `(?<target>(?<stem>\\p{L}{0,24}[aeiouáéíóúâêô]r)(?<ending>ia|ias|íamos|íamo|íeis|iam|ás|á|emos|emo|eis|ão|ei)-(?<pronoun>${SIMPLE}|n[oa]s?|[oa]s?))${WORD_END}`;
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
  (rStems ??= new Set(graphWords(reviewData<typeof Data>("pt").PORTUGUESE_R_STEMS))).has(
    verb.slice(0, -2),
  );
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
  messageKey:
    | "review_msg_pt_proclisis"
    | "review_msg_pt_mesoclisis"
    | "review_msg_pt_enclitic_accent"
    | "review_msg_pt_object_form"
    | "review_msg_typo",
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

// An infinitive before "-lo/-la" drops its r and accents the vowel left: "escrevê-lo",
// "puxá-las", "pô-lo", "distraí-los" (only after a vowel: "parti-lo"). The verb is an infinitive
// after a modal, a preposition or "a" ("tu vende-lo" is the second person, so they must lead).
const INFINITIVE_LEAD = `vai|vou|vamos|vão|ia|iam|irá|quero|queria|quer|querem|queremos|pode|posso|podemos|podem|podia|poderia|deve|devo|devemos|devem|deveria|preciso|precisa|precisamos|precisam|consegue|consigo|conseguimos|tento|tenta|tentar|gostaria|gosto|sei|sabe|de|para|pra|a|sem|ao|até|por|após|antes${SPACE}de|depois${SPACE}de|que`;
const ENCLITIC_INFINITIVE = `(?:${INFINITIVE_LEAD})${SPACE}(?:(?:não|já|também|sempre)${SPACE})?(?<target>(?<stem>\\p{L}*(?:[aeo]|[aeiou]i))-(?<pronoun>l[oa]s?))${WORD_END}`;
const ACCENT: Record<string, string> = { a: "á", e: "ê", o: "ô", i: "í" };

// "o/a" after a verb ending in r, s or z becomes "lo/la" and the consonant falls ("comer-o" ->
// "comê-lo", "fez-o" -> "fê-lo", "fizemos-o" -> "fizemo-lo"); after a nasal it becomes "no/na"
// ("tinham-o" -> "tinham-no", "põe-as" -> "põe-nas"). "lo/la" after a kept r, s or z also
// drops it: "fazer-lo" -> "fazê-lo", "fiz-lo" -> "fi-lo".
const PLAIN_OBJECT = `(?<target>(?<verb>\\p{L}{2,}(?:[rsz]|m)|\\p{L}+(?:ão|õe))-(?<l>l)?(?<pronoun>[oa]s?))${WORD_END}(?!-)`;
const STRESSED: Record<string, string> = { a: "á", e: "ê", o: "ô" };

/** "comer" -> "comê", "fez" -> "fê", "fizemos" -> "fizemo", "partir" -> "parti". */
function withoutConsonant(verb: string): string {
  const bare = verb.slice(0, -1);
  if (/s$/.test(verb)) return bare;
  // A stressed final a, e or o is written with its accent: dá-lo, fê-lo, pô-lo.
  return bare.replace(/[aeo]$/, (vowel) => STRESSED[vowel]).replace(/^p[oô]$/, "pô");
}

// "tira-mos as conclusões" -> "tiramos": "-mos" is the verb ending, not a pronoun. Before an
// object "mos" (me + os) would repeat it.
const SPLIT_MOS = `(?<target>(?<verb>\\p{L}+[aeiê])-mos)${SPACE}(?=(?:o|a|os|as|um|uma|uns|umas)${WORD_END})`;

export function cliticPlacement(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, SPLIT_MOS)) {
    const verb = m.groups!.verb.replace(/^(v|l|cr)ê$/, "$1e");
    push(findings, ctx, m, `${verb}mos`, "review_msg_typo");
  }
  for (const m of frameMatches(ctx, PROCLISIS)) {
    const { verb, pronoun } = m.groups!;
    if (verb.length < 2 || pronoun !== pronoun.toLowerCase()) continue;
    const finite = finiteVerb(verb, pronoun);
    if (finite)
      push(findings, ctx, m, `${plainObject(pronoun)} ${finite}`, "review_msg_pt_proclisis");
  }
  for (const m of frameMatches(ctx, SUBJUNCTIVE_ENCLISIS)) {
    const { stem, pronoun } = m.groups!;
    if (stem !== stem.toLowerCase()) continue;
    const verb = `${stem.slice(0, -1)}${UNACCENT[stem.slice(-1)]}r`;
    push(findings, ctx, m, `${plainObject(pronoun)} ${verb}`, "review_msg_pt_proclisis");
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
  for (const m of frameMatches(ctx, ENCLITIC_INFINITIVE)) {
    const { stem, pronoun } = m.groups!;
    if (stem.length < 2 || stem !== stem.toLowerCase()) continue;
    push(
      findings,
      ctx,
      m,
      `${stem.slice(0, -1)}${ACCENT[stem.slice(-1)]}-${pronoun}`,
      "review_msg_pt_enclitic_accent",
    );
  }
  for (const m of frameMatches(ctx, PLAIN_OBJECT)) {
    const { pronoun } = m.groups!;
    const verb = m.groups!.verb.toLowerCase();
    if (m.groups!.verb.slice(1) !== verb.slice(1)) continue;
    const nasal = /(?:m|ão|õe)$/.test(verb);
    if (m.groups!.l && nasal) continue;
    // "-s" that is no verb ending ("lápis", "país") and short words stay out.
    if (/s$/.test(verb) && !/(?:mos|is|es|as|us)$/.test(verb)) continue;
    push(
      findings,
      ctx,
      m,
      nasal ? `${verb}-n${pronoun}` : `${withoutConsonant(verb)}-l${pronoun}`,
      "review_msg_pt_object_form",
    );
  }
  const proclitic = new Set(findings.map((finding) => finding.range.start));
  for (const m of frameMatches(ctx, ENCLITIC_FUTURE)) {
    if (proclitic.has(m.indices!.groups!.target[0])) continue;
    const { stem, pronoun } = m.groups!;
    if (NOT_INFINITIVE.test(stem.toLowerCase())) continue;
    if (
      m.groups!.ending === "ei" &&
      !/^(?:des|re|satis|contra|pre)?(?:far|dir|trar)$/.test(stem.toLowerCase())
    )
      continue;
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
