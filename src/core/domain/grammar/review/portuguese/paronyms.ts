import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { gluedAfter } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { FindingsFilter, MatchFixer } from "../../engine/reviewRules";
import { analyze, SENTENCE_START } from "./nounAgreement";
import { graphWords } from "../wordGraph";
import type * as Data from "./paronyms.generated";
import { reviewData } from "../reviewLanguageData";
import { finding } from "../finding";

/**
 * "da fabrica", "uma duvida", "em pratica": after a determiner or a preposition a
 * word is a noun or adjective, never a finite verb, so the verb form that differs
 * from a noun only by its written accent stands for the noun (fábrica, dúvida, prática).
 * Bare "a/o/as/os" stay out: they are also object pronouns ("ele a pratica").
 * The frames are in grammar/rules/pt_BR.yaml.
 */

const PLAIN_VOWEL: Record<string, string> = {
  á: "a",
  â: "a",
  é: "e",
  ê: "e",
  í: "i",
  ó: "o",
  ô: "o",
  ú: "u",
};
const plain = (word: string) => word.replace(/[áâéêíóôú]/g, (vowel) => PLAIN_VOWEL[vowel]);

let twins: Map<string, string[]> | undefined;
let accented: Set<string> | undefined;
/** The unaccented verb form of an accented noun or adjective twin ("cópia" -> "copia"). */
function verbTwin(word: string): string | undefined {
  accented ??= new Set(
    graphWords(reviewData<typeof Data>("pt").PORTUGUESE_PARONYMS).flatMap((row) => row.split("|")),
  );
  return accented.has(word) ? plain(word) : undefined;
}
function accentedTwins(word: string): string[] | undefined {
  twins ??= new Map(
    graphWords(reviewData<typeof Data>("pt").PORTUGUESE_PARONYMS).map((row) => {
      const forms = row.split("|");
      return [plain(forms[0]), forms];
    }),
  );
  return twins.get(word);
}

// "Um critica, o outro elogia": indefinite "um/uma" as a pronoun with "outro" later on.
const RECIPROCAL = /^[^.!?;\n]{0,80}(?<![\p{L}])outr[oa]s?(?![\p{L}])/iu;

/**
 * The other way round: "Ele influência quem", "Você cópia os dados", "Prática-se muito". After a
 * singular subject pronoun, with a verb ending of that person and more words after it, or
 * before a hyphenated object pronoun, the accented noun twin stands for its verb form.
 * "nós médicos" (an apposition) and a pronoun after a preposition ("dei a ela prática") stay out.
 */
const PERSON_ENDING: Record<string, RegExp> = {
  eu: /o$/,
  tu: /[ae]s$/,
  ele: /[ae]$/,
  ela: /[ae]$/,
  você: /[ae]$/,
};
const PREPOSITION_BEFORE =
  /(?:^|[^\p{L}])(?:a|à|ante|até|com|contra|de|desde|em|entre|para|perante|por|sem|sob|sobre|após|como|que nem)[ \t\u00a0]+$/iu;
