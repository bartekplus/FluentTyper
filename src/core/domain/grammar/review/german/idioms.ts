import { namedExampleBefore } from "../exampleCues";
import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";
import { germanAdjective, germanGender, germanInfinitive } from "./germanLexicon";
import { isGerman, mayRun } from "./shared";

// Fixed phrases whose words change case: a word that is a noun only in the phrase ("die
// Schuld", "im Ernst", "in den Arm", "zum Dank", "ein Riesenerfolg") and a noun that is an
// adverb or adjective in it ("mir ist es recht", "nach links", "mir ist angst", "ernst
// nehmen", "zu Recht" against "zurechtkommen").

const S = SPACE;
const E = WORD_END;
const re = (source: string) => new RegExp(`${WORD_START}(?:${source})${E}`, "gdu");
const DATIVES = "[Mm]ir|[Dd]ir|[Ii]hm|ihr|[Uu]ns|[Ee]uch|ihnen|Ihnen";
const POSSESSIVES = "mein|dein|sein|ihr|unser|euer|Ihr";
const SEIN = "ist|war|wäre|wird|wurde|sei|sein|bin|bist|sind|seid|waren|wären";
const MONTHS = "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";
// Verbs "zurecht" belongs to: zurechtkommen, -legen, -finden, -machen, -rücken, -weisen.
const ZURECHT_VERBS =
  /(?<!\p{L})(?:ge)?(?:komm|kam|käm|leg|find|fand|fänd|mach|rück|weis|wies|stell|schneid|schnitt|bieg|bog|setz|zupf|richt)\p{Ll}*/u;

type Frame = [
  RegExp,
  (m: RegExpExecArray, ctx: DetectContext) => string | string[] | null,
  ReviewMessageKey?,
];

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
const COLLOCATION_NOUNS = Object.keys(COLLOCATIONS).join("|");
const COLLOCATION_STEMS =
  "(?:nehm|nimm|nahm|nähm|genommen|leist|geleistet|zieh|zog|zög|gezogen|geb|gib|gab|gäb|gegeben|sag|gesagt|weiß|wiss|wusst|gewusst|trag|träg|trug|trüg|getragen|schaff|schuf|geschaffen|halt|hält|hielt|gehalten)";
const COLLOCATION_VERBS =
  "(?:nehm|nimm|nahm|nähm|genommen|leist|geleistet|zieh|zog|zög|gezogen|geb|gib|gab|gäb|gegeben|sag|gesagt|weiß|wiss|wusst|gewusst|trag|träg|trug|trüg|getragen|schaff|schuf|geschaffen|halt|hält|hielt|gehalten)\\p{Ll}*";
const ORDINALS =
  "ersten|zweiten|dritten|vierten|fünften|sechsten|siebten|achten|neunten|zehnten|elften|" +
  "zwölften|fünfzehnten|zwanzigsten|dreißigsten|letzten";
const DEGREE =
  "sehr|ganz|ziemlich|echt|wirklich|total|so|zu|nicht|überhaupt|recht|richtig|extrem|" +
  "besonders|gar|nie|immer|doch|auch|schon|eher|absolut|einfach|unheimlich|wahnsinnig";
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

