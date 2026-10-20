import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { germanAdjective, germanGender, germanInfinitive } from "./germanLexicon";

// Fixed phrases whose words change case: a word that is a noun only in the phrase ("die
// Schuld", "im Ernst", "in den Arm", "zum Dank", "ein Riesenerfolg") and a noun that is an
// adverb or adjective in it ("mir ist es recht", "nach links", "mir ist angst", "ernst
// nehmen", "zu Recht" against "zurechtkommen").

// Verbs "zurecht" belongs to: zurechtkommen, -legen, -finden, -machen, -rücken, -weisen.
const ZURECHT_VERBS =
  /(?<!\p{L})(?:ge)?(?:komm|kam|käm|leg|find|fand|fänd|mach|rück|weis|wies|stell|schneid|schnitt|bieg|bog|setz|zupf|richt)\p{Ll}*/u;

type Fix = (m: RegExpExecArray, ctx: DetectContext) => string | string[] | null;

const cap = (word: string) => word[0].toUpperCase() + word.slice(1);
// Nouns of fixed noun-and-verb phrases that are lowercase only as a slip, and their verbs'
// stems (authored).
const NEHMEN = /^(?:nehm|nimm|nahm|nähm|genommen)/;
const COLLOCATIONS: Readonly<Record<string, RegExp>> = {
  abstand: NEHMEN,
  abschied: NEHMEN,
  anteil: NEHMEN,
  bezug: NEHMEN,
  einfluss: NEHMEN,
  kenntnis: NEHMEN,
  rücksicht: NEHMEN,
  stellung: NEHMEN,
  folge: /^(?:leist|geleistet)/,
  widerstand: /^(?:leist|geleistet)/,
  beistand: /^(?:leist|geleistet)/,
  nutzen: /^(?:zieh|zog|zög|gezogen)/,
  bilanz: /^(?:zieh|zog|zög|gezogen)/,
  bescheid: /^(?:geb|gib|gab|gäb|gegeben|sag|gesagt|weiß|wiss|wusst|gewusst)/,
  rechnung: /^(?:trag|träg|trug|trüg|getragen)/,
  abhilfe: /^(?:schaff|schuf|geschaffen)/,
  rücksprache: /^(?:halt|hält|hielt|gehalten)/,
};
// Languages, which are nouns after "ist": "Das ist Englisch".
const LANGUAGES =
  /(?:deutsch|^englisch|französisch|spanisch|italienisch|russisch|polnisch|türkisch|griechisch|chinesisch|japanisch|arabisch|niederländisch|schwedisch|portugiesisch|latein)$/;

/** The rest of the clause after the match, to the next stop. */
const clauseRest = (ctx: DetectContext, m: RegExpExecArray) =>
  ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 120).split(/[.!?;,:\n]/)[0];
const clauseBefore = (ctx: DetectContext, m: RegExpExecArray) =>
  ctx.text
    .slice(Math.max(0, m.index - 120), m.index)
    .split(/[.!?;,:\n]/)
    .at(-1) ?? "";

