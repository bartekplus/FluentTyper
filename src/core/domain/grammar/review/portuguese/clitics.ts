import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { FindingsFilter, MatchFixer } from "../../engine/reviewRules";
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
 * The frames are in grammar/rules/pt_BR.yaml.
 */

const UNACCENT: Record<string, string> = { á: "a", é: "e", ê: "e", í: "i" };
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
  ctx: DetectContext,
  m: RegExpExecArray,
  replacement: string,
  messageKey:
    | "review_msg_pt_proclisis"
    | "review_msg_pt_mesoclisis"
    | "review_msg_pt_enclitic_accent"
    | "review_msg_pt_object_form"
    | "review_msg_typo",
): RawFinding | null {
  const target = m.groups!.target;
  if (ctx.dictionary.has(target.toLowerCase())) return null;
  const [start, end] = m.indices!.groups!.target;
  return {
    ruleId: "portugueseCliticPlacement",
    messageKey,
    range: { start, end },
    alternatives: [applyWordCase(replacement, detectWordCase(target))],
    context: { start: m.index, end },
  };
}

const ACCENT: Record<string, string> = { a: "á", e: "ê", o: "ô", i: "í" };

const STRESSED: Record<string, string> = { a: "á", e: "ê", o: "ô" };

/** "comer" -> "comê", "fez" -> "fê", "fizemos" -> "fizemo", "partir" -> "parti". */
function withoutConsonant(verb: string): string {
  const bare = verb.slice(0, -1);
  if (/s$/.test(verb)) return bare;
  // A stressed final a, e or o is written with its accent: dá-lo, fê-lo, pô-lo.
  return bare.replace(/[aeo]$/, (vowel) => STRESSED[vowel]).replace(/^p[oô]$/, "pô");
}

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  cliticSplitMos: (m, ctx) => {
    const verb = m.groups!.verb.replace(/^(v|l|cr)ê$/, "$1e");
    return push(ctx, m, `${verb}mos`, "review_msg_typo");
  },
  cliticProclisis: (m, ctx) => {
    const { verb, pronoun } = m.groups!;
    if (verb.length < 2 || pronoun !== pronoun.toLowerCase()) return null;
    const finite = finiteVerb(verb, pronoun);
    return finite
      ? push(ctx, m, `${plainObject(pronoun)} ${finite}`, "review_msg_pt_proclisis")
      : null;
  },
  cliticSubjunctive: (m, ctx) => {
    const { stem, pronoun } = m.groups!;
    if (stem !== stem.toLowerCase()) return null;
    const verb = `${stem.slice(0, -1)}${UNACCENT[stem.slice(-1)]}r`;
    return push(ctx, m, `${plainObject(pronoun)} ${verb}`, "review_msg_pt_proclisis");
  },
  cliticMesoclitic: (m, ctx) => {
    const { stem, pronoun, ending } = m.groups!;
    // "amá-la-ei": an object "o/a" hides the -r and accents the stem.
    const base = /^l[oa]s?$/.test(pronoun)
      ? /[áêíô]$/.test(stem)
        ? `${stem.slice(0, -1)}${ACCENTED_STEM[stem.slice(-1)]}r`
        : null
      : /r$/.test(stem)
        ? stem
        : null;
    if (!base) return null;
    return push(ctx, m, `${plainObject(pronoun)} ${base}${ending}`, "review_msg_pt_proclisis");
  },
  cliticInfinitive: (m, ctx) => {
    const { stem, pronoun } = m.groups!;
    if (stem.length < 2 || stem !== stem.toLowerCase()) return null;
    return push(
      ctx,
      m,
      `${stem.slice(0, -1)}${ACCENT[stem.slice(-1)]}-${pronoun}`,
      "review_msg_pt_enclitic_accent",
    );
  },
  cliticPlainObject: (m, ctx) => {
    const { pronoun } = m.groups!;
    const verb = m.groups!.verb.toLowerCase();
    if (m.groups!.verb.slice(1) !== verb.slice(1)) return null;
    const nasal = /(?:m|ão|õe)$/.test(verb);
    if (m.groups!.l && nasal) return null;
    // "-s" that is no verb ending ("lápis", "país") and short words stay out.
    if (/s$/.test(verb) && !/(?:mos|is|es|as|us)$/.test(verb)) return null;
    return push(
      ctx,
      m,
      nasal ? `${verb}-n${pronoun}` : `${withoutConsonant(verb)}-l${pronoun}`,
      "review_msg_pt_object_form",
    );
  },
  cliticFuture: (m, ctx) => {
    const { stem, pronoun } = m.groups!;
    if (NOT_INFINITIVE.test(stem.toLowerCase())) return null;
    if (
      m.groups!.ending === "ei" &&
      !/^(?:des|re|satis|contra|pre)?(?:far|dir|trar)$/.test(stem.toLowerCase())
    )
      return null;
    // "encontraremo-nos" lost the -s of "encontraremos" before "nos".
    const ending = m.groups!.ending.replace(/mo$/, "mos");
    if (ending !== m.groups!.ending && pronoun !== "nos") return null;
    if (/^[oa]s?$/.test(pronoun) || (/^n[oa]s?$/.test(pronoun) && pronoun !== "nos")) {
      // The object "o/a" turns into "lo/la" and accents the stem: "trá-lo-ia", "tê-la-iam".
      const vowel = stem.slice(-2, -1);
      if (!STEM_ACCENT[vowel]) return null;
      const accented = `${stem.slice(0, -2)}${STEM_ACCENT[vowel]}`;
      return push(
        ctx,
        m,
        `${accented}-l${plainObject(pronoun)}-${ending}`,
        "review_msg_pt_mesoclisis",
      );
    }
    return push(ctx, m, `${stem}-${pronoun}-${ending}`, "review_msg_pt_mesoclisis");
  },
} satisfies Record<string, MatchFixer>;

/** The named findings filters of grammar/rules/pt_BR.yaml (`filter:`). */
export const FILTERS = {
  // A verb that an earlier frame already moved or reshaped gets no mesoclisis finding.
  cliticFutureAfterOthers: (_ctx, findings) => {
    const others = new Set(
      findings
        .filter((finding) => finding.messageKey !== "review_msg_pt_mesoclisis")
        .map((finding) => finding.range.start),
    );
    return findings.filter(
      (finding) =>
        finding.messageKey !== "review_msg_pt_mesoclisis" || !others.has(finding.range.start),
    );
  },
} satisfies Record<string, FindingsFilter>;
