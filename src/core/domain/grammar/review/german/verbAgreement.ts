import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import type { RawFinding } from "../reviewDetectors";
import {
  germanAdjective,
  germanGender,
  germanInfinitive,
  germanNounReading,
  germanVerbLike,
} from "./germanLexicon";
import { englishLine, likeTyped, tokensAfter, tokensBefore, wordSet } from "./shared";

// A pronoun subject and a finite verb that does not fit it: "wir habe" (haben), "du kann"
// (kannst), "Sollte wir" (Sollten), "ich hast" (habe), "ihr fragst" (fragt). Auxiliaries,
// modals and common irregular verbs are listed in full; a regular verb only where its ending
// belongs to one person alone ("ihr fragst", "ich sagen").

// Person slots: ich, du, er/sie/es, wir, ihr, sie/Sie.
type Slot = 0 | 1 | 2 | 3 | 4 | 5;
// Each line: present, past and past subjunctive, six forms each ("-" where none).
const PARADIGMS = [
  "bin bist ist sind seid sind|war warst war waren wart waren|wäre wärst wäre wären wärt wären",
  "habe hast hat haben habt haben|hatte hattest hatte hatten hattet hatten|hätte hättest hätte hätten hättet hätten",
  "werde wirst wird werden werdet werden|wurde wurdest wurde wurden wurdet wurden|würde würdest würde würden würdet würden",
  "kann kannst kann können könnt können|konnte konntest konnte konnten konntet konnten|könnte könntest könnte könnten könntet könnten",
  "muss musst muss müssen müsst müssen|musste musstest musste mussten musstet mussten|müsste müsstest müsste müssten müsstet müssten",
  "soll sollst soll sollen sollt sollen|sollte solltest sollte sollten solltet sollten",
  "will willst will wollen wollt wollen|wollte wolltest wollte wollten wolltet wollten",
  "darf darfst darf dürfen dürft dürfen|durfte durftest durfte durften durftet durften|dürfte dürftest dürfte dürften dürftet dürften",
  "mag magst mag mögen mögt mögen|mochte mochtest mochte mochten mochtet mochten|möchte möchtest möchte möchten möchtet möchten",
  "weiß weißt weiß wissen wisst wissen|wusste wusstest wusste wussten wusstet wussten",
  "laufe läufst läuft laufen lauft laufen",
  "fahre fährst fährt fahren fahrt fahren",
  "gebe gibst gibt geben gebt geben",
  "nehme nimmst nimmt nehmen nehmt nehmen",
  "sehe siehst sieht sehen seht sehen",
  "lese liest liest lesen lest lesen",
  "spreche sprichst spricht sprechen sprecht sprechen",
  "helfe hilfst hilft helfen helft helfen",
  "esse isst isst essen esst essen",
  "schlafe schläfst schläft schlafen schlaft schlafen",
  "trage trägst trägt tragen tragt tragen",
  "halte hältst hält halten haltet halten",
  "lasse lässt lässt lassen lasst lassen|ließ ließt ließ ließen ließt ließen",
  "gehe gehst geht gehen geht gehen|ging gingst ging gingen gingt gingen",
  "komme kommst kommt kommen kommt kommen|kam kamst kam kamen kamt kamen",
];
type Form = { line: string[][]; tense: number; slot: Slot };
const FORMS = new Map<string, Form[]>();
for (const paradigm of PARADIGMS) {
  const line = paradigm.split("|").map((tense) => tense.split(" "));
  line.forEach((forms, tense) =>
    forms.forEach((form, slot) => {
      if (form === "-") return;
      const list = FORMS.get(form) ?? [];
      list.push({ line, tense, slot: slot as Slot });
      FORMS.set(form, list);
    }),
  );
}
// The forms of sein, haben, werden, the modals and wissen (the first ten paradigms).
const AUXILIARIES = new Set(PARADIGMS.slice(0, 10).flatMap((p) => p.split(/[| ]/)));
export const isAuxiliary = (word: string) => AUXILIARIES.has(word);
/** The infinitive of a listed verb form: "gibt" → "geben". */
export const germanInfinitiveOf = (word: string) => FORMS.get(word)?.[0].line[0][3] ?? null;
// "er habe", "sie wisse": the present subjunctive of the third person is the "ich" form.
const SUBJUNCTIVE: Readonly<Record<string, string>> = { bin: "sei" };
// Imperatives that a "du" may follow: "Sei du still", "Lies du vor".
const IMPERATIVES = wordSet(
  "sei hab habe werd werde tu tue lauf laufe fahr fahre gib nimm sieh lies sprich hilf iss " +
    "schlaf schlafe trag trage halt halte lass lasse geh gehe komm komme wisse",
);
// Pronoun subjects and the persons they take. "sie" is she or they; "es" also takes a
// plural ("es sind viele"); "sie", "es" and "ihr" may also be objects ("Ihr habe ich …").
const SUBJECT_SLOTS: Readonly<Record<string, readonly Slot[]>> = {
  ich: [0],
  du: [1],
  er: [2],
  es: [2, 5],
  man: [2],
  sie: [2, 5],
  wir: [3],
  ihr: [4],
};
const OBJECT_TOO = wordSet("sie es ihr");
const SUBJECTS = wordSet("ich du er sie es man wir ihr Sie");
// "Ich denke, wir habe …": a main clause after an opinion verb and its comma.
const OPINION = /^(?:glaube|denke|hoffe|finde|meine|weiß|schätze|vermute|befürchte|wette)$/;
// Strong verbs that change their vowel for "du" ("du fährst"): no regular ending is offered.
const STRONG =
  /(?:fahr|schlaf|trag|fall|halt|lass|wasch|wachs|lad|rat|brat|grab|schlag|lauf|sauf|geb|nehm|seh|les|sprech|helf|ess|treff|vergess|werf|sterb|empfehl|stehl|brech|tret|gelt|mess|befehl|fress|stoß)t$/;