const FIXES: Readonly<Record<string, Fix>> = {
  // "das importieren der Klassen", "beim erstellen einfacher Regeln": an infinitive after an
  // article with a genitive after it is a noun.
  idiomCase1: (m, ctx) => {
    const word = m.groups!.target;
    if (
      !germanInfinitive(word) ||
      /^(?:sein|haben|werden|können|müssen|sollen|wollen|dürfen)$/.test(word)
    )
      return null;
    // "Das sagen der Lehrer und …": "das" opening a clause may be the subject pronoun, so
    // "der" counts only after a preposition or contraction.
    const next = /^[ \t]+(\p{L}+)/u.exec(ctx.text.slice(m.index + word.length))?.[1];
    const before = ctx.text.slice(Math.max(0, m.index - 40), m.index);
    if (next === "der" && /(?:^|[.!?:\n„"])[ \t]*[Dd]as[ \t]+(?:\p{Ll}+[ \t]+)?$/u.test(before))
      return null;
    return cap(word);
  },
  // "beim Suchen und finden", "ein Kennenlernen oder treffen": a lowercase infinitive joined
  // to one made a noun.
  idiomCase2: (m, ctx) => {
    const word = m.groups!.target;
    const noun = /(\p{Lu}\p{Ll}+)[ \t]+\S+[ \t]+$/u.exec(
      ctx.text.slice(Math.max(0, m.index - 60), m.index),
    )?.[1];
    if (!noun || !germanInfinitive(noun.toLowerCase()) || !germanInfinitive(word)) return null;
    return cap(word);
  },
  // "Die Uhr ist nichts Wert", "was das Wert ist": the adjective "wert".
  idiomCase3: (m, ctx) => {
    // "Darauf lege ich viel Wert.": the noun after "legen"; the adjective needs "sein".
    const clause = ctx.text
      .slice(Math.max(0, m.index - 60), m.index)
      .split(/[.!?;,\n]/)
      .at(-1)!;
    const after = /^[ \t]+(?:ist|sind|war|waren|sein|wäre|wären|scheint)(?!\p{L})/u.test(
      ctx.text.slice(m.index + 4, m.index + 16),
    );
    if (
      !after &&
      !/(?<!\p{L})(?:ist|sind|war|waren|wäre|wären|bin|bist|seid)(?!\p{L})/u.test(clause)
    )
      return null;
    return "wert";
  },
  // "bis spät Abends" → spätabends; "Wir essen Abends" → abends: the adverbs of the time of day
  // are lowercase ("eines Abends", "des Morgens" are nouns).
  idiomCase4: (m) => {
    if (m.groups!.t2) return m.groups!.t2.toLowerCase();
    const time = m.groups!.time.toLowerCase().replace(/(?<!s)$/, "s");
    return `${m.groups!.degree}${time}`;
  },
  // "Der angestellte wurde entlassen", "Die jugendlichen benahmen sich": a person named by an
  // adjective or participle, before the clause's verb.
  idiomCase5: (m) => cap(m.groups!.target),
  // "Angst und schrecken verbreiten" → Angst und Schrecken.
  idiomCase6: () => "Angst und Schrecken",
  // "Hey liebes,", "Hallo ihr lieben": the addressed person is a noun.
  idiomCase7: (m) => cap(m.groups!.target),
  // "zu ehren der Gäste", "zur ehre Gottes", "in ehren": the noun "Ehre".
  idiomCase8: (m) => cap(m.groups!.target ?? m.groups!.t2),
  // "Ich mache mir sorgen", "sich keine sorgen machen": the noun "Sorgen".
  idiomCase9: (m, ctx) => {
    // "weil sie sich sorgen.": a verb at the end of a clause after "sich".
    const before = ctx.text
      .slice(Math.max(0, m.index - 80), m.index)
      .split(/[.!?;,\n]/)
      .at(-1)!;
    const ending = /^[ \t]*[.!?,;]/.test(ctx.text.slice(m.index + m[0].length));
    if (
      ending &&
      !/(?<!\p{L})(?:mach\p{L}*|gemacht|habe|hast|hat|haben|keine|viele|andere)(?!\p{L})/iu.test(
        before,
      )
    )
      return null;
    return "Sorgen";
  },
  // "abstand nehmen", "folge leisten", "nutzen ziehen", "bescheid geben": the noun of a fixed
  // noun-and-verb phrase, right before its verb or after it with at most two words between.
  idiomCase10: (m) => {
    const typed = m.groups!.target ?? m.groups!.t2;
    // The verb must be the noun's own: "abstand nehmen", not "abstand halten" (a "Abstand"
    // too, but checked by other frames) or "folge geben".
    const words = (text: string) => (text.match(/\p{L}+/gu) ?? []).map((w) => w.toLowerCase());
    const near = [
      ...words(m.input.slice(Math.max(0, m.index - 40), m.index)).slice(-3),
      ...words(m.input.slice(m.index + typed.length, m.index + typed.length + 40)).slice(0, 3),
    ];
    const own = COLLOCATIONS[typed.toLowerCase()];
    return near.some((w) => own.test(w)) ? cap(typed) : null;
  },
  // "zur neige gehen", "im schnitt", "das weite suchen", "einen gefallen tun": a noun in a fixed
  // phrase that is a verb or adjective form elsewhere.
  idiomCase11: (m) => cap(m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4),
  // "um Gottes Willen", "um des Friedens Willen" → willen: the preposition "um … willen" with a
  // genitive between ("um den Willen" is the noun).
  idiomCase12: () => "willen",
  // "Er war Zeit seines Lebens …" → zeit: the preposition "zeit" before "meines Lebens"; at
  // a sentence start, or after a determiner, quantity or adjective ("die schönste Zeit meines
  // Lebens", "viel Zeit meines Lebens"), it stays the noun.
  idiomCase13: (m) => {
    const prior = /(\p{L}+)\s+$/u.exec(m.input.slice(Math.max(0, m.index - 30), m.index))?.[1];
    const lower = prior?.toLowerCase() ?? "";
    const attribute =
      /^(?:viel|wenig|etwas|mehr|genug|zur|zu|in|von|seit|aus|bei|mit|nach|für|um)$/.test(lower) ||
      (/(?:e|en|er|es|em)$/.test(lower) &&
        !/^(?:habe|hatte|hatten|wurde|wurden|waren|haben|sie|wie|ihre?|dies|es)$/.test(lower) &&
        !/[^s]ten?$/.test(lower));
    return !prior || attribute ? null : "zeit";
  },
  // "mitten im nichts", "im nirgendwo": the nouns "Nichts" and "Nirgendwo".
  idiomCase14: (m) => cap(m.groups!.target),
  // "vor ärger", "mit bedauern", "zu unserem bedauern": the nouns "Ärger" and
  // "Bedauern" ("es wird immer ärger" is the comparative).
  idiomCase15: (m) => cap(m.groups!.target ?? m.groups!.t2),
  // "außer acht lassen", "sich in acht nehmen": the noun "Acht".
  idiomCase16: () => "Acht",
  // "Das tut mir Leid" → leid ("leidtun"); "Leid tun" → leidtun.
  idiomCase17: (m) => (m.groups!.target ? "leid" : "leidtun"),
  // "jedes mal", "beim nächsten mal", "ein für alle mal", "die letzten male": the noun "Mal"
  // after a determiner or an ordinal; "von Mal zu Mal", "Mal für Mal".
  idiomCase18: (m, ctx) => {
    // "von mal zu mal": only after "von" ("komm mal zu mir" is the particle).
    const zu = /^[ \t]+zu/.test(ctx.text.slice(m.index + m[0].length));
    const von = /(?<!\p{L})[Vv]on[ \t]+$/u.test(ctx.text.slice(Math.max(0, m.index - 6), m.index));
    if (m.groups!.t2 && zu && !von) return null;
    return cap(m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4);
  },
  // "mit ja antworten", "ein klares nein": the answer as a noun.
  idiomCase19: (m, ctx) => {
    // The word before must be "mit", an article or an inflected adjective after one.
    const before = ctx.text.slice(Math.max(0, m.index - 40), m.index);
    if (
      !/(?:[Mm]it|[Ee]in(?:e[mn]?)?|[Kk]ein|(?<=\p{L}[ \t]+)(?:Ja|Nein)[ \t]+(?:oder|und))[ \t]+(?:\p{Ll}+(?:es|en)[ \t]+(?:und[ \t]+\p{Ll}+(?:es|en)[ \t]+)?)?$/u.test(
        before,
      )
    )
      return null;
    return cap(m.groups!.target);
  },
  // "Ich bin sehr Stolz auf euch", "Das ist nicht Fair.": a predicative adjective stays
  // lowercase.
  idiomCase20: (m) => {
    const word = m.groups!.target;
    const low = word.toLowerCase();
    if (!germanAdjective(low) || LANGUAGES.test(low)) return null;
    // "Das ist Stolz.": with no degree word only a preposition after it ("stolz auf")
    // shows the adjective.
    const preposition = /^[ \t]+\p{Ll}/u.test(m.input.slice(m.index + m[0].length));
    if (!m.groups!.degree && (!preposition || germanGender(word))) return null;
    return low;
  },
  // "die Rechte dritter", "an dritte weitergeben", "am ersten jedes Monats", "der erste, der
  // …": ordinals as nouns.
  idiomCase21: (m, ctx) => {
    const word = m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4;
    if (m.groups!.t4) {
      // "die erste, die zweite und …", "die erste, das Gebiet umfassende …": an enumeration
      // or an attribute, not a relative clause of the same gender.
      const article = /(\p{L}+)[ \t]+$/u.exec(
        m.input.slice(Math.max(0, m.index - 8), m.index),
      )?.[1];
      const next =
        /^,[ \t]+\p{L}+[ \t]+(\p{L}+)/u.exec(m.input.slice(m.index + m[0].length))?.[1] ?? "";
      if (article?.toLowerCase() !== m.groups!.relative || /^\p{Ll}+e[nmrs]?$/u.test(next))
        return null;
      // "Von den Zügen ist der erste, der …": a noun earlier in the sentence it may refer to.
      const sentence = ctx.text
        .slice(Math.max(0, m.index - 120), m.index)
        .split(/[.!?\n]/)
        .at(-1)!;
      if (/[ \t]\p{Lu}/u.test(sentence)) return null;
    }
    return cap(word);
  },
  // "die schuld", "keine schuld", "deine schuld": the noun; "ist Schuld daran": the adjective.
  idiomCase22: () => "Schuld",
  idiomCase23: () => "schuld",
  // "mein ernst", "im ernst", "ernst machen"; "Ernst nehmen", "Ernst gemeint".
  idiomCase24: () => "Ernst",
  idiomCase25: () => "Ernst",
  idiomCase26: () => "ernst",
  // "Nimm das Ernst." → ernst: the verb before it.
  idiomCase27: (m, ctx) =>
    /(?<!\p{L})(?:nimm|nimmt|nehme|nehmen|nehmt|nahm|nahmen)(?!\p{L})/iu.test(clauseBefore(ctx, m))
      ? "ernst"
      : null,
  // "in den arm", "im arm", "mit offenen armen", "arm in Arm".
  idiomCase28: () => "Arm",
  idiomCase29: () => "Armen",
  idiomCase30: (m) => (m.groups!.target.includes("arm") ? "Arm in Arm" : null),
  // "zum dank", "der dank", "vielen dank", "Gott sei dank", "zu dank verpflichtet".
  idiomCase31: () => "Dank",
  idiomCase32: () => "Dank",
  // "nach Links abbiegen", "von Links nach rechts", "mit Links." → links; "eine Seite mit
  // Links zum Thema", "der Blick nach Rechts ist …" (a name) stay.
  idiomCase33: (m) =>
    (m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4).toLowerCase(),
  // "mir ist Recht", "es geschah ihm Recht", "Recht und billig", "alles Recht machen".
  idiomCase34: (m, ctx) => {
    const clause = clauseBefore(ctx, m);
    // "Sie kennt ihr Recht": "ihr" is the possessive unless a form of "sein" makes it dative.
    const possessive =
      /(?<!\p{L})ihr[ \t]+$/u.test(clause) &&
      !/(?<!\p{L})(?:ist|war|wäre|sei|sein)(?!\p{L})/u.test(
        clause + ctx.text.slice(m.index, m.index + 30),
      );
    return possessive ||
      /\b(?:haben|hat|hast|habe|hatte|gibt|gab|geben|gegeben|gebe|gebt|gib)\b/.test(clause)
      ? null
      : "recht";
  },
  idiomCase35: () => "recht",
  idiomCase36: () => "recht",
  idiomCase37: () => "recht",
  idiomCase38: () => "recht",
  // "Das ist mir Wurst!", "Das kann ihm doch Wurscht sein": "egal" is lowercase; "Das ist
  // Wurst." with no one it is egal to may be the food.
  idiomCase39: (m) => m.groups!.target.toLowerCase(),
  // "Er stand Kopf.", "Ich nehme daran nicht Teil.": the particle of "kopfstehen" and
  // "teilnehmen" closing a main clause ("den Teil", "am Kopf" are nouns).
  idiomCase40: (m, ctx) => {
    // "den großen Teil", "mit dem Kopf": an inflected adjective before it ("gerne" is none).
    const prior = /(?<!\p{L})(\p{Ll}+)[ \t]+$/u.exec(
      ctx.text.slice(Math.max(0, m.index - 24), m.index),
    );
    const stem = prior?.[1].replace(/e[mnrs]?$/, "") ?? "";
    const adjective = germanAdjective(stem) || /\p{Ll}{2}(?:e?s|ß)t$/u.test(stem);
    if (prior && stem !== prior[1] && adjective && !/^(?:gern|lang)$/.test(stem)) return null;
    return (m.groups!.target ?? m.groups!.t2).toLowerCase();
  },
  // "ich bin ihr Gram" → gram.
  idiomCase41: () => "gram",
  // "mir ist Angst und Bange" → angst und bange; "macht mir angst und bange" → Angst und Bange.
  idiomCase42: (m) => {
    const typed = m.groups!.target ?? m.groups!.t2;
    const fixed = m.groups!.t2 ? "Angst und bange" : typed.toLowerCase();
    return typed === fixed ? null : fixed;
  },
  idiomCase43: (m) =>
    /^Angst\s+und\s+Bange$/.test(m.groups!.target ?? m.groups!.t2) ? null : "Angst und Bange",
  // "ein riesen Dank", "eine Riesen Freude" → "Riesendank", "Riesen-Freude".
  idiomCase44: (m) => [`Riesen${m.groups!.noun.toLowerCase()}`, `Riesen-${m.groups!.noun}`],
  // "behauptet zurecht" → zu Recht; "kommt zu recht" → zurecht.
  idiomCase45: (m, ctx) => {
    const rest = clauseRest(ctx, m);
    // "zu recht kleinen Stücken": "recht" is "quite" before an adjective.
    const next = /^\s*(\p{L}+)/u.exec(rest)?.[1] ?? "";
    const adjective = germanAdjective(next) || /\p{Ll}{2}(?:e|en|er|es|em)$/u.test(next);
    if (/^\p{Ll}/u.test(next) && adjective && !ZURECHT_VERBS.test(next)) return null;
    const clause = `${clauseBefore(ctx, m)} ${rest}`;
    const verb = ZURECHT_VERBS.test(clause);
    if (m.groups!.target === "zurecht") return verb ? null : "zu Recht";
    return verb ? "zurecht" : "zu Recht";
  },
  // "bis ende Januar", "ende des Jahres", "kein ende", "zu ende", "ende gut": the noun; "das
  // ende ich jetzt" is the verb.
  idiomCase46: () => "Ende",
  // "auf dem weg", "aus dem weg", "über den weg", "den weg zeigen": the noun.
  idiomCase47: () => "Weg",
  // "ein schönes paar", "ein zusätzliches paar Augen": "Paar" after an inflected adjective.
  idiomCase48: () => "Paar",
  // "keine kosten und mühen scheuen", "weder kosten noch mühen": both nouns of the idiom.
  idiomCase49: (m) => cap(m.groups!.target ?? m.groups!.t2),
  // "auf dem gewissen haben", "mit meinem gewissen vereinbaren", "das schlechte gewissen":
  // the noun, with no noun after it that the adjective "gewiss" could qualify.
  idiomCase50: () => "Gewissen",
  // "das nachsehen haben": the loser's share, a noun before a form of "haben".
  idiomCase51: () => "Nachsehen",
  // "im aus", "ins aus gerollt", "das aus für": the noun.
  idiomCase52: () => "Aus",
  // "das ewige hin und her", "ein ständiges auf und ab": a pair made a noun after an article
  // or an adjective.
  idiomCase53: (m) => {
    // "Die Bäume schwanken hin und her": a verb before it, not an adjective.
    const prior = /(\p{L}+)[ \t]+$/u.exec(m.input.slice(Math.max(0, m.index - 30), m.index))![1];
    const stem = prior.replace(/(?:e|en|em|es)$/, "");
    if (
      !/^(?:[Dd](?:as|em|es)|[Dd]ies(?:es|em)|[Ee]in(?:em|es)?)$/.test(prior) &&
      !germanAdjective(stem)
    )
      return null;
    return m.groups!.target.replace(/\p{L}+/gu, (w) => (w === "und" ? w : cap(w)));
  },
  // "durch Dick und dünn", "über Kurz oder lang", "von Klein auf", "von Nah und fern", "auf
  // Ewig": the adjectives of these fixed pairs stay lowercase.
  idiomCase54: (m) =>
    (m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4).toLowerCase(),
  // "sich sorgen machen", "viele sorgen bereitet", "fragen stellen", "bei bedarf", "auf dem
  // hinweg": plural nouns before their verbs and nouns after a preposition. "Sie sorgen sich",
  // "wir fragen ihn", "der Text bedarf einer Kürzung" keep the verb.
  idiomCase55: (m) =>
    cap(m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4 ?? m.groups!.t5),
  // "nach seinem aus bei Volkswagen": the noun after a possessive or "dem".
  idiomCase56: () => "Aus",
  // "die Farbe rot", "das blaue vom Himmel", "das gelbe vom Ei": a color named as a noun.
  idiomCase57: (m) => cap(m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3),
  // "Danke an Alle", "euch Allen", "ist Alles dabei": the pronoun is lowercase inside a
  // sentence.
  idiomCase58: (m) => (m.groups!.target ?? m.groups!.t2).toLowerCase(),
  // "meine ehe", "aus erster ehe", "ehe und Familie", "kein wunder", "wahre wunder": nouns.
  // "ehe er kam" is the conjunction; "wunder was", "es nimmt mich wunder" and the adjective
  // "ein wunder Punkt" stay lowercase.
  idiomCase59: (m) => cap(m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3),
  // "Der Laden hat Montags geschlossen" → montags; "eines dienstags" → Dienstags.
  idiomCase60: (m) => (m.groups!.target ? m.groups!.target.toLowerCase() : cap(m.groups!.t2)),
  // "Sie bekam eine drei in Physik": a school grade is a noun.
  idiomCase61: (m) => cap(m.groups!.target),
};

/** The findings of the idiom frames: the noun casing filter reads their ends. */
export const IDIOM_FINDINGS = new WeakSet<RawFinding>();

/** The finding of an idiom frame: the fix of the first typed group ("target", "t2"–"t5"). */
const idiomCase =
  (fix: Fix): MatchFixer =>
  (m, ctx, frame) => {
    const name = ["target", "t2", "t3", "t4", "t5"].find((k) => m.groups![k] !== undefined)!;
    const [start, end] = m.indices!.groups![name];
    const typed = m.groups![name];
    if (ctx.dictionary.has(typed.toLowerCase()) || namedExampleBefore(ctx.text, start)) return null;
    const fixed = fix(m, ctx);
    const replacements = fixed === null ? [] : [fixed].flat().filter((r) => r !== typed);
    if (replacements.length === 0) return null;
    const finding: RawFinding = {
      ruleId: "germanNounCasing",
      messageKey: frame.messageKey,
      range: { start, end },
      alternatives: replacements,
      ...(replacements.length > 1 ? { requiresChoice: true as const } : {}),
      context: { start: Math.max(0, start - 40), end: Math.min(ctx.text.length, end + 40) },
    };
    IDIOM_FINDINGS.add(finding);
    return finding;
  };

/** The named frame fixes of the idiom frames of the de.nounCasing rule (grammar/rules/de.yaml). */
export const FIXERS: Readonly<Record<string, MatchFixer>> = Object.fromEntries(
  Object.entries(FIXES).map(([name, fix]) => [name, idiomCase(fix)]),
);
