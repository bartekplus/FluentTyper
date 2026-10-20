import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { determinerFits, nominalVerb } from "./articleGender";
import {
  germanInfinitive,
  germanNounReading,
  germanPastInfinitives,
  germanVerbLike,
} from "./germanLexicon";
import { likeTyped, tokensBefore, VERB_GOVERNORS, wordSet } from "./shared";
import { nounPair } from "./nounPairs";
import { germanInfinitiveOf, isAuxiliary } from "./verbAgreement";

// German compounds written apart or with the wrong joints: separable verbs ("auf zu bauen" →
// "aufzubauen"), times of day ("Dienstag Abend" → "Dienstagabend"), numbers with suffixes
// ("8 seitig" → "8-seitig", "3. Klässler" → "Drittklässler"), abbreviations before nouns
// ("US Bürger" → "US-Bürger") and fixed spellings ("Email" → "E-Mail", "DinA4" → "DIN A4").

const NBSP = " ";

// Particles of separable verbs; "um" and "mit" are left out ("um zu gehen" is "in order
// to go"), and "zu" ("zu zu muten") needs the joined verb to be known like the others.
const PARTICLES =
  "ab an auf aus bei ein fest fort her herab heran herauf heraus herbei herein herüber " +
  "herum herunter hervor hin hinab hinauf hinaus hinein hinüber hinunter hinweg los " +
  "nach nieder vor voran voraus vorbei vorüber weg weiter wieder zurück zusammen zu " +
  "bereit statt teil kennen fertig frei zufrieden wohl hoch dar empor entgegen unter zurecht";
const PARTICLE_SET = wordSet(PARTICLES);
// Adverbs ending in -t, unlike the finite verbs whose particle comes next ("fängt an zu").
const NOT_FINITE = wordSet(
  "nicht jetzt erst oft fast meist zuletzt sonst selbst gut recht weit halt damit dort mit " +
    "seit womit somit leicht vielleicht direkt exakt",
);
/** Whether the particle and the verb form after it make one verb: "ab sagst" (absagen). */
function joinsVerb(particle: string, verb: string): boolean {
  if (isAuxiliary(verb)) return false;
  const joins = (infinitive: string) =>
    germanInfinitive(infinitive) && germanInfinitive(particle + infinitive);
  // "ab geschickt": a participle; "zu gelassen" may be "too calm".
  const participle = /^ge(\p{Ll}{2,}?)(?:en|t)$/u.exec(verb);
  if (participle) return particle !== "zu" && joins(`${participle[1]}en`);
  // "zu gehen" is a zu-infinitive; other particles join an infinitive too ("los gehen").
  if (/(?:en|ern|eln)$/.test(verb) && germanInfinitive(verb)) {
    return particle !== "zu" && joins(verb);
  }
  // "gibt", "lässt": a listed irregular form; "sagst", "sagte": a regular one.
  const listed = germanInfinitiveOf(verb);
  if (listed) return joins(listed);
  // "vor fuhr", "bereit standen", "unter schrieben": a strong past form ("zu lasen" is more
  // likely a misspelled zu-infinitive).
  if (particle !== "zu" && germanPastInfinitives(verb).some(joins)) return true;
  // "zu lange", "zu enge": "too", before an adjective in -e.
  const stem = /^(.+?)(?:e|st|t|est|et|te|test|ten|tet)$/u.exec(verb)?.[1];
  if (!stem || (particle === "zu" && verb.endsWith("e"))) return false;
  return joins(`${stem}en`) || joins(`${stem}n`);
}
// Words that make the particle part of another phrase: "den weg", "gerade aus", "da nach",
// "immer hin", "außen vor", "all zu".
const NOT_PARTICLE_AFTER = wordSet(
  "der die das den dem des ein eine einen einem einer eines kein keine keinen keinem " +
    "mein meinen meinem dein deinen deinem sein seinen seinem ihren ihrem unseren unserem " +
    "gerade da hier wo dort all immer außen bergauf bergab",
);
const ORDINALS = [
  "Erst",
  "Zweit",
  "Dritt",
  "Viert",
  "Fünft",
  "Sechst",
  "Siebt",
  "Acht",
  "Neunt",
  "Zehnt",
  "Elft",
  "Zwölft",
  "Dreizehnt",
];

type Fix = (m: RegExpExecArray, ctx: DetectContext) => string | null;