// Words ending like a verb that are none: "wir selbst", "ich eben".
const NOT_VERBS = wordSet(
  "selbst erst sonst fast meist zuerst zuletzt längst jüngst nicht nichts jetzt bereits " +
    "stets recht eben oben unten neben gegen morgen gestern selten trotzdem allein beiden " +
    "allen einen vielen anderen",
);

const tokenEnd = /^(?:[.!?:;]|\n)$/;
// Words that open a sentence before its verb: "Was macht du?", "Dann sagt du es".
const OPENERS = wordSet(
  "was wie wo wann warum wieso weshalb wohin woher womit wozu worüber dann da jetzt nun so " +
    "also heute morgen gestern damals danach trotzdem deshalb",
);

/** Forms of the verb in `form`'s paradigm and tense that fit `slots`, or a regular guess. */
function fitting(typed: string, slots: readonly Slot[]): string[] | null {
  const low = typed.toLowerCase();
  const forms = FORMS.get(low);
  // "ich wart hier" (warte), "seid du nicht da bist" (seit): another word.
  if (low === "wart" || low === "seid") return null;
  if (forms) {
    if (forms.some((f) => slots.includes(f.slot))) return null;
    // "er habe": the subjunctive.
    if (slots.includes(2) && forms.some((f) => f.slot === 0 && f.tense === 0)) {
      if (!SUBJUNCTIVE[low]) return null;
    }
    if (low === "sei" && (slots.includes(0) || slots.includes(2))) return null;
    // "ich musst": "musste" with the last letter dropped, or the present. "ich könnt", "ich
    // wollt" may be that or "ihr könnt" mistyped, so they are left alone.
    const clipped = FORMS.get(`${low}e`)?.some((f) => slots.includes(f.slot)) ? `${low}e` : null;
    if (clipped && !low.endsWith("st")) return null;
    // "er weißt auf … hin": "weist" (weisen) as much as "weiß".
    if (low === "weißt" && slots.includes(2)) return ["weiß", "weist"];
    const out = new Set<string>(clipped ? [clipped] : []);
    for (const f of forms)
      for (const s of slots) {
        const fit = f.line[f.tense]?.[s];
        if (fit && fit !== "-") out.add(fit);
      }
    return out.size > 0 ? [...out] : null;
  }
  if (NOT_VERBS.has(low) || !/^\p{Ll}+$/u.test(low)) return null;
  // "er lies den Boden machen": "ließ", not the imperative of "lesen".
  if (low === "lies" && (slots.includes(0) || slots.includes(2))) return ["ließ"];
  // "ihr fragst", "wir sagst", "ich machst": the "du" ending on another person.
  // A stem in -t or -d keeps an -e- ("wartest", "wartet").
  const du = /^(.+[^sßzxt])st$/u.exec(low);
  const dental = /^(.+[td])est$/u.exec(low);
  const stem =
    du && germanInfinitive(`${du[1]}en`)
      ? du[1]
      : dental && germanInfinitive(`${dental[1]}en`)
        ? dental[1]
        : null;
  if (stem && !slots.includes(1)) {
    const t = /[td]$/.test(stem) ? "et" : "t";
    const out = slots.map(
      (s) => [`${stem}e`, "", `${stem}${t}`, `${stem}en`, `${stem}${t}`, `${stem}en`][s],
    );
    return [...new Set(out)];
  }
  // "du macht": the third person's ending after "du".
  const third = /^(.+[^sßzxtd])t$/u.exec(low);
  if (third && slots.length === 1 && slots[0] === 1 && !STRONG.test(low)) {
    if (germanInfinitive(`${third[1]}en`) && !/(?:te|et)$/.test(third[1])) return [`${third[1]}st`];
  }
  // "Ich sagen das": an infinitive after "ich".
  if (slots.length === 1 && slots[0] === 0 && /en$/.test(low) && germanInfinitive(low)) {
    return [`${low.slice(0, -1)}`];
  }
  return null;
}