const FRAMES: Frame[] = [
  // "das importieren der Klassen", "beim erstellen einfacher Regeln": an infinitive after an
  // article with a genitive after it is a noun.
  [
    re(
      `(?<=(?:[Dd]as|[Dd]em|[Bb]eim|[Zz]um|[Vv]om|[Ii]ns|[Ii]m)(?:${S}\\p{Ll}{2,30}(?:e|en))?${S})(?<target>\\p{Ll}{3,}(?:en|ern|eln))(?=${S}(?:des|eines|einer|meines|meiner|seines|seiner|ihres|ihrer|unseres|unserer|dieses|dieser|der|\\p{Ll}{2,30}er${S}\\p{Lu}[\\p{L}-]*|von${S}(?:\\p{Ll}{2,30}(?:e|en)${S})?\\p{Lu}\\p{Ll}+)${E})`,
    ),
    (m, ctx) => {
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
  ],
  // "beim Suchen und finden", "ein Kennenlernen oder treffen": a lowercase infinitive joined
  // to one made a noun.
  [
    re(
      `(?<=(?:[Bb]eim|[Zz]um|[Vv]om|[Dd]as|[Dd]em|[Ii]m|[Ii]ns|[Ee]in|\\p{Ll}{2,30}es)${S}\\p{Lu}\\p{Ll}{2,}(?:en|ern|eln)${S}(?:und|oder|bzw\\.|sowie)${S})(?<target>\\p{Ll}{3,}(?:en|ern|eln))(?=[ \\t]*[.!?,;:]|${S}(?:des|der|von|würde|wird|ist|war|einladen|\\p{Ll}{2,}t)${E})`,
    ),
    (m, ctx) => {
      const word = m.groups!.target;
      const noun = /(\p{Lu}\p{Ll}+)[ \t]+\S+[ \t]+$/u.exec(
        ctx.text.slice(Math.max(0, m.index - 60), m.index),
      )?.[1];
      if (!noun || !germanInfinitive(noun.toLowerCase()) || !germanInfinitive(word)) return null;
      return cap(word);
    },
  ],
  // "Die Uhr ist nichts Wert", "was das Wert ist": the adjective "wert".
  [
    re(
      `(?<=(?:nichts|viel|wenig|mehr|einiges|etwas|das|es|nicht|kaum|einen${S}Versuch|keinen${S}Cent)${S})(?<target>Wert)(?=${S}(?:ist|sind|war|waren|sein|wäre|wären|scheint)${E}|[ \\t]*[.!?,;])`,
    ),
    (m, ctx) => {
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
  ],
  // "bis spät Abends" → spätabends; "Wir essen Abends" → abends: the adverbs of the time of day
  // are lowercase ("eines Abends", "des Morgens" are nouns).
  [
    re(
      `(?<target>(?<degree>spät|früh)${S}(?<time>Abends?|Morgens?|Nachts?|abends|morgens|nachts))|` +
        `(?<!(?:[Dd]es|[Ee]ines|[Jj]eden|[Aa]m|[Zz]um|[Vv]om|bis${S}zum|[Ee]ines${S}\\p{Ll}{1,20}en)${S})(?<=\\p{Ll}${S})(?<t2>Morgens|Abends|Nachts|Mittags|Vormittags|Nachmittags)${E}`,
    ),
    (m) => {
      if (m.groups!.t2) return m.groups!.t2.toLowerCase();
      const time = m.groups!.time.toLowerCase().replace(/(?<!s)$/, "s");
      return `${m.groups!.degree}${time}`;
    },
  ],
  // "Der angestellte wurde entlassen", "Die jugendlichen benahmen sich": a person named by an
  // adjective or participle, before the clause's verb.
  [
    re(
      `(?<=(?:[Dd]er|[Dd]ie|[Dd]en|[Dd]em|[Ee]in|[Ee]ine|[Ee]inen|[Ee]inem|[Kk]ein|[Kk]eine|[Ss]ein|[Ss]eine|[Mm]ein|[Mm]eine|[Ii]hr|[Ii]hre)${S})(?<target>(?:angestellt|obdachlos|jugendlich|erwachsen|verletzt|verwundet|abgeordnet|bekannt|verwandt|vorsitzend|reisend|studierend|arbeitslos|gefangen|verdächtig|überlebend|behindert|geliebt|verstorben|beschuldigt|angeklagt|auszubildend|selbstständig|selbständig|gläubig|minderjährig|volljährig)(?:e|en|er))(?=${S}(?:wurde|wurden|ist|sind|war|waren|hat|haben|hatte|hatten|wird|werden|kam|kamen|kann|können|muss|müssen|soll|sollen|benahm|benahmen|sagte|sagten|ging|gingen|starb|starben|bekam|bekamen|darf|dürfen)${E})`,
    ),
    (m) => cap(m.groups!.target),
  ],
  // "Angst und schrecken verbreiten" → Angst und Schrecken.
  [
    re(
      `(?<target>[Aa]ngst${S}und${S}[Ss]chrecken)(?=${S}(?:verbreiten|verbreitet|verbreitete|verbreiteten|versetzen|versetzt|versetzte|auslösen|ausgelöst)${E}|[ \\t]*[.!?,;])`,
    ),
    () => "Angst und Schrecken",
  ],
  // "Hey liebes,", "Hallo ihr lieben": the addressed person is a noun.
  [
    re(
      `(?<=(?:^|\\n)[ \\t]{0,8}(?:Hey|Hallo|Hi|Moin|Servus|Guten${S}(?:Morgen|Abend|Tag)|Gute${S}Nacht)(?:${S}(?:ihr|mein|meine))?${S})(?<target>liebes|lieben|lieber|liebe|süße|süßer|süßes)(?=[ \\t]*(?:[,!.\\n]|$))`,
    ),
    (m) => cap(m.groups!.target),
  ],
  // "zu ehren der Gäste", "zur ehre Gottes", "in ehren": the noun "Ehre".
  [
    re(
      `(?<=(?:[Zz]u|[Ii]n)${S})(?<target>ehren)(?=${S}(?:des|der|dem|meines|meiner|seines|seiner|ihres|ihrer|unseres|unserer|\\p{Lu})|${S}\\p{Ll}+(?:te|ten|ter|tes|ene|enen|ener)${E}|[ \\t]*[.!?,;])|(?<=[Zz]ur${S})(?<t2>ehre)${E}`,
    ),
    (m) => cap(m.groups!.target ?? m.groups!.t2),
  ],
  // "Ich mache mir sorgen", "sich keine sorgen machen": the noun "Sorgen".
  [
    re(
      `(?<=(?:mir|dir|sich|uns|euch|ihm|ihr|keine|viele|große|ernste|unnötige|andere|ganz${S}andere|solche|mehr)${S})(?<target>sorgen)(?=${S}(?:machen|machst|macht|machte|machten|gemacht|zu${S}machen|mache)${E}|[ \\t]*[.!?,;])`,
    ),
    (m, ctx) => {
      // "weil sie sich sorgen.": a verb at the end of a clause after "sich".
      const before = ctx.text
        .slice(Math.max(0, m.index - 80), m.index)
        .split(/[.!?;,\n]/)
        .at(-1)!;
      const ending = /^[ \t]*[.!?,;]/.test(ctx.text.slice(m.index + m[0].length));
      if (
        ending &&
        !/(?<!\p{L})(?:mach\p{Ll}*|gemacht|habe|hast|hat|haben|keine|viele|andere)(?!\p{L})/iu.test(
          before,
        )
      )
        return null;
      return "Sorgen";
    },
  ],
  // "abstand nehmen", "folge leisten", "nutzen ziehen", "bescheid geben": the noun of a fixed
  // noun-and-verb phrase, right before its verb or after it with at most two words between.
  [
    re(
      `(?<target>${COLLOCATION_NOUNS})(?=${S}(?:(?:davon|darauf|daraus|dazu|damit|darüber)${S})?(?:zu${S})?${COLLOCATION_VERBS}${E})|(?<t2>${COLLOCATION_NOUNS})(?<=${COLLOCATION_STEMS}\\p{Ll}{0,6}${S}(?:\\p{Ll}{1,20}${S}){0,2}(?:${COLLOCATION_NOUNS}))(?=[ \\t]*[.!?,;]|${S}(?:daraus|davon|darauf|dazu|damit|mit|für|zu|an|auf|bei|von)${E})`,
    ),
    (m) => {
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
  ],
  // "zur neige gehen", "im schnitt", "das weite suchen", "einen gefallen tun": a noun in a fixed
  // phrase that is a verb or adjective form elsewhere.
  [
    re(
      `(?<=[Zz]ur${S})(?<target>neige)${E}|(?<=[Ii]m${S})(?<t2>schnitt)(?=[ \\t]*[.!?,;]|${S}(?:\\d+|etwa|rund|ungefähr|knapp|fast|mehr|weniger|nur|pro|alle|jede|jeden)${E})|(?<=[Dd]as${S})(?<t3>weite)(?=${S}(?:such|gesucht)\\p{Ll}*${E})|(?<=[Ee]inen${S}(?:gro(?:ß|ss)en${S})?)(?<t4>gefallen)(?=${S}(?:zu${S})?(?:tun|tust|tut|tat|tätest|täte|getan|erweisen|erweist|erwies|erwiesen)${E})`,
    ),
    (m) => cap(m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4),
  ],
  // "um Gottes Willen", "um des Friedens Willen" → willen: the preposition "um … willen" with a
  // genitive between ("um den Willen" is the noun).
  [
    re(
      `(?<=[Uu]m${S}(?:(?:des|eines|meines|deines|seines|ihres|unseres|eures|der|meiner|deiner|seiner|ihrer|unserer|eurer)${S}(?:\\p{Ll}+${S})?)?\\p{Lu}\\p{Ll}+${S})(?<target>Willen)${E}|(?<=[Uu]m${S}(?:meiner|deiner|seiner|ihrer|unser|euer)${S}selbst${S})(?<t2>Willen)${E}`,
    ),
    () => "willen",
  ],
  // "Er war Zeit seines Lebens …" → zeit: the preposition "zeit" before "meines Lebens"; at
  // a sentence start, or after a determiner, quantity or adjective ("die schönste Zeit meines
  // Lebens", "viel Zeit meines Lebens"), it stays the noun.
  [
    re(
      `(?<=\\p{L}${S})(?<target>Zeit)(?=${S}(?:meines|deines|seines|ihres|unseres|eures|Ihres)${S}Lebens${E})`,
    ),
    (m) => {
      const prior = /(\p{L}+)\s+$/u.exec(m.input.slice(Math.max(0, m.index - 30), m.index))?.[1];
      const lower = prior?.toLowerCase() ?? "";
      const attribute =
        /^(?:viel|wenig|etwas|mehr|genug|zur|zu|in|von|seit|aus|bei|mit|nach|für|um)$/.test(
          lower,
        ) ||
        (/(?:e|en|er|es|em)$/.test(lower) &&
          !/^(?:habe|hatte|hatten|wurde|wurden|waren|haben|sie|wie|ihre?|dies|es)$/.test(lower) &&
          !/[^s]ten?$/.test(lower));
      return !prior || attribute ? null : "zeit";
    },
  ],
  // "mitten im nichts", "im nirgendwo": the nouns "Nichts" and "Nirgendwo".
  [re(`(?<=[Ii]m${S})(?<target>nichts|nirgendwo)`), (m) => cap(m.groups!.target)],
  // "vor ärger", "mit bedauern", "zu unserem bedauern": the nouns "Ärger" and
  // "Bedauern" ("es wird immer ärger" is the comparative).
  [
    re(
      `(?<target>ärger)(?<=(?:vor|für|aus|viel|keinen|großen|nur|mit)${S}ärger)${E}|(?<t2>bedauern)(?<=(?:[Mm]it|[Zz]u${S}(?:meinem|unserem|seinem|ihrem|Ihrem|deinem|eurem))(?:${S}(?:großem|größtem|tiefem|tiefstem|aufrichtigem|großen|größten|tiefen|aufrichtigen))?${S}bedauern)${E}`,
    ),
    (m) => cap(m.groups!.target ?? m.groups!.t2),
  ],
  // "außer acht lassen", "sich in acht nehmen": the noun "Acht".
  [
    re(
      `(?<=[Aa]ußer${S})(?<target>acht)(?=${S}(?:lassen|lässt|ließ|ließen|gelassen|zu${S}lassen|ließe)${E}|[ \\t]*[.!?,;])|(?<=(?:sich|dich|mich|euch|uns)${S}in${S})(?<t2>acht)(?=${S}(?:nehmen|nimmt|nahm|genommen|nimm)${E})`,
    ),
    () => "Acht",
  ],
  // "Das tut mir Leid" → leid ("leidtun"); "Leid tun" → leidtun.
  [
    re(
      `(?<=(?:tut|tat|täte|tun|getan|tue)${S}(?:mir|dir|ihm|ihr|uns|euch|ihnen|Ihnen)(?:${S}(?:sehr|wirklich|so|echt|furchtbar|aufrichtig|ehrlich|schrecklich|unendlich|total|auch|nicht|schon|doch|ja)){0,2}${S})(?<target>Leid)(?=[ \\t]*[.!?,;]|${S}(?:dass|für|um|wegen)${E})|` +
        `(?<=(?:mir|dir|ihm|ihr|uns|euch|ihnen|Ihnen|noch|sehr|wirklich)${S})(?<t2>Leid${S}tun)(?=[ \\t]*[.!?,;])`,
    ),
    (m) => (m.groups!.target ? "leid" : "leidtun"),
  ],
  // "jedes mal", "beim nächsten mal", "ein für alle mal", "die letzten male": the noun "Mal"
  // after a determiner or an ordinal; "von Mal zu Mal", "Mal für Mal".
  [
    re(
      `(?<=(?:[Jj]edes|[Dd]ieses|[Nn]ächstes|[Ll]etztes|[Ee]rstes|[Zz]weites|[Dd]rittes|[Ee]inziges|[Mm]anches|einige|etliche|[Bb]eim${S}(?:nächsten|ersten|letzten|zweiten)|[Zz]um${S}(?:${ORDINALS}|wiederholten|x-ten|hundertsten|tausendsten)|[Dd]as${S}(?:erste|zweite|dritte|letzte|nächste|einzige)|ein${S}für${S}alle)${S})(?<target>mal)${E}|(?<=(?:[Dd]ie${S}(?:ersten|letzten|nächsten)|einige|etliche|viele|mehrere)${S})(?<t4>male)${E}|` +
        `(?<t2>mal)(?=${S}(?:zu|für)${S}[Mm]al${E})|(?<=[Mm]al${S}(?:zu|für)${S})(?<t3>mal)${E}`,
    ),
    (m, ctx) => {
      // "von mal zu mal": only after "von" ("komm mal zu mir" is the particle).
      const zu = /^[ \t]+zu/.test(ctx.text.slice(m.index + m[0].length));
      const von = /(?<!\p{L})[Vv]on[ \t]+$/u.test(
        ctx.text.slice(Math.max(0, m.index - 6), m.index),
      );
      if (m.groups!.t2 && zu && !von) return null;
      return cap(m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4);
    },
  ],
  // "mit ja antworten", "ein klares nein": the answer as a noun.
  [
    re(
      `(?<=(?:mit|einem|kein|(?:\\p{Ll}{3,20}(?:es|en))|(?:Ja|Nein)${S}(?:oder|und))${S})(?<target>ja|nein)(?=[ \\t]*[.,!?;:]|${S}(?:oder|und|beantworten|beantwortet|beantwortete|hätte|hat|war|ist|sagen|gesagt|stimmen|stimmte|gestimmt|antworten|antwortete|geantwortet)${E})`,
    ),
    (m, ctx) => {
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
  ],
  // "Ich bin sehr Stolz auf euch", "Das ist nicht Fair.": a predicative adjective stays
  // lowercase.
  [
    re(
      `(?<=(?:ist|sind|war|waren|bin|bist|seid|wäre|wären|wird|wurde|bleibt|blieb)(?:${S}(?:du|ihr|er|sie|es|wir|ich|man))?(?<degree>(?:${S}(?:${DEGREE})){0,3})${S})(?<target>\\p{Lu}\\p{Ll}{2,})(?=[ \\t]*[.!?,;]|${S}(?:auf|über|für|mit|zu|von|gegenüber|darauf|damit|dafür|davon)${E})`,
    ),
    (m) => {
      const word = m.groups!.target;
      const low = word.toLowerCase();
      if (!germanAdjective(low) || LANGUAGES.test(low)) return null;
      // "Das ist Stolz.": with no degree word only a preposition after it ("stolz auf")
      // shows the adjective.
      const preposition = /^[ \t]+\p{Ll}/u.test(m.input.slice(m.index + m[0].length));
      if (!m.groups!.degree && (!preposition || germanGender(word))) return null;
      return low;
    },
    "review_msg_german_adjective_lowercase",
  ],
  // "die Rechte dritter", "an dritte weitergeben", "am ersten jedes Monats", "der erste, der
  // …": ordinals as nouns.
  [
    re(
      `(?<=(?:an|für|gegenüber|durch|vor)${S})(?<target>dritte[nr]?)(?!${S}\\p{Lu}|\\p{L})|` +
        `(?<=\\p{Lu}\\p{Ll}{2,}${S})(?<t2>dritter)(?=[ \\t]*[.,;!?])|` +
        `(?<=(?:[Aa]m|[Zz]um|[Vv]om)${S})(?<t3>${ORDINALS})(?=${S}(?:jedes|eines|des|dieses|nächsten)${E})|` +
        `(?<=(?:der|die|das)${S})(?<t4>erste|zweite|dritte|letzte|einzige|nächste)(?=,${S}(?<relative>der|die|das|den|dem|welche[rs]?)${S}\\p{L}+)`,
    ),
    (m, ctx) => {
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
  ],
  // "die schuld", "keine schuld", "deine schuld": the noun; "ist Schuld daran": the adjective.
  [
    re(
      `(?<=(?:die|der|keine|keiner|alle|ohne|von|jede|schwere|große|ganze|meine|deine|seine|ihre|unsere|eure|Ihre)${S})(?<target>schuld)`,
    ),
    () => "Schuld",
  ],
  [
    re(
      `(?<=(?:${SEIN})(?:${S}(?:doch|nicht|auch|selbst|allein|ganz|daran|wohl|ja|ich|du|er|sie|es|wir|ihr)){0,4}${S})(?<target>Schuld)(?=${S}daran|[ \\t]*[.!?,;])`,
    ),
    () => "schuld",
  ],
  // "mein ernst", "im ernst", "ernst machen"; "Ernst nehmen", "Ernst gemeint".
  [
    re(`(?<=(?:${POSSESSIVES}|meinen|deinen|vollen|voller|im|allem)${S})(?<target>ernst)`),
    () => "Ernst",
  ],
  [re(`(?<target>ernst)(?=${S}(?:machen|macht|machte|machten|gemacht)${E})`), () => "Ernst"],
  [
    re(
      `(?<!(?:der|den|dem|des|vollen|voller|im|mein|dein|sein|meinen|deinen|seinen|Ihr|ihr|für|allem)${S})(?<=\\p{L}${S})(?<target>Ernst)(?=${S}(?:nehmen|nimm|nimmt|nahm|nahmen|genommen|zu${S}nehmen\\p{Ll}*|gemeint|meinen|meint)${E})`,
    ),
    () => "ernst",
  ],
  // "Nimm das Ernst." → ernst: the verb before it.
  [
    re(
      `(?<!(?:der|den|dem|des|vollen|voller|im|mein|dein|sein|meinen|deinen|seinen|Ihr|ihr|für|allem)${S})(?<=\\p{L}${S})(?<target>Ernst)(?=[ \\t]*[.!?,])`,
    ),
    (m, ctx) =>
      /(?<!\p{L})(?:nimm|nimmt|nehme|nehmen|nehmt|nahm|nahmen)(?!\p{L})/iu.test(
        clauseBefore(ctx, m),
      )
        ? "ernst"
        : null,
  ],
  // "in den arm", "im arm", "mit offenen armen", "arm in Arm".
  [re(`(?<=(?:in${S}den|im|unter${S}den|am)${S})(?<target>arm)`), () => "Arm"],
  [re(`(?<=offenen${S})(?<target>armen)`), () => "Armen"],
  [
    re(`(?<target>[Aa]rm${S}in${S}[Aa]rm)`),
    (m) => (m.groups!.target.includes("arm") ? "Arm in Arm" : null),
  ],
  // "zum dank", "der dank", "vielen dank", "Gott sei dank", "zu dank verpflichtet".
  [
    re(
      `(?<=(?:[Zz]um|der|den|dem|euer|unser|mein|dein|sein|ihr|[Vv]ielen|[Bb]esten|[Hh]erzlichen|großen|großem|sei)${S})(?<target>dank)(?!${S}(?:des|der|dem|den|seiner|ihrer|meiner|deiner|unserer|eurer)${E})`,
    ),
    () => "Dank",
  ],
  [re(`(?<=zu${S}(?:großem${S})?)(?<target>dank)(?=${S}verpflichtet)`), () => "Dank"],
  // "nach Links abbiegen", "von Links nach rechts", "mit Links." → links; "eine Seite mit
  // Links zum Thema", "der Blick nach Rechts ist …" (a name) stay.
  [
    re(
      `(?<=(?:nach|halb|ganz|weiter|scharf)${S})(?<target>Links|Rechts)(?=[ \\t]*[.!?,]|${S}(?!(?:ist|sind|war|waren|wird|hat|zum|zur|zu|auf|über|von|für|und)${E})\\p{Ll})|` +
        `(?<=von${S})(?<t3>Links|Rechts)(?=${S}nach${E})|(?<=mit${S})(?<t4>Links)(?=[ \\t]*[.!?])|` +
        `(?<t2>Links|Rechts)(?=${S}(?:abbiegen|abbiegt|abgebogen|abbog|einbiegen|halten|ab)${E})`,
    ),
    (m) => (m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4).toLowerCase(),
  ],
  // "mir ist Recht", "es geschah ihm Recht", "Recht und billig", "alles Recht machen".
  [
    re(
      `(?<=(?:${DATIVES})(?:${S}(?:ganz|nicht|auch|aber|wirklich|durchaus|doch|schon|nur)){0,3}${S})(?<target>Recht)(?=${S}(?:sein|ist|war|wäre|so)${E}|[ \\t]*[,.!?])`,
    ),
    (m, ctx) =>
      /\b(?:haben|hat|hast|habe|hatte|gibt|gab|geben|gegeben|gebe|gebt|gib)\b/.test(
        clauseBefore(ctx, m),
      )
        ? null
        : "recht",
  ],
  [re(`(?<=(?:geschieht|geschah|geschehe)${S}(?:${DATIVES})${S})(?<target>Recht)`), () => "recht"],
  [re(`(?<target>Recht)(?=${S}und${S}billig)`), () => "recht"],
  [
    re(`(?<=(?:alles|nichts|es|ihm|ihr|allen)${S})(?<target>Recht)(?=${S}(?:zu${S})?machen)`),
    () => "recht",
  ],
  [
    re(
      `(?<=(?:gehe|gehen|geht)(?:${S}(?:ich|wir|du|ihr|Sie))?${S})(?<target>Recht)(?=${S}in${S}der${S}Annahme)`,
    ),
    () => "recht",
  ],
  // "Das ist mir Wurst!", "Das kann ihm doch Wurscht sein": "egal" is lowercase; "Das ist
  // Wurst." with no one it is egal to may be the food.
  [
    re(
      `(?=Wurs)(?<=(?:${SEIN}|ist|kann|könnte|dürfte)(?:${S}\\p{Ll}{2,12}){0,3}${S}(?:${DATIVES}|dem|doch|eh|ja|völlig|total|echt|herzlich)(?:${S}\\p{Ll}{2,12}){0,2}${S})(?<target>Wurs(?:ch)?t)(?=(?:${S}sein)?[ \\t]*[.!?,;])`,
    ),
    (m) => m.groups!.target.toLowerCase(),
  ],
  // "Er stand Kopf.", "Ich nehme daran nicht Teil.": the particle of "kopfstehen" and
  // "teilnehmen" closing a main clause ("den Teil", "am Kopf" are nouns).
  [
    re(
      `(?=Kopf)(?<=(?:steht|stand|standen|stehen|stehst|stehe)${E}[^.!?;:,\\n]{0,40}${S})(?<!(?:der|die|das|den|dem|des|am|im|zum|beim|vom|auf|über|an|bis|von|mit|ohne|pro|je|kein|ein|mein|dein|sein)${S})(?<target>Kopf)(?=[ \\t]*[.!?,;])|` +
        `(?=Teil)(?<=(?:nehme|nimmst|nimmt|nehmen|nehmt|nahm|nahmen|nahmst)${E}[^.!?;:,\\n]{0,40}${S})(?<!(?:der|die|das|den|dem|des|am|im|zum|beim|vom|kein|ein|mein|dein|sein|ihr)${S})(?<t2>Teil)(?=[ \\t]*[.!?,;])`,
    ),
    (m, ctx) => {
      // "den großen Teil", "mit dem Kopf": an inflected adjective before it ("gerne" is none).
      const prior = /(?<!\p{L})(\p{Ll}+)[ \t]+$/u.exec(
        ctx.text.slice(Math.max(0, m.index - 24), m.index),
      );
      const stem = prior?.[1].replace(/e[mnrs]?$/, "") ?? "";
      const adjective = germanAdjective(stem) || /\p{Ll}{2}(?:e?s|ß)t$/u.test(stem);
      if (prior && stem !== prior[1] && adjective && !/^(?:gern|lang)$/.test(stem)) return null;
      return (m.groups!.target ?? m.groups!.t2).toLowerCase();
    },
  ],
  // "ich bin ihr Gram" → gram.
  [
    re(`(?<=(?:${SEIN})${S}(?:${DATIVES})(?:${S}(?:nicht|wirklich)){0,2}${S})(?<target>Gram)`),
    () => "gram",
  ],
  // "mir ist Angst und Bange" → angst und bange; "macht mir angst und bange" → Angst und Bange.
  [
    re(
      `(?<=(?:(?:${DATIVES})${S}(?:${SEIN}|sollte${S}|wurde)|(?:${SEIN}|wurde)${S}(?:${DATIVES}))(?:${S}nicht)?${S})(?<target>[Aa]ngst(?:${S}und${S}[Bb]ange)?)(?=${S}sein${E}|[ \\t]*[,.!?])`,
    ),
    (m) =>
      m.groups!.target === m.groups!.target.toLowerCase() ? null : m.groups!.target.toLowerCase(),
  ],
  [
    re(
      `(?<=(?:mach|macht|machen|machte|machten|gemacht)${S}(?:\\p{Ll}{1,40}${S})?(?:${DATIVES}|mich|dich|ihn|sie|uns|euch)(?:${S}nicht)?${S})(?<target>[Aa]ngst${S}und${S}[Bb]ange)`,
    ),
    (m) =>
      m.groups!.target === m.groups!.target.replace(/^a/, "A").replace(/ b/, " B")
        ? null
        : "Angst und Bange",
  ],
  // "ein riesen Dank", "eine Riesen Freude" → "Riesendank", "Riesen-Freude".
  [
    re(
      `(?<target>(?:riesen|(?<=(?:ein|eine|einen|einem|einer|eines|unserer|unseres|dieser|dieses|diesen)${S})Riesen)${S}(?<noun>\\p{Lu}\\p{Ll}{2,}))`,
    ),
    (m) => [`Riesen${m.groups!.noun.toLowerCase()}`, `Riesen-${m.groups!.noun}`],
  ],
  // "behauptet zurecht" → zu Recht; "kommt zu recht" → zurecht.
  [
    re(`(?<target>zurecht|zu${S}recht)`),
    (m, ctx) => {
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
  ],
  // "bis ende Januar", "ende des Jahres", "kein ende", "zu ende", "ende gut": the noun; "das
  // ende ich jetzt" is the verb.
  [
    re(
      `(?<!(?:ich|[Ii]ch)${S})(?<target>ende)(?=${S}(?:${MONTHS}|des|der|dieser|diesen|nächster|nächsten|letzter|letzten|kommender|vergangener|\\d+|[Zz]wanzig|[Dd]reißig|[Vv]ierzig|[Ff]ünfzig|[Ss]echzig|gut)${E})|` +
        `(?<=(?:[Dd]as|kein|ein|am|zum|vom|zu|bis)${S})(?<t2>ende)(?!${S}(?:ich|du|wir|ihr)${E})`,
    ),
    () => "Ende",
  ],
  // "auf dem weg", "aus dem weg", "über den weg", "den weg zeigen": the noun.
  [
    re(
      `(?<=(?:auf|aus|über|[Aa]uf|[Aa]us|[Üü]ber)${S}(?:dem|den|halbem|halben)${S})(?<target>weg)|` +
        `(?<=den${S})(?<t2>weg)(?=${S}(?:gezeigt|zeigen|zeigt|zeigte|finden|findet|fand|gefunden|weisen|gewiesen|kennen|kennt|bahnen|ebnen|geebnet)${E})`,
    ),
    () => "Weg",
  ],
  // "ein schönes paar", "ein zusätzliches paar Augen": "Paar" after an inflected adjective.
  [
    re(`(?<=(?:[Ee]in|[Dd]as|[Dd]ieses|[Jj]edes)${S}\\p{Ll}{1,30}es${S})(?<target>paar)`),
    () => "Paar",
  ],
  // "im aus", "ins aus gerollt", "das aus für": the noun.
  [
    re(
      `(?<=(?:im|ins)${S})(?<target>aus)(?=[ \\t]*[.!?,;]|${S}(?:\\p{Ll}*ge\\p{Ll}+t|landete|landet|rollte|rollt|ging|geht|gehen|gerät|geriet)${E})|` +
        `(?<=[Dd]as${S})(?<t2>aus)(?=${S}für${E})`,
    ),
    () => "Aus",
  ],
];

/** Run by germanNounCasing's detector (nounCasing.ts). */
export function idioms(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const [regex, fix, messageKey] of FRAMES) {
    if (!mayRun(ctx, regex)) continue;
    // The typed words are in "target", or in "t2"–"t4" for a frame's other branches.
    const named = (m: RegExpExecArray) =>
      ["target", "t2", "t3", "t4"].find((k) => m.groups![k] !== undefined)!;
    const owner = (m: RegExpExecArray) => m.indices!.groups![named(m)][0];
    for (const m of frameMatches(ctx, regex, owner)) {
      const name = named(m);
      const [start, end] = m.indices!.groups![name];
      const typed = m.groups![name];
      if (ctx.dictionary.has(typed.toLowerCase()) || namedExampleBefore(ctx.text, start)) continue;
      const fixed = fix(m, ctx);
      const replacements = fixed === null ? [] : [fixed].flat().filter((r) => r !== typed);
      if (replacements.length === 0) continue;
      findings.push({
        ruleId: "germanNounCasing",
        messageKey: messageKey ?? "review_msg_german_idiom_case",
        range: { start, end },
        alternatives: replacements,
        ...(replacements.length > 1 ? { requiresChoice: true as const } : {}),
        context: { start: Math.max(0, start - 40), end: Math.min(ctx.text.length, end + 40) },
      });
    }
  }
  return findings;
}