/**
 * Whether the words before `index` open an infinitive clause of their own (after a comma,
 * or "um", "ohne", "statt") with no finite verb whose particle the word could be: "Er
 * versprach, mich dort hin zu bringen" but not "Fang nicht an zu heulen", "Ich hoffe, es
 * macht dir nichts aus zu laufen".
 */
function infinitiveClause(ctx: DetectContext, index: number, particle: string): boolean {
  const before = ctx.text.slice(Math.max(0, index - 120), index);
  const clause = /(?:^|[.!?;:\n,])([^.!?;:\n,]*)$/.exec(before)?.[1] ?? "";
  const tokens = clause.match(/\p{L}+/gu) ?? [];
  const verbs = tokens.filter(
    (t) =>
      /^\p{Ll}/u.test(t) &&
      !COPULAS.has(t) &&
      ((/t$/.test(t) && !NOT_FINITE.has(t)) ||
        germanVerbLike(t) ||
        /^(?:fing|gab|bot|nahm|sah|schlug|hielt|ließ|kam|ging|fingen|gaben|hörten)$/.test(t)),
  );
  // "Wir beschlossen an zu fangen": a verb with a fixed prefix leaves no particle behind.
  if (verbs.length > 0 && verbs.every((t) => FIXED_PREFIX.test(t) && germanVerbLike(t))) {
    return true;
  }
  const opened =
    /,[^,]*$/.test(before) ||
    tokens.some((t) => /^(?:um|ohne|statt|anstatt)$/i.test(t)) ||
    CLAUSE_PARTICLES.has(particle);
  return opened && verbs.length === 0;
}
// "beschlossen", "versuchte", "empfahl": a fixed prefix, which no particle splits off.
const FIXED_PREFIX = /^(?:be|ver|er|ent|zer|emp|miss)\p{Ll}{3,}$/u;
// Particles no main verb leaves right before a zu-infinitive ("Er fängt an zu laufen", "Sie
// hat vor zu gehen" do), so they open the infinitive with no comma: "kein Grund los zu
// brüllen", "Ist es gut unter zu gehen?".
const CLAUSE_PARTICLES = wordSet(
  "herab heran herauf heraus herbei herein herüber herum herunter hervor hinab hinauf " +
    "hinaus hinein hinüber hinunter hinweg los unter nieder empor zurecht zu",
);
// Forms of "sein", which takes no particle ("ist kein Grund los zu brüllen").
const COPULAS = wordSet("ist sind war waren bin bist seid wäre wären sei");
// Where the phrase stands: opening the sentence before the clause's verb ("Beim Haare
// schneiden kommen mir …", not "Beim Bäcker kaufen wir Brot", where "kaufen" is the verb), or
// after "für das" at the end of a clause ("Danke für das Korrektur lesen."). "Sie war beim
// Training laufen", "wir gehen zum Essen holen" keep the verb apart.
function phrasePlace(ctx: DetectContext, start: number, end: number, article: boolean): boolean {
  const rest = ctx.text.slice(end, end + 40);
  if (article) {
    // Only thanks for an activity: "mit dem Chef sprechen", "für das Auto zahlen" are a phrase
    // and its verb.
    const thanks = /[Dd]anke?[ \t]+(?:sch(?:ö|oe)n[ \t]+)?für(?:[ \t]+da)?s[ \t]+$/;
    return (
      thanks.test(ctx.text.slice(Math.max(0, start - 30), start)) &&
      /^[ \t]*(?:[,.!?;:)]|(?:mit|für|bei|von|an)[ \t]|$)/.test(rest)
    );
  }
  const opener = ctx.text.slice(Math.max(0, start - 16), start);
  if (!/(?:^|[.!?:\n„"])[ \t]*\p{L}+[ \t]+$/u.test(opener)) return false;
  const next = /^[ \t]+(\p{Ll}+)/u.exec(rest)?.[1] ?? "";
  if (!next || /^(?:die|der|das|den|dem|wir|sie|ich|er|es|man)$/.test(next)) return false;
  if (isAuxiliary(next) || germanVerbLike(next)) return true;
  return /\p{Ll}{2,}e?t$/u.test(next) && germanInfinitive(`${next.replace(/e?t$/, "")}en`);
}
// Verbs that take a noun after "zum" or "beim" as a fixed phrase ("zum Ausdruck bringen",
// "beim Wort nehmen", "zum Opfer fallen").
const LIGHT_VERBS = wordSet(
  "bringen kommen stellen nehmen machen haben werden fallen führen gelangen setzen ziehen " +
    "rufen zwingen bewegen dienen geben halten nennen treiben reichen schicken",
);
// Full verbs that take a bare infinitive of their own ("Wir fahren zum Hafen angeln", "Sie
// lernt beim Meister kochen").
const BARE_INFINITIVE_VERBS = wordSet(
  "gehen fahren kommen laufen lassen sehen hören fühlen spüren bleiben lernen lehren helfen " +
    "schicken legen sein",
);
const FIXES: Readonly<Record<string, Fix>> = {
  wegVerb: (m) => `Weg ${m.groups!.verb}`,
  conjunctionDem: (m) => `${m.groups!.first}dem`,
  soConjunction: (m) => `${m.groups!.first}${m.groups!.second}`,
  zuAdverb: (m, ctx) => {
    const { liebe, gute, folge } = m.groups!;
    const prior = tokensBefore(ctx.text, m.index, 1)[0] ?? "";
    // "ihr zu Liebe", "den Eltern zu Liebe": a dative before it; "kam zu gute", "etwas zu
    // gute kommen": the verb or its object.
    if (
      (liebe || gute) &&
      !/^(?:mir|dir|ihm|ihr|uns|euch|ihnen|Ihnen|\p{Lu}\p{Ll}+n?)$/u.test(prior) &&
      !(gute && /^(?:kam|kamen|kommt|käme|halte|hält|hielt|etwas|nichts|viel|wenig)$/.test(prior))
    )
      return null;
    // "Berichten zu Folge", not "von Folge zu Folge".
    if (folge && (!/^\p{Lu}\p{Ll}+(?:en|n|ung|e)$/u.test(prior) || prior === "Folge")) return null;
    // "zu gute gehalten" → "zugutegehalten": the verb joins too.
    const verb = m.groups!.gverb?.trim() ?? "";
    return liebe ? "zuliebe" : gute ? `zugute${verb}` : folge ? "zufolge" : "zunichte";
  },
  zuJoined: (m, ctx) => {
    const { verb } = m.groups!;
    if (!germanInfinitive(verb) || isAuxiliary(verb) || verb.startsWith("zu")) return null;
    // The main clause before the comma has its verb ("freute", "gelang"); "Bitte, zuhören!"
    // is an instruction.
    const clause = ctx.text
      .slice(Math.max(0, m.index - 80), m.index)
      .split(/[.!?;:\n]/)
      .at(-1)!;
    const words = clause.match(/\p{L}+/gu) ?? [];
    // "Wir sollten, statt zu reden, zuhören": a modal takes the bare infinitive.
    if (words.some((w) => VERB_GOVERNORS.has(w.toLowerCase()))) return null;
    if (words.length < 2 || /!/.test(ctx.text.slice(m.indices!.groups!.target[1]).slice(0, 2))) {
      return null;
    }
    return `zu ${verb}`;
  },
  nominalPhrase: (m, ctx) => {
    const { noun, verb } = m.groups!;
    const low = noun.toLowerCase();
    const [start, end] = m.indices!.groups!.target;
    const prefix = ctx.text.slice(Math.max(0, start - 8), start);
    // "beim Spazieren gehen", "vorm Schlafen gehen", "beim Gassi gehen": "gehen" made a noun
    // with an infinitive, or after "beim"; "Zum Arzt gehen ist wichtig" is a phrase.
    const going = verb === "gehen" && (germanInfinitive(low) || !/zum[ \t]+$/i.test(prefix));
    if (!germanInfinitive(verb) || isAuxiliary(verb) || verb === "lassen") return null;
    if (verb === "gehen" ? !going : germanNounReading(low) === null) return null;
    const article = /(?:d(?:as|em)|fürs)[ \t]+$/i.test(prefix);
    if (phrasePlace(ctx, start, end, article)) return `${noun}${verb}`;
    // "zum Zeitung lesen", "beim Haare schneiden": a noun the contraction cannot take as its
    // dative only heads the phrase made a noun.
    const contraction = /(?<!\p{L})(zum|beim|vom|vorm)[ \t]+$/iu.exec(prefix)?.[1];
    if (contraction && !going && nominalVerb(verb) && determinerFits(contraction, noun) === false) {
      return `${noun}${verb}`;
    }
    // "Wir treffen uns zum Kaffee trinken.": the clause's verb is a full verb, so the
    // infinitive closing it cannot be that verb's ("Ich muss beim Arzt anrufen", "Ich gehe
    // zum Bäcker einkaufen", "Wir bringen es zum Kochen bringen" keep theirs).
    if (going || germanNounReading(low) !== "noun" || LIGHT_VERBS.has(verb)) return null;
    if (!/^[ \t]*(?:[.!?;]|$)/.test(ctx.text.slice(end, end + 4))) return null;
    if (!/(?<!\p{L})(?:zum|beim|fürs)[ \t]+$/iu.test(prefix)) return null;
    const clause =
      ctx.text
        .slice(Math.max(0, start - 80), start)
        .split(/[.!?;:,\n]/)
        .at(-1)!
        .match(/\p{L}+/gu) ?? [];
    const verbs = clause.filter((w) => /^\p{Ll}/u.test(w) && germanVerbLike(w));
    if (verbs.length !== 1 || clause.some((w) => VERB_GOVERNORS.has(w.toLowerCase()))) return null;
    if (BARE_INFINITIVE_VERBS.has(germanInfinitiveOf(verbs[0]) ?? verbs[0])) return null;
    return `${noun}${verb}`;
  },
  selfInfinitive: (m) => {
    const { self, verb } = m.groups!;
    const low = verb.toLowerCase();
    if (!germanInfinitive(low) || isAuxiliary(low)) return null;
    return `${self[0].toUpperCase()}${self.slice(1)}${low}`;
  },
  zulange: (m, ctx) => {
    const clause = ctx.text
      .slice(Math.max(0, m.index - 80), m.index)
      .split(/[.!?;,:\n]/)
      .at(-1)!;
    return /(?<!\p{L})ich(?!\p{L})/iu.test(clause) ? null : "zu lange";
  },
  zuInfinitive: (m, ctx) => {
    const { prev, particle, verb } = m.groups!;
    if (!PARTICLE_SET.has(particle) || !germanInfinitive(verb)) return null;
    // "der Reihe nach zu holen", "von Grund auf zu bauen", "auf und ab zu gehen".
    if (/^(?:Reihe|Grund|und|oder)$/.test(prev)) return null;
    if (!infinitiveClause(ctx, m.indices!.groups!.target[0], particle)) return null;
    // A particle that opens no clause of its own joins even a verb the lexicon lacks
    // ("hinunterzuziehen", "loszubrüllen").
    const known =
      germanInfinitive(particle + verb) || (CLAUSE_PARTICLES.has(particle) && particle !== "zu");
    return known ? `${particle}zu${verb}` : null;
  },
  splitAtEnd: (m, ctx) => {
    const { particle, verb, aux } = m.groups!;
    if (aux && !isAuxiliary(aux)) return null;
    // "von Anfang an gesagt", "von klein auf gelernt": the particle closes "von …".
    const before = tokensBefore(ctx.text, m.index, 3);
    const prior = before.at(-1)?.toLowerCase() ?? "";
    // "das vor geschlagen hatte": an article is the object's, unless the particle is also a
    // noun ("den weg", "das aus").
    const article = /^(?:d|k?ein|mein|dein|sein|ihr|unser)(?:er|ie|as|en|em|es|e)?$/.test(prior);
    if (NOT_PARTICLE_AFTER.has(prior) && !(article && !/^(?:weg|aus|los|teil)$/.test(particle))) {
      return null;
    }
    if (before.some((t) => /^[Vv]on$/.test(t)) || before.at(-1) === "Berg") return null;
    // "hat die Tür zu gemacht": after a form of "haben", "zu" and a participle make one
    // verb; "ist zu gelassen", "wirkte zu gelassen" are "too calm".
    const zuParticiple = particle === "zu" && /^ge(\p{Ll}{2,}?)(?:en|t)$/u.exec(verb);
    if (zuParticiple) {
      const clause =
        ctx.text
          .slice(Math.max(0, m.index - 80), m.index)
          .split(/[.!?;:,\n]/)
          .at(-1)!
          .match(/\p{L}+/gu) ?? [];
      const haben = clause.some((t) =>
        /^(?:hab(?:e|en|t)|hast|hat|hatte\p{Ll}*|hätte\p{Ll}*)$/u.test(t),
      );
      const linking = clause.some(
        (t) => COPULAS.has(t) || /^(?:wirk|schein|schien|bleib|blieb|wird|wurde)\p{Ll}*$/u.test(t),
      );
      // "hatte da nichts zu gesagt": a split "dazu", "wozu".
      const split = clause.some((t) => /^(?:da|wo)$/i.test(t));
      return haben && !linking && !split && !aux && germanInfinitive(`zu${zuParticiple[1]}en`)
        ? `zu${verb}`
        : null;
    }
    return joinsVerb(particle, verb) ? particle + verb : null;
  },
  umZu: (m) => (germanInfinitive(`um${m.groups!.verb}`) ? `umzu${m.groups!.verb}` : null),
  splitInfinitive: (m) => {
    const { particle, verb } = m.groups!;
    const joined = particle + verb;
    return germanInfinitive(verb) && (germanInfinitive(joined) || germanVerbLike(joined))
      ? joined
      : null;
  },
  weekdayTime: (m) => {
    const { day, time } = m.groups!;
    return `${day}${time.toLowerCase()}`;
  },
  numberSuffix: (m) => `${m.groups!.n}-${m.groups!.suffix.toLowerCase()}`,
  // "ein tausendmal größeres Problem": "ein" is the noun's article.
  countTimes: (m, ctx) =>
    m.groups!.count === "ein" &&
    /^[ \t]+\p{Ll}+er(?:e|es|en|er|em)?(?!\p{L})/u.test(
      ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 30),
    )
      ? null
      : m.groups!.count + m.groups!.times,
  unitNoun: (m) =>
    germanNounReading(m.groups!.noun.toLowerCase()) !== null
      ? `${m.groups!.n}-${m.groups!.unit}-${m.groups!.noun}`
      : null,
  klassler: (m) => `${ORDINALS[Number(m.groups!.n) - 1]}klässler${m.groups!.end ?? ""}`,
  acronymNoun: (m) =>
    germanNounReading(m.groups!.noun.toLowerCase()) !== null
      ? `${m.groups!.acronym}-${m.groups!.noun}`
      : null,
  fusedArticle: (m) => `${m.groups!.prep}${m.groups!.article}`,
  emailAny: (m) => `E-Mail${emailRest(m.groups!.rest)}`,
  emailTail: (m) => {
    const { pre, rest } = m.groups!;
    // "Gold-Email", "Kupfer-Email": enamel; only a word that is no material.
    if (/^(?:Gold|Silber|Kupfer|Zinn|Glas|Eisen|Stahl|Feuer)-$/.test(pre)) return null;
    return `${pre}E-Mail${emailRest(rest)}`;
  },
  emailApart: (m) => `E-Mail${m.groups!.rest}`,
  emailNoun: (m) => {
    const noun = m.groups!.noun;
    return `E-Mail-${noun[0].toUpperCase()}${noun.slice(1)}`;
  },
  emailAfter: (m) => `E-Mail${emailRest(m.groups!.rest)}`,
  emails: (m) =>
    ({ Emails: "E-Mails", "E-Mailadresse": "E-Mail-Adresse" })[m.groups!.target] ??
    "E-Mail-Adressen",
  din: (m) => {
    const { size, rest } = m.groups!;
    if (!rest) return `DIN${NBSP}A${size}`;
    const tail = rest.replace(/^[-\s]+/, "");
    return `DIN-A${size}-${tail[0].toUpperCase()}${tail.slice(1)}`;
  },
  addOn: (m) => {
    const plural = /s$/.test(m.groups!.target.replace(/-.*$/, ""));
    return `Add-on${plural ? "s" : ""}${m.groups!.rest ?? ""}`;
  },
};

/** "-adresse" → "-Adresse", "s" stays. */
function emailRest(rest = ""): string {
  if (!rest.startsWith("-")) return rest;
  return `-${rest[1].toUpperCase()}${rest.slice(2)}`;
}

/** The finding of a compound frame: the joined form of the `target` group, in its case. */
const compound =
  (fix: Fix): MatchFixer =>
  (m, ctx) => {
    const typed = m.groups!.target;
    const replacement = fix(m, ctx);
    if (!replacement || replacement === typed || ctx.dictionary.has(typed.toLowerCase()))
      return null;
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "germanCompounds",
      messageKey: "review_msg_closed_compound",
      range: { start, end },
      alternatives: [likeTyped(typed, replacement)],
      context: { start: Math.max(0, start - 40), end: end + 20 },
    };
  };

/** The named frame fixes of the de.compounds rule (grammar/rules/de.yaml). */
export const FIXERS: Readonly<Record<string, MatchFixer>> = {
  ...Object.fromEntries(Object.entries(FIXES).map(([name, fix]) => [name, compound(fix)])),
  nounPair,
};