// A word after it, not "de": "Ele médico, ela enfermeira" and "eu, cópia de" stay out.
const OBJECT_AFTER = /^[ \t\u00a0]+(?!(?:de|da|do|das|dos)(?![\p{L}]))[\p{L}\d"“«]/u;
/**
 * "O serviço continuo" -> "contínuo", "Aulas praticas" -> "práticas", "Novo negocio" ->
 * "negócio": after a noun or adjective opening a sentence, a first-person form ("-o") or a
 * second-person one ("-as", "-es") cannot be the verb of that subject, so it is the accented
 * twin agreeing with the word before. Third-person forms stay ("a natureza continua bela").
 */
// A gerund, an infinitive or "a" + infinitive after it: the verb reading ("o resto continuo
// amanhã a fazer", "o livro continuo lendo").
const VERB_AFTER =
  /^[ \t\u00a0]+(?:(?:a[ \t\u00a0]+)?\p{Ll}+(?:ndo|[aei]r)|amanhã|depois|hoje|agora|logo|mais[ \t\u00a0]+tarde|sempre|ainda)(?![\p{L}])/u;
// Time words open a sentence as an adverb: "Sábado continuo", "Este ano pratico mais".
const TIME_NOUNS = new Set(
  "ano anos mês meses dia dias semana semanas sábado domingo verão inverno outono semestre trimestre momento tempo período fim resto turno amanhã hoje ontem agora depois cedo tarde logo".split(
    " ",
  ),
);

// "da diferencia" -> "diferença", "alguma licencia" -> "licença": a Spanish-looking "-ncia"
// that Portuguese has only as a form of the "-nciar" verb; the noun ends in "-nça".
const NCA_NOUN =
  /(?:diferen|licen|senten|presen|finan|esperan|cren|aven|perten|parecen|queren)cias?$/;
const spanishNoun = (word: string) =>
  NCA_NOUN.test(word) ? [word.replace(/cia(s?)$/, "ça$1")] : undefined;

/** The verb twin of an accented noun, unless the typed word is a user word. */
function verbFinding(
  ctx: DetectContext,
  start: number,
  end: number,
  typed: string,
  context: RawFinding["context"],
): RawFinding | null {
  const verb = verbTwin(typed.toLowerCase());
  if (!verb || ctx.dictionary.has(typed.toLowerCase())) return null;
  return {
    ruleId: "portugueseAccentParonyms",
    messageKey: "review_msg_pt_accent_verb",
    range: { start, end },
    alternatives: [applyWordCase(verb, detectWordCase(typed))],
    context,
  };
}

/** The accented twin of the word after a lead that announces a noun or an adjective. */
const afterLead: MatchFixer = (m, ctx) => {
  const target = m.groups!.target;
  const alternatives = accentedTwins(target) ?? spanishNoun(target);
  if (!alternatives || ctx.dictionary.has(target)) return null;
  const [start, end] = m.indices!.groups!.target;
  if (gluedAfter(ctx.text, end)) return null;
  if (/^um/i.test(m.groups!.lead) && RECIPROCAL.test(ctx.text.slice(end, end + 96))) return null;
  return {
    ruleId: "portugueseAccentParonyms",
    messageKey: "review_msg_pt_accent_paronym",
    range: { start, end },
    alternatives,
    context: { start: m.index, end },
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  };
};

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  paronymSubjectVerb: (m, ctx) => {
    const { lead, target } = m.groups!;
    const [start, end] = m.indices!.groups!.target;
    if (!PERSON_ENDING[lead.toLowerCase()].test(plain(target))) return null;
    if (PREPOSITION_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))) return null;
    if (!OBJECT_AFTER.test(ctx.text.slice(end, end + 12))) return null;
    return verbFinding(ctx, start, end, target, { start: m.index, end });
  },
  paronymHyphenVerb: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    return verbFinding(ctx, start, end, m.groups!.target, { start, end: end + 4 });
  },
  paronymAfterNoun: (m, ctx) => {
    const { noun, target } = m.groups!;
    const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
    if (!SENTENCE_START.test(before) || ctx.dictionary.has(target)) return null;
    const lower = noun.toLowerCase();
    if (target !== target.toLowerCase() || noun.slice(1) !== lower.slice(1)) return null;
    const info = TIME_NOUNS.has(lower) ? null : analyze(lower);
    const twins = accentedTwins(target);
    if (!info || !twins) return null;
    const [start, end] = m.indices!.groups!.target;
    if (gluedAfter(ctx.text, end) || VERB_AFTER.test(ctx.text.slice(end, end + 32))) return null;
    const fits = twins.filter((twin) =>
      /o$/.test(twin)
        ? info.feminine === false && !info.plural
        : /as$/.test(twin)
          ? info.feminine !== false && info.plural
          : info.plural,
    );
    if (fits.length !== 1) return null;
    return finding("portugueseAccentParonyms", "review_msg_pt_accent_paronym", start, end, fits, {
      context: { start: m.index, end },
    });
  },
  paronymAfterLead: afterLead,
  // An adjective or a bare article counts only where a sentence starts.
  paronymOpening: (m, ctx, frame) =>
    SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))
      ? afterLead(m, ctx, frame)
      : null,
} satisfies Record<string, MatchFixer>;

/** The named findings filters of grammar/rules/pt_BR.yaml (`filter:`). */
export const FILTERS = {
  // One finding per word: the first frame that flags it wins.
  firstAtStart: (_ctx, findings) => {
    const starts = new Set<number>();
    return findings.filter((finding) => {
      if (starts.has(finding.range.start)) return false;
      starts.add(finding.range.start);
      return true;
    });
  },
} satisfies Record<string, FindingsFilter>;
