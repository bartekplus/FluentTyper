import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { Frame } from "./confusions";
import { germanGender } from "./germanLexicon";
import { anyCase as any, gated as re } from "./shared";

// Fixed phrases with a wrong article, preposition or ending, in frames where only the fix fits
// (run by confusions.ts). Authored frames; the first named group with a value is the typed text.

// The verbs each idiom needs somewhere in its sentence, and its fix (authored).
type IdiomFix = string | ((typed: string) => string[]);
/** A verb's forms from its stems: a stem with a verb ending, or a participle with "ge-". */
const verb = (stems: string) =>
  new RegExp(`(?<!\\p{L})(?:ge)?(?:${stems})(?:e|st|t|te|test|ten|tet|en|est|et)?(?!\\p{L})`, "iu");
const HALTEN = verb("halt|hält|hielt");
const IDIOM_VERBS: Readonly<Record<string, [RegExp, IdiomFix]>> = {
  Punkt: [verb("bring|bracht|bräch"), "den"],
  Kopf: [verb("stell"), "den"],
  Plan: [verb("ruf|rief"), "den"],
  PlanBare: [verb("ruf|rief"), "auf den Plan"],
  Teppich: [verb("kehr"), "den"],
  Leim: [
    verb("geh|ging|gangen"),
    (typed) => [`${typed.slice(0, 3)} den`, `${typed[0] === "A" ? "Aus" : "aus"} dem`],
  ],
  Strömen: [verb("regn|gieß|goss|gossen|schütt"), "in"],
  Schach: [HALTEN, "in"],
  Strang: [verb("zieh|zog|zogen"), "einem"],
  Strenge: [verb("schlag|schlug|schläg|schlagen"), "Stränge"],
  Zaun: [HALTEN, "Zaum"],
  Zaum: [verb("brech|brach|brich|brochen"), "Zaun"],
  Angriff: [verb("nehm|nimm|nahm|nommen"), "in Angriff"],
  Auge: [verb("behalt|behält|behielt|fass|fasst"), "im"],
};

// A word start inside a lookbehind: "an" is no part of "kann".
const B = "(?<![\\p{L}\\p{M}])";

// Finite forms of verbs whose one object is a dative (authored).
const DATIVE_VERBS =
  "helfe hilfst hilft helft helfen half halfen geholfen danke dankst dankt danken dankte " +
  "dankten gedankt vertraue vertraust vertraut vertrauen vertraute vertrauten gratuliere " +
  "gratulierst gratuliert gratulieren gratulierte gratulierten begegne begegnest begegnet " +
  "begegnen begegnete begegneten gefällt gefiel gefielen gehören gehörten " +
  "widerspreche widersprichst widerspricht widersprechen widersprach widersprachen";

/** The sentence around a match, cut at its ends or 200 characters away. */
function sentenceAround(m: RegExpExecArray): string {
  const text = m.input;
  const head = text.slice(Math.max(0, m.index - 200), m.index);
  const start = Math.max(...[".", "!", "?", "\n"].map((c) => head.lastIndexOf(c))) + 1;
  const tail = text.slice(m.index, m.index + 200);
  const end = /[.!?\n]/.exec(tail.slice(1))?.index ?? tail.length;
  return head.slice(start) + tail.slice(0, end + 2);
}