function finding(start: number, typed: string, fits: string[], context: [number, number]) {
  const cased = fits.map((f) => likeTyped(typed, f));
  return {
    ruleId: "germanVerbAgreement",
    messageKey: "review_msg_german_verb_agreement",
    range: { start, end: start + typed.length },
    alternatives: cased,
    context: { start: context[0], end: context[1] },
    ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
  } satisfies RawFinding;
}

const subjectVerb: MatchFixer = (m, ctx) => {
  const typed = m[0];
  const low = typed.toLowerCase();
  const slots = SUBJECT_SLOTS[low];
  if (!slots) return null;
  const at = m.index;
  const end = at + typed.length;
  const before = tokensBefore(ctx.text, at, 4);
  const after = tokensAfter(ctx.text, end, 3);
  // "du und ich sind", "ich, der …": a coordinated subject or an apposition.
  if (/^(?:und|oder|sowie|bzw|,|&|\/|-)$/.test(after[0] ?? "")) return null;
  if (englishLine(ctx.text, at) || namedExampleBefore(ctx.text, at)) return null;
  const prior = before.at(-1);
  const sentenceStart = prior === undefined || tokenEnd.test(prior) || /^[„“"»«]$/.test(prior);
  const afterOpinion = prior === "," && OPINION.test(before.at(-2) ?? "");
  // "Wir sollte heute gehen": the subject opens the sentence, the verb follows; "Sie hast
  // du gesehen": an object before the verb and its subject.
  const verb = after[0];
  if (
    (sentenceStart || afterOpinion) &&
    verb &&
    /^\p{Ll}/u.test(verb) &&
    !(OBJECT_TOO.has(low) && SUBJECTS.has(after[1] ?? "")) &&
    // "Ihr wurde die Vorfahrt genommen": the dative "ihr" before a noun subject.
    !(low === "ihr" && /^(?:der|die|das|ein|eine|kein|keine)$/i.test(after[1] ?? "")) &&
    !/^['’]$/.test(after[1] ?? "")
  ) {
    // "es läuft": the plural fits "es" only before a plural subject ("es kamen viele").
    const fits = fitting(verb, slots)?.slice(0, low === "es" ? 1 : undefined);
    if (fits) {
      const start = ctx.text.indexOf(verb, end);
      return finding(start, verb, fits, [at, start + verb.length]);
    }
  }
  // "Sollte wir uns kümmern?", "Bei Jan habe wir": the verb before its subject.
  if (OBJECT_TOO.has(low) || !prior || !/^\p{L}+$/u.test(prior)) return null;
  if (typed !== low && !sentenceStart) return null;
  // "Wünscht du …?", "Was macht du?": a regular verb's third-person ending before "du", at
  // the sentence's start or after one opening w-word or adverb; else listed verbs only.
  const opener = before.length - 2;
  const first = (i: number) => i < 0 || tokenEnd.test(before[i]) || /^[„“"»«]$/.test(before[i]);
  if (
    !FORMS.has(prior.toLowerCase()) &&
    !(
      low === "du" &&
      (first(opener) || (OPENERS.has(before[opener].toLowerCase()) && first(opener - 1)))
    )
  )
    return null;
  if (low === "du" && IMPERATIVES.has(prior.toLowerCase())) return null;
  // "Ich weiß du magst …": the verb has its own subject; a new clause starts at "du".
  if (SUBJECTS.has(before.at(-2) ?? "") || SUBJECTS.has(before.at(-2)?.toLowerCase() ?? ""))
    return null;
  const fits = fitting(prior, slots);
  if (!fits) return null;
  const start = ctx.text.lastIndexOf(prior, at);
  return finding(start, prior, fits, [start, end]);
  return null;
};

function pluralNoun(noun: string): boolean {
  const reading = germanGender(noun);
  if (reading) return reading.gender !== "f" ? reading.plural : false;
  // "Lehrerinnen", "Frauen", "Regeln": a feminine noun's plural.
  if (/innen$/.test(noun)) return germanGender(noun.slice(0, -3))?.gender === "f";
  const singular = /^(.+?)e?n$/.exec(noun)?.[1];
  if (singular && singular.length >= 3 && germanGender(singular)?.gender === "f") return true;
  // "Gäste", "Bäume": an umlauted plural of a masculine noun.
  const umlaut = /^(.*)([äöü])([^aeiouäöü]*)e$/.exec(noun);
  if (!umlaut) return false;
  const base = umlaut[1] + { ä: "a", ö: "o", ü: "u" }[umlaut[2]]! + umlaut[3];
  return germanGender(base)?.gender === "m";
}

const pluralSubject: MatchFixer = (m, ctx) => {
  const { noun, verb } = m.groups!;
  if (!FORMS.get(verb)?.some((f) => f.slot === 2) || !pluralNoun(noun)) return null;
  if (ctx.dictionary.has(noun.toLowerCase()) || englishLine(ctx.text, m.index)) return null;
  const fits = fitting(verb, [5]);
  if (!fits) return null;
  const start = m.index + m[0].length - verb.length;
  return finding(start, verb, fits, [m.index, start + verb.length]);
  return null;
};

// Words that open a new clause or link two: the repeat may belong to it ("Es ist, wie es ist").
const CLAUSE_LINKS = wordSet(
  "und oder aber sondern denn sowie bzw wie was wer wo wann warum wieso weshalb dass ob weil " +
    "wenn falls obwohl je desto umso der die das dem den denen dessen deren welche welcher",
);
const SUBORDINATORS = wordSet(
  "dass ob weil wenn falls obwohl warum wieso weshalb wie was wer wo wann nachdem bevor sobald",
);
// Infinitives that follow their own finite form: "Sie werden Ärzte werden", "das kann sein".
const SELF_GOVERNED = wordSet(
  "sein haben werden können müssen wollen sollen dürfen mögen lassen wissen",
);

const doubledVerb: MatchFixer = (m, ctx) => {
  const verb = m[1];
  if (SELF_GOVERNED.has(verb) || NOT_VERBS.has(verb)) return null;
  if (!FORMS.has(verb) && !(germanVerbLike(verb) && germanNounReading(verb) === null)) return null;
  const before = tokensBefore(ctx.text, m.index, 16);
  let from = before.length;
  while (from > 0 && !/^(?:[.!?,;:()"„“”»«–—]|\n)$/.test(before[from - 1])) from--;
  const clause = before.slice(from);
  const first = clause.indexOf(verb);
  // Adjacent ("ist ist") is a doubled word; "zu kaufen" a zu-infinitive.
  if (first < 0 || first === clause.length - 1 || clause.at(-1) === "zu") return null;
  if (clause.slice(first + 1).some((t) => CLAUSE_LINKS.has(t.toLowerCase()))) return null;
  if (clause.slice(first + 1).includes(verb)) return null;
  if (englishLine(ctx.text, m.index) || namedExampleBefore(ctx.text, m.index)) return null;
  const subordinate = SUBORDINATORS.has(clause[0]?.toLowerCase() ?? "");
  // The repeat's position: the clause's tokens joined back as typed.
  let firstStart = m.index;
  for (let i = clause.length - 1; i >= first; i--) {
    firstStart = ctx.text.lastIndexOf(clause[i], firstStart - 1);
  }
  if (firstStart < 0) return null;
  const range = subordinate
    ? { start: firstStart, end: firstStart + verb.length + 1 }
    : { start: m.index - 1, end: m.index + verb.length };
  if (!/^[ \t]/.test(ctx.text.slice(subordinate ? range.end - 1 : range.start))) return null;
  return {
    ruleId: "germanVerbAgreement",
    messageKey: "review_msg_german_double_verb",
    range,
    alternatives: [""],
    context: { start: firstStart, end: m.index + verb.length },
  };
  return null;
};

// "werden" (present and subjunctive) and the modals, which take an infinitive at the clause's end.
const MODALS = new Set(
  PARADIGMS.slice(2, 9)
    .flatMap((p) => p.split(/[| ]/))
    .filter((w) => !/^wurde/.test(w)),
);
const LINKS = wordSet(
  "und oder aber sondern denn sowie bzw wie was wer wo wann warum wieso weshalb dass ob weil " +
    "wenn falls obwohl je desto umso nachdem bevor sobald damit als",
);

/** The infinitive of a finite form that is no participle, adjective or noun: "kaufe", "habe". */
function infinitiveOf(form: string): string | null {
  const listed = germanInfinitiveOf(form);
  if (listed) return listed;
  if (/(?:en|ern|eln)$/.test(form) || NOT_VERBS.has(form) || germanAdjective(form)) return null;
  // "gekauft", "besucht", "verkauft", "probiert", "unterstützt", "überprüft": participles.
  if (
    /^(?:ge|be|ver|er|ent|zer|emp|miss|unter|über|durch|hinter|wider)\p{Ll}+(?:t|en)$|iert$/u.test(
      form,
    )
  )
    return null;
  if (germanNounReading(form) !== null) return null;
  const stem = /^(\p{Ll}{2,}?)(?:te|e|st|t|est|et)$/u.exec(form)?.[1];
  if (!stem) return null;
  return [`${stem}en`, `${stem}n`].find((inf) => germanInfinitive(inf)) ?? null;
}

// After a modal or "werden" in the same main clause, the verb that ends it is an infinitive: "Ich
// will ein Auto kaufe" (kaufen), "Ich möchte Lehrer werde" (werden).
const modalInfinitive: MatchFixer = (m, ctx) => {
  const verb = m[1];
  // "werde" may end a clause after a modal ("Ich möchte Lehrer werde"); the modals may not.
  if ((MODALS.has(verb) && germanInfinitiveOf(verb) !== "werden") || SELF_GOVERNED.has(verb))
    return null;
  const infinitive = infinitiveOf(verb);
  if (!infinitive || infinitive === verb) return null;
  const before = tokensBefore(ctx.text, m.index, 12);
  let from = before.length;
  while (from > 0 && !/^(?:[.!?,;:()"„“”»«–—…]|\n)$/.test(before[from - 1])) from--;
  const clause = before.slice(from);
  const modal = clause.findIndex((t) => MODALS.has(t.toLowerCase()) && t.toLowerCase() !== verb);
  if (modal < 0 || modal === clause.length - 1) return null;
  // "… die Arbeit lenken kann als auch …": an infinitive before the modal ends a subordinate
  // clause.
  if (modal > 0 && germanInfinitive(clause[modal - 1].toLowerCase())) return null;
  if (clause.slice(modal + 1).some((t) => LINKS.has(t.toLowerCase()) || t === "zu")) return null;
  if (ctx.dictionary.has(verb) || englishLine(ctx.text, m.index)) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return {
    ruleId: "germanVerbAgreement",
    messageKey: "review_msg_german_modal_infinitive",
    range: { start: m.index, end: m.index + verb.length },
    alternatives: [infinitive],
    context: { start: Math.max(0, m.index - 40), end: m.index + verb.length },
  };
  return null;
};

const NOT_BETWEEN = wordSet("ich du er sie es wir ihr man und oder");

const finalAuxiliary: MatchFixer = (m, ctx) => {
  const { subject, middle, verb } = m.groups!;
  if (!isAuxiliary(verb)) return null;
  const between = middle.trim().split(/[ \t]+/);
  // A capitalized word only after its article ("das Buch"), so no noun or name subject.
  const capitalOk = (w: string, i: number) =>
    !/^\p{Lu}/u.test(w) ||
    /^(?:der|die|das|dem|den|des|k?ein\p{Ll}*|mein\p{Ll}*|dein\p{Ll}*|sein\p{Ll}*|ihr\p{Ll}*|unser\p{Ll}*|eu\p{Ll}*|dies\p{Ll}*)$/u.test(
      between[i - 1] ?? "",
    );
  if (!between.every(capitalOk)) return null;
  if (
    between.some(
      (w) => NOT_BETWEEN.has(w) || (isAuxiliary(w) && !/^(?:sein|haben|werden)$/.test(w)),
    )
  )
    return null;
  // A finite verb in between ("weil ich glaube es ist") starts another clause.
  if (between.some((w) => !/^ge\p{Ll}+(?:t|en)$|en$|iert$/u.test(w) && germanVerbLike(w)))
    return null;
  const fits = fitting(verb, SUBJECT_SLOTS[subject]);
  if (!fits) return null;
  const start = m.index + m[0].length - verb.length;
  if (start < ctx.from || start >= ctx.to) return null;
  if (englishLine(ctx.text, m.index) || namedExampleBefore(ctx.text, m.index)) return null;
  return finding(start, verb, fits, [m.index, start + verb.length]);
  return null;
};

// Strong verbs that change "e" to "i" or "ie" in the "du" imperative: "Sprich leiser!", "Lies
// das!", "Bewirb dich!" (authored). Stems with an inseparable prefix are built below.
const E_TO_I: Readonly<Record<string, string>> = {
  geb: "gib",
  nehm: "nimm",
  sprech: "sprich",
  les: "lies",
  seh: "sieh",
  ess: "iss",
  helf: "hilf",
  werf: "wirf",
  treff: "triff",
  gess: "giss",
  mess: "miss",
  brech: "brich",
  stech: "stich",
  sterb: "stirb",
  werb: "wirb",
  derb: "dirb",
  fehl: "fiehl",
  stehl: "stiehl",
  fress: "friss",
  tret: "tritt",
};
// Bare stems that are no ich-form with its "-e" dropped often enough to doubt ("Seh ich auch
// so", "Geb dir recht"), so they count as imperatives at a sentence start.
const BARE_ONLY = wordSet("sprech les ess vergess werf brech mess stehl fress sterb");
// Words that follow an imperative but no dropped "ich" form at once: "Les dir das durch".
const AFTER_BARE = wordSet(
  "dir mir dich mich uns euch doch bitte endlich weniger mehr lieber ruhig einfach schnell " +
    "langsam leiser lauter",
);
// Words that open a sentence before an imperative: "Bitte gib …", "Dann bewirb dich".
const IMPERATIVE_OPENERS = wordSet("bitte dann nun jetzt also und einfach");

/**
 * The "du" imperative of an e→i verb written with its "e": "Sprech nicht so laut" (Sprich),
 * "Ess weniger!" (Iss), "Dann bewerbe dich" (bewirb). Only where no dropped "ich" fits: after
 * "bitte" or an opening adverb, before "bitte" or "doch", or opening a sentence with "!".
 */
const imperative: MatchFixer = (m, ctx) => {
  const { prefix, stem, e } = m.groups!;
  const typed = m[0];
  const at = m.index;
  const low = stem.toLowerCase();
  const lowPrefix = prefix.toLowerCase();
  // "empfehl", "befehl": "fehl" takes a prefix; "gess" and "derb" only with "ver".
  const prefixFits =
    low === "fehl"
      ? /^(?:be|emp)$/.test(lowPrefix)
      : /^(?:gess|derb)$/.test(low)
        ? lowPrefix === "ver"
        : lowPrefix !== "emp";
  if (!prefixFits || typed !== likeTyped(typed, typed.toLowerCase())) return null;
  const bare = !e && !lowPrefix && BARE_ONLY.has(low);
  // "Messe", "Lese", "Treff": a noun at the sentence's start ("Sprech-" only opens compounds).
  if (/^\p{Lu}/u.test(typed) && !bare && germanNounReading(typed.toLowerCase()) !== null)
    return null;
  const before = tokensBefore(ctx.text, at, 2);
  const after = tokensAfter(ctx.text, at + typed.length, 2);
  const prior = before.at(-1);
  const opens = prior === undefined || tokenEnd.test(prior) || /^[„“"»«]$/.test(prior);
  const next = after[0] ?? "";
  if (SUBJECTS.has(next) || /^\p{Lu}/u.test(next) || next === "") return null;
  const sentence = /^[^.!?\n]*[.!?]?/.exec(ctx.text.slice(at))![0];
  const afterOpener =
    prior !== undefined &&
    IMPERATIVE_OPENERS.has(prior.toLowerCase()) &&
    (before.length < 2 || tokenEnd.test(before[0]) || /^[„“"»«,]$/.test(before[0]));
  const sure =
    afterOpener ||
    (opens && after.some((t) => /^(?:bitte|doch)$/.test(t))) ||
    (opens && sentence.endsWith("!") && !(low === "seh" && /^(?:dich|euch|uns)$/.test(next))) ||
    (opens && bare && AFTER_BARE.has(next));
  if (!sure || englishLine(ctx.text, at) || namedExampleBefore(ctx.text, at)) return null;
  if (ctx.dictionary.has(typed.toLowerCase())) return null;
  const fix = likeTyped(typed, `${lowPrefix}${E_TO_I[low]}`);
  return finding(at, typed, [fix], [at, at + typed.length + 1 + next.length]);
  return null;
};

const worden: MatchFixer = (m, ctx) => {
  const g = m.groups!;
  const typed = g.target ?? g.t2;
  const start = g.target ? m.index + m[0].length - typed.length : m.index;
  if (start < ctx.from || start >= ctx.to) return null;
  if (g.participle && (isAuxiliary(g.participle) || NOT_VERBS.has(g.participle))) return null;
  if (englishLine(ctx.text, start) || namedExampleBefore(ctx.text, start)) return null;
  return finding(start, typed, [g.target ? "worden" : "wurden"], [m.index, start + typed.length]);
};

// A participle with an adjective's "-e" before the auxiliary that closes its clause: "was sie
// gesagte hatte" (gesagt).
const DETERMINER =
  /^(?:der|die|das|dem|den|des|k?ein\p{Ll}*|mein\p{Ll}*|dein\p{Ll}*|sein\p{Ll}*|ihr\p{Ll}*|unser\p{Ll}*|eu\p{Ll}*|dies\p{Ll}*|jed\p{Ll}*)$/u;

const participleE: MatchFixer = (m, ctx) => {
  const typed = m.groups!.target;
  // "gesagte" → "sagen", "gewartete" → "warten": a weak verb's participle.
  const stem = typed.slice(2, typed.endsWith("ete") ? -3 : -2);
  if (!germanInfinitive(`${stem}en`) || ctx.dictionary.has(typed)) return null;
  // "was der gesuchte hat": a nominalized participle after its article.
  if (DETERMINER.test(tokensBefore(ctx.text, m.index, 1)[0]?.toLowerCase() ?? "")) return null;
  if (englishLine(ctx.text, m.index) || namedExampleBefore(ctx.text, m.index)) return null;
  return finding(m.index, typed, [typed.slice(0, -1)], [m.index, m.index + m[0].length]);
  return null;
};

/** The named frame fixes of the de.verbAgreement rule (grammar/rules/de.yaml). */
export const FIXERS = {
  subjectVerb,
  doubledVerb,
  pluralSubject,
  modalInfinitive,
  finalAuxiliary,
  imperative,
  worden,
  participleE,
} satisfies Record<string, MatchFixer>;