export const IDIOM_FRAMES: readonly Frame[] = [
  // Idioms whose noun needs one verb in the sentence: "auf dem Punkt bringen" (den), "unter
  // dem Teppich kehren" (den), "auf dem Leim gehen" (auf den, or aus dem), "im Strömen
  // regnen" (in), "im Schach halten" (in), "an einen Strang ziehen" (einem), "über die Strenge
  // schlagen" (Stränge), "im Zaun halten" (Zaum), "vom Zaum brechen" (Zaun), "in den Angriff
  // nehmen" (in Angriff), "auf Plan rufen" (auf den Plan).
  {
    regex: re(
      `(?<=${B}(?:[Aa]uf|[Uu]nter)${S})(?<target>dem)(?=${S}(?<noun>Punkt|Kopf|Plan|Teppich)${E})|` +
        `(?<t2>[Aa]uf${S}dem)(?=${S}Leim${E})|` +
        `(?<t3>im)(?=${S}(?:Strömen|Schach)${E})|` +
        `(?<=${B}an${S})(?<t4>einen)(?=${S}Strang${E})|` +
        `(?<=${B}über${S}die${S})(?<t5>Strenge)${E}|` +
        `(?<=${B}im${S})(?<t6>Zaun)${E}|(?<=${B}vom${S})(?<t7>Zaum)${E}|` +
        `(?<t8>in${S}den${S}Angriff)${E}|` +
        `(?<t9>[Aa]uf${S}Plan)(?=${S}(?:\\p{Ll}+${S}){0,2}(?:ge)?ruf)`,
    ),
    fix: (m) => {
      const g = m.groups!;
      const after = m.input.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const key =
        g.noun ??
        (g.t2
          ? "Leim"
          : g.t3
            ? /^\s*Schach/.test(after)
              ? "Schach"
              : "Strömen"
            : g.t4
              ? "Strang"
              : g.t5
                ? "Strenge"
                : g.t6
                  ? "Zaun"
                  : g.t7
                    ? "Zaum"
                    : g.t8
                      ? "Angriff"
                      : "PlanBare");
      const [verb, fix] = IDIOM_VERBS[key];
      if (!verb.test(sentenceAround(m))) return null;
      return typeof fix === "string" ? fix : fix(g.t2);
    },
  },
  // "Das sollten wir in Auge behalten" → im ("Auge in Auge" stays).
  {
    regex: re(`(?<!Auge${S})(?<target>in)(?=${S}Auge${E}(?!${S}(?:in|und|um)${E}))`),
    fix: (m) => (IDIOM_VERBS.Auge[0].test(sentenceAround(m)) ? "im" : null),
  },
  // "zu meinen Bedauern" → meinem: "zu" takes the dative of a neuter feeling.
  {
    regex: re(
      `(?<=${B}[Zz]u${S})(?<target>(?:mein|dein|sein|ihr|unser|eur|Ihr)en)(?=${S}(?:Bedauern|Erstaunen|Entsetzen|Leidwesen|Glück|Unglück|Vergnügen|Ärger|Verdruss|Missfallen|Wohl)${E})`,
    ),
    fix: (m) => `${m.groups!.target.slice(0, -1)}m`,
    ownCase: true,
  },
  // "vom Ihnen", "zum mir", "beim uns": a contraction holds an article no pronoun takes. "vom
  // ihm gegenüberliegenden Wert": the article belongs to a noun after the pronoun's adjective.
  {
    regex: re(
      `(?<target>[Vv]om|[Zz]um|[Bb]eim)(?=${S}(?:mir|dir|ihm|uns|euch|ihnen|Ihnen)${E}(?!${S}\\p{Ll}+(?:e|en|em|er|es)${S}\\p{Lu}))`,
    ),
    fix: (m) => ({ vom: "von", zum: "zu", beim: "bei" })[m.groups!.target.toLowerCase()]!,
  },
  // "auf den Laufenden", "aus den Vollen" → dem: the idiom's noun is a singular adjective.
  {
    regex: re(
      `(?<=${B}(?:[Aa]uf)${S})(?<target>den)(?=${S}Laufenden${E}(?!${S}\\p{Lu}))|(?<=${B}(?:[Aa]us)${S})(?<t2>den)(?=${S}Vollen${E}(?!${S}\\p{Lu}))`,
    ),
    fix: "dem",
  },
  // "aus mehrere Sprachen" → mehreren; "in mehren Ländern" → mehreren: a dative plural ("zu
  // viele Fragen" is "too many").
  {
    regex: re(
      `(?<=${B}(?:[Aa]us|[Mm]it|[Vv]on|[Bb]ei|[Ss]eit|[Nn]ach|[Ss]amt|[Gg]egenüber)${S})(?<target>(?:mehrer|einig|viel|wenig|verschieden|zahlreich|ander|beid)e)(?=${S}(?<noun>\\p{Lu}\\p{Ll}+n)${E})|` +
        `(?<=${B}(?:[Ii]n|[Aa]us|[Mm]it|[Vv]on|[Bb]ei|[Zz]u|[Ss]eit|[Nn]ach|[Aa]n|[Aa]uf|[Uu]nter|[Vv]or)${S})(?<t2>mehren)(?=${S}\\p{Lu}\\p{Ll}+${E})`,
    ),
    fix: (m) => {
      if (m.groups!.t2) return "mehreren";
      // A singular noun in -n ("mit andere Garten") needs another ending.
      return germanGender(m.groups!.noun.toLowerCase())?.plural === false
        ? null
        : `${m.groups!.target}n`;
    },
  },
  // "ein anders Bild" → anderes, "kein anders Mann" → anderer: "anders" is the adverb.
  {
    regex: re(
      `(?<=${B}(?:[Ee]in|[Kk]ein)${S}(?:\\p{Ll}+${S})?)(?<target>anders)(?=${S}(?<noun>\\p{Lu}\\p{Ll}+)${E})`,
    ),
    fix: (m) => {
      const gender = germanGender(m.groups!.noun.toLowerCase());
      if (!gender || gender.plural) return null;
      return gender.gender === "n" ? "anderes" : gender.gender === "m" ? "anderer" : null;
    },
  },
  // "in deutsche Sprache" → deutscher: the language is named in the dative ("in die deutsche
  // Sprache übersetzen" needs its article, so a translation is left alone).
  {
    regex: re(`(?<=${B}[Ii]n${S})(?<target>\\p{Ll}{2,}sche)(?=${S}Sprache${E})`),
    fix: (m) => (/übersetz/.test(sentenceAround(m)) ? null : `${m.groups!.target}r`),
  },
  // "seit Anfang an", "vom Beginn an", "seit klein auf" → von: the phrase counts from a start.
  {
    regex: re(
      `(?<target>[Ss]eit|[Vv]om)(?=${S}(?:Anfang|Beginn|Geburt|Kindheit|Kindesbeinen|Jugend)${S}an${E}|${S}(?:klein|Grund|Kind)${S}auf${E})`,
    ),
    fix: "von",
  },
  // "Mein Hertz schlug" → Herz; "mit 50 Herz" → Hertz.
  {
    regex: re(
      `(?<=${B}(?:[Mm]ein|[Dd]ein|[Ss]ein|[Ii]hr|[Uu]nser|[Dd]em|[Ii]m|[Vv]om|[Gg]anzem|[Gg]anzes|[Gg]roßes)${S})(?<target>Hertz)${E}|` +
        `(?<=${B}\\d${S})(?<t2>Herz)${E}`,
    ),
    fix: (m) => (m.groups!.t2 ? "Hertz" : "Herz"),
  },
  // "wehrend der Fahrt", "währen des Spiels" → während: a preposition before its article.
  {
    regex: re(
      `(?<target>[Ww]ehrend|[Ww]ähren|[Ww]ährenden)(?=${S}(?:der|des|dieser|dieses|meiner|meines|seiner|seines|ihrer|ihres|unserer|unseres|eines|einer)${E})`,
    ),
    fix: "während",
  },
  // "Er ist zur Zeit krank" → zurzeit (now); "zur Zeit der Römer" names a time.
  {
    regex: re(
      `(?<target>[Zz]ur${S}Zeit)(?=${S}(?:krank|nicht|noch|leider|sehr|kein|keine|keinen|nur|beschäftigt|unterwegs|verfügbar|erreichbar|ausgebucht|geschlossen|geöffnet|arbeitslos)${E})`,
    ),
    fix: "zurzeit",
  },
  // "Das macht kein Sinn", "hat kein Sinn für" → keinen: "Sinn" is the accusative object.
  {
    regex: re(
      `(?<=${B}(?:${any("macht machen machte ergibt ergeben ergab hat haben hatte habe")})(?:${S}(?:es|das|doch|ja|absolut|überhaupt|gar|wirklich|echt|einfach|hier|so|halt)){0,2}${S})(?<target>kein)(?=${S}Sinn${E})`,
    ),
    fix: "keinen",
  },
  // "Er ist zu Hause gekommen" → nach: a motion to one's home.
  {
    regex: re(
      `(?<target>zu)(?=${S}Hause${S}(?:gegangen|gekommen|gefahren|gelaufen|geflogen|gehen|kommen|fahren|laufen|fliegen|geht|kommt|fährt|läuft|gehe|komme|fahre)[ \\t]*[.!?,;])`,
    ),
    fix: "nach",
  },
  // "an Herr Schmidt", "mit Herr Meier" → Herrn: after a preposition the title is no nominative.
  {
    regex: re(
      `(?<=${B}(?:${any("an zu mit von bei für über gegen ohne durch um nach vor neben hinter aus seit")})${S})(?<target>Herr)(?=${S}\\p{Lu}\\p{Ll}+${E})`,
    ),
    fix: "Herrn",
  },
  // "An Montag", "an letzten Dienstag" → am: a weekday takes the article.
  {
    regex: re(
      `(?<target>[Aa]n)(?=${S}(?:(?:letzten|nächsten|kommenden|vergangenen|übernächsten|vorigen)${S})?(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonnabend|Sonntag|Wochenende)${E})`,
    ),
    fix: "am",
  },
  // "Ich vertraue ihn", "Das gefällt mich", "Wie hilft dich das?" → ihm, mir, dir: verbs whose
  // one object is a dative (authored). "Ich vertraue ihn dir an" (anvertrauen) stays.
  {
    regex: re(
      `(?<=${B}(?<noun>${any(DATIVE_VERBS)})${S})(?<target>ihn|mich|dich)${E}(?!${S}(?:zu|selbst)${E})`,
    ),
    fix: (m) =>
      /(?<!\p{L})(?:an|zu|nach|vor|bei|mit|ab|aus|ein|hinterher)[ \t]*[.!?,;:]/u.test(
        sentenceAround(m),
      )
        ? null
        : { ihn: "ihm", mich: "mir", dich: "dir" }[m.groups!.target]!,
  },
];
