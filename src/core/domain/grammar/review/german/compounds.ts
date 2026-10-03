import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { determinerFits, nominalVerb } from "./articleGender";
import {
  germanInfinitive,
  germanNounReading,
  germanPastInfinitives,
  germanVerbLike,
} from "./germanLexicon";
import { isGerman, mayRun, tokensBefore, VERB_GOVERNORS, wordSet } from "./shared";
import { germanInfinitiveOf, isAuxiliary } from "./verbAgreement";

// German compounds written apart or with the wrong joints: separable verbs ("auf zu bauen" →
// "aufzubauen"), times of day ("Dienstag Abend" → "Dienstagabend"), numbers with suffixes
// ("8 seitig" → "8-seitig", "3. Klässler" → "Drittklässler"), abbreviations before nouns
// ("US Bürger" → "US-Bürger") and fixed spellings ("Email" → "E-Mail", "DinA4" → "DIN A4").

const NBSP = " ";
const re = (source: string) => new RegExp(`${WORD_START}(?:${source})${WORD_END}`, "gdu");

// Particles of separable verbs; "um" and "mit" are left out ("um zu gehen" is "in order
// to go"), and "zu" ("zu zu muten") needs the joined verb to be known like the others.
const PARTICLES =
  "ab an auf aus bei ein fest fort her herab heran herauf heraus herbei herein herüber " +
  "herum herunter hervor hin hinab hinauf hinaus hinein hinüber hinunter hinweg los " +
  "nach nieder vor voran voraus vorbei vorüber weg weiter wieder zurück zusammen zu " +
  "bereit statt teil kennen fertig frei zufrieden wohl hoch dar empor entgegen unter zurecht";
const PARTICLE_SET = wordSet(PARTICLES);
const ZU_INFINITIVE = re(
  `(?<prev>\\p{L}+)${SPACE}(?<target>(?<particle>\\p{Ll}+)${SPACE}zu${SPACE}(?<verb>\\p{Ll}+))`,
);
// Adverbs ending in -t, unlike the finite verbs whose particle comes next ("fängt an zu").
const NOT_FINITE = wordSet(
  "nicht jetzt erst oft fast meist zuletzt sonst selbst gut recht weit halt",
);
// "sich um zu drehen", "damit um zu gehen": "um" as a particle.
const UM_ZU = re(
  `(?<=(?:sich|damit|dich|mich|uns|euch)${SPACE})(?<target>um${SPACE}zu${SPACE}(?<verb>\\p{Ll}+))`,
);
// "bereit stellen", "kennen lernen", "fertig stellen": a particle before an infinitive.
const SPLIT_INFINITIVE = re(
  `(?<target>(?<particle>bereit|kennen|fertig|zufrieden|statt|teil|nieder|weg|los|vorbei|hinzu)${SPACE}(?<verb>\\p{Ll}+(?:en|ern|eln)))`,
);
// "Falls du ab sagst,", "hat den Brief ab geschickt.", "als sie los gingen": a particle
// written apart from its verb at the end of a clause, where a main clause would not split it.
// "wieder", "weiter", "zusammen" and the like are left out: both spellings exist.
const SPLIT_AT_END = re(
  `(?<target>(?<particle>ab|an|auf|aus|bei|ein|los|nach|vor|weg|zu|dar|her|hin|fort|heraus|herein|hinaus|hinein|herum|statt|teil|unter|bereit|stand)${SPACE}(?<verb>\\p{Ll}{3,}))(?=(?:${SPACE}(?<aux>\\p{Ll}+))?[ \\t]*(?:[,.!?;:)]|$))`,
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
const TIMES =
  "Morgen|Vormittag|Mittag|Nachmittag|Abend|Nacht|morgen|vormittag|mittag|nachmittag|abend|nacht";
const WEEKDAY_TIME = re(
  `(?<=(?:am|jeden|diesen|nächsten|letzten|kommenden|vergangenen|bis|ab|seit|vom|zum|Am|Jeden)${SPACE})(?<target>(?<day>Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonnabend|Sonntag)${SPACE}(?<time>${TIMES}))`,
);
const SUFFIXES =
  "seitig|stellig|prozentig|teilig|jährig|tägig|stündig|minütig|wöchig|monatig|sprachig|" +
  "farbig|geschossig|zimmerig|türig|spurig|köpfig|sitzig|bändig|zeilig|wertig";
const NUMBER_SUFFIX = new RegExp(
  `(?<![\\p{L}\\p{N}.,-])(?<target>(?<n>\\p{N}+)(?:[ \\t]?)(?<suffix>(?:${SUFFIXES.replace(/\|/g, "|")}|${SUFFIXES.split(
    "|",
  )
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("|")})(?:e|en|er|es|em)?))${WORD_END}`,
  "gdu",
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
const KLASSLER = new RegExp(
  `(?<![\\p{L}\\p{N}.])(?<target>(?<n>1[0-3]|[1-9])\\.[ \\t]?[Kk]lässler(?<end>in|innen|n)?)${WORD_END}`,
  "gdu",
);
const ACRONYM_NOUN = re(
  `(?<target>(?<acronym>US|EU|UN|UNO|IT|PC|PR|EDV|Kfz|KFZ|Pkw|PKW|Lkw|LKW|USB|PDF|HTML|CD|DVD|TV|SMS|GPS|WLAN|SPD|CDU|FDP|DFB|NATO|WHO)${SPACE}(?<noun>\\p{Lu}\\p{Ll}{2,}))`,
);
// "eMail", "e-mail", "E-mail", "EMail" are never right; "Email" (enamel) only after a
// determiner that cannot go with "das Email".
const EMAIL_ANY = re(
  `(?<target>(?:eMail|e-mail|E-mail|EMail|e-Mail)(?<rest>s|-\\p{L}[\\p{L}-]*)?)`,
);
const EMAIL_AFTER = re(
  `(?<=(?:eine|einer|meine|deine|seine|ihre|Ihre|unsere|eure|keine|jede|diese|per|neue|letzte|kurze)${SPACE})(?<target>Email(?<rest>-\\p{L}[\\p{L}-]*)?)`,
);
const EMAILS = re(`(?<target>Emails|E-Mailadresse|E-Mailadressen)`);
// "Spam-Email", "HTML-EMail-Adresse": the mail part of a hyphenated compound.
const EMAIL_TAIL = re(
  `(?<target>(?<pre>(?:\\p{Lu}[\\p{L}]*|\\p{Lu}{2,})-)(?:Email|EMail|eMail|E-mail|e-mail|E-MAIL)(?<rest>s|-\\p{L}[\\p{L}-]*)?)`,
);
// "E mail", "e Mails": the letter written apart.
const EMAIL_APART = re(`(?<target>[Ee][ \\t]+[Mm](?:ail|AIL|Ail)(?<rest>s?))`);
// "E-Mail Adresse", "E-Mail programm": the noun after it joins with a hyphen ("per E-Mail
// Adressen schicken" sends addresses).
const EMAIL_NOUN = re(
  `(?<!(?:per|via|als|[Üü]ber|mit)${SPACE})(?<target>E-Mail${SPACE}(?<noun>(?:[Aa]dresse|[Pp]rogramm|[Kk]onto|[Pp]ostfach|[Vv]erkehr|[Aa]nhang|[Ss]ignatur|[Ss]erver|[Vv]erteiler|[Bb]enachrichtigung|[Kk]ommunikation|[Mm]arketing)(?:n|en|e|s|es)?))`,
);
const DIN = re(
  `(?<target>(?:DIN|Din|din)(?:-|${SPACE})?[Aa](?<size>[0-8])(?<rest>(?:-|${SPACE})?Blatt|-\\p{L}+)?)`,
);
// "in's Kino", "auf's Dach", "vor'm Haus": a preposition fused with its article takes no
// apostrophe.
const FUSED = re(
  `(?<target>(?<prep>[Ii]n|[Aa]n|[Aa]uf|[Ff]ür|[Dd]urch|[Uu]m|[Hh]inter|[Üü]ber|[Uu]nter|[Vv]or)['’](?<article>s|n|m))`,
);
const ADD_ON = re(`(?<target>(?:AddOn|Addon|addon|AddOns|Addons|addons)(?<rest>-\\p{L}+)?)`);

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
  const opened =
    /,[^,]*$/.test(before) ||
    tokens.some((t) => /^(?:um|ohne|statt|anstatt)$/i.test(t)) ||
    CLAUSE_PARTICLES.has(particle);
  if (!opened) return false;
  return !tokens.some(
    (t) =>
      /^\p{Ll}/u.test(t) &&
      !COPULAS.has(t) &&
      ((/t$/.test(t) && !NOT_FINITE.has(t)) ||
        germanVerbLike(t) ||
        /^(?:fing|gab|bot|nahm|sah|schlug|hielt|ließ|kam|ging|fingen|gaben|hörten)$/.test(t)),
  );
}
// Particles no main verb leaves right before a zu-infinitive ("Er fängt an zu laufen", "Sie
// hat vor zu gehen" do), so they open the infinitive with no comma: "kein Grund los zu
// brüllen", "Ist es gut unter zu gehen?".
const CLAUSE_PARTICLES = wordSet(
  "herab heran herauf heraus herbei herein herüber herum herunter hervor hinab hinauf " +
    "hinaus hinein hinüber hinunter hinweg los unter nieder empor zurecht",
);
// Forms of "sein", which takes no particle ("ist kein Grund los zu brüllen").
const COPULAS = wordSet("ist sind war waren bin bist seid wäre wären sei");
// "beim Haare schneiden", "zum Auto fahren", "für das Korrektur lesen": a verb phrase made a
// noun is one word ("beim Haareschneiden").
const NOMINAL_PHRASE = re(
  `(?<=(?:[Bb]eim|[Zz]um|[Vv]om|[Vv]orm|[Ff]ürs|(?:[Ff]ür|[Üü]ber|[Nn]ach|[Vv]or|[Bb]ei|[Mm]it)${SPACE}d(?:as|em))${SPACE})(?<target>(?<noun>\\p{Lu}\\p{Ll}+)${SPACE}(?<verb>\\p{Ll}+(?:en|ern|eln)))`,
);
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
// "Er freute sich, das zuhören.": an infinitive clause after a comma, its zu written onto the
// verb ("zu hören"); the clause ends after it or opens a dass-clause.
const ZU_JOINED = re(
  `(?<=,${SPACE}(?:(?:das|es|dies)${SPACE})?|(?:mich|dich|ihn|uns|euch)${SPACE})(?<target>zu(?<verb>\\p{Ll}{3,}))(?=[ \\t]*(?:[.!?;]|,${SPACE}(?:dass|ob|wie|was|wo|wer|wann|warum|bevor|hinter)${WORD_END}))`,
);
// "Nach dem er gewonnen hatte": "dem" before a subject pronoun at the start of a sentence is
// the conjunction "nachdem" or "seitdem" (after a comma it may open a relative clause: "der
// Schlüssel, nach dem ich suche"). "So weit ich weiß", "so bald das Wetter …": "soweit",
// "sobald", "solange".
const CONJUNCTION = re(
  `(?:^|[.!?\\n„"])[ \\t]*(?<target>(?<first>Nach|Seit)${SPACE}dem)(?=${SPACE}(?:ich|du|er|sie|es|wir|ihr|man)${WORD_END})`,
);
const SO_CONJUNCTION = re(
  `(?:^|[.!?,;:\\n„"])[ \\t]*(?<target>(?<first>[Ss]o)${SPACE}(?<second>weit|bald|lange|lang))(?=${SPACE}(?:ich|du|er|sie|es|wir|ihr|man|der|die|das)${WORD_END})`,
);
// "ihr zu Liebe.", "den Eltern zu gute kommen", "Berichten zu Folge", "zu Nichte machen": fixed
// adverbs written apart, in the frames where "zu" is no preposition ("zu Liebe statt Hass",
// "von Folge zu Folge", "zu gute Noten").
const ZU_ADVERB = re(
  `(?<target>zu${SPACE}(?:(?<liebe>Liebe)(?=[ \\t]*[.!?]|,${SPACE}(?:weil|da|dass|obwohl|denn))|(?<gute>gute)(?=[ \\t]*[.,!?;]|${SPACE}(?:kommen|kommt|kam|kamen|halten|hält|hielt|hielten)${WORD_END})|(?<folge>Folge)(?=[ \\t]*[,.;]|${SPACE}\\p{Ll})|(?<nichte>Nichte)(?=[ \\t]*[.!?]|${SPACE}(?:mach|gemacht))))`,
);
const FRAMES: Array<[RegExp, Fix]> = [
  [CONJUNCTION, (m) => `${m.groups!.first}dem`],
  [SO_CONJUNCTION, (m) => `${m.groups!.first}${m.groups!.second}`],
  [
    ZU_ADVERB,
    (m, ctx) => {
      const { liebe, gute, folge } = m.groups!;
      const prior = tokensBefore(ctx.text, m.index, 1)[0] ?? "";
      // "ihr zu Liebe", "den Eltern zu Liebe": a dative before it.
      if (
        (liebe || gute) &&
        !/^(?:mir|dir|ihm|ihr|uns|euch|ihnen|Ihnen|\p{Lu}\p{Ll}+n?)$/u.test(prior)
      )
        return null;
      // "Berichten zu Folge", not "von Folge zu Folge".
      if (folge && (!/^\p{Lu}\p{Ll}+(?:en|n|ung|e)$/u.test(prior) || prior === "Folge"))
        return null;
      return liebe ? "zuliebe" : gute ? "zugute" : folge ? "zufolge" : "zunichte";
    },
  ],
  [
    ZU_JOINED,
    (m, ctx) => {
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
  ],
  [
    NOMINAL_PHRASE,
    (m, ctx) => {
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
      if (
        contraction &&
        !going &&
        nominalVerb(verb) &&
        determinerFits(contraction, noun) === false
      ) {
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
      if (verbs.length !== 1 || clause.some((w) => VERB_GOVERNORS.has(w.toLowerCase())))
        return null;
      if (BARE_INFINITIVE_VERBS.has(germanInfinitiveOf(verbs[0]) ?? verbs[0])) return null;
      return `${noun}${verb}`;
    },
  ],
  // "Ideen zum selber machen", "beim Selbst Kochen": "selber" or "selbst" with an infinitive
  // after "zum", "beim" or "fürs" is one noun ("zum Selbermachen").
  [
    re(
      `(?<=(?:[Zz]um|[Bb]eim|[Ff]ürs)${SPACE})(?<target>(?<self>[Ss]elb(?:er|st))${SPACE}(?<verb>\\p{L}+(?:en|ern|eln)))(?=[ \\t]*(?:[.!?;,]|$))`,
    ),
    (m) => {
      const { self, verb } = m.groups!;
      const low = verb.toLowerCase();
      if (!germanInfinitive(low) || isAuxiliary(low)) return null;
      return `${self[0].toUpperCase()}${self.slice(1)}${low}`;
    },
  ],
  // "zulange gewartet" → "zu lange"; "wenn ich da zulange" is "zulangen" (help oneself).
  [
    re(`(?<target>[Zz]ulange)`),
    (m, ctx) => {
      const clause = ctx.text
        .slice(Math.max(0, m.index - 80), m.index)
        .split(/[.!?;,:\n]/)
        .at(-1)!;
      return /(?<!\p{L})ich(?!\p{L})/iu.test(clause) ? null : "zu lange";
    },
  ],
  [
    ZU_INFINITIVE,
    (m, ctx) => {
      const { prev, particle, verb } = m.groups!;
      if (!PARTICLE_SET.has(particle) || !germanInfinitive(verb)) return null;
      // "der Reihe nach zu holen", "von Grund auf zu bauen", "auf und ab zu gehen".
      if (/^(?:Reihe|Grund|und|oder)$/.test(prev)) return null;
      if (!infinitiveClause(ctx, m.indices!.groups!.target[0], particle)) return null;
      return germanInfinitive(particle + verb) ? `${particle}zu${verb}` : null;
    },
  ],
  [
    SPLIT_AT_END,
    (m, ctx) => {
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
      return joinsVerb(particle, verb) ? particle + verb : null;
    },
  ],
  [UM_ZU, (m) => (germanInfinitive(`um${m.groups!.verb}`) ? `umzu${m.groups!.verb}` : null)],
  [
    SPLIT_INFINITIVE,
    (m) => {
      const { particle, verb } = m.groups!;
      const joined = particle + verb;
      return germanInfinitive(verb) && (germanInfinitive(joined) || germanVerbLike(joined))
        ? joined
        : null;
    },
  ],
  [
    WEEKDAY_TIME,
    (m) => {
      const { day, time } = m.groups!;
      return `${day}${time.toLowerCase()}`;
    },
  ],
  [NUMBER_SUFFIX, (m) => `${m.groups!.n}-${m.groups!.suffix.toLowerCase()}`],
  [KLASSLER, (m) => `${ORDINALS[Number(m.groups!.n) - 1]}klässler${m.groups!.end ?? ""}`],
  [
    ACRONYM_NOUN,
    (m) =>
      germanNounReading(m.groups!.noun.toLowerCase()) !== null
        ? `${m.groups!.acronym}-${m.groups!.noun}`
        : null,
  ],
  [FUSED, (m) => `${m.groups!.prep}${m.groups!.article}`],
  [EMAIL_ANY, (m) => `E-Mail${emailRest(m.groups!.rest)}`],
  [
    EMAIL_TAIL,
    (m) => {
      const { pre, rest } = m.groups!;
      // "Gold-Email", "Kupfer-Email": enamel; only a word that is no material.
      if (/^(?:Gold|Silber|Kupfer|Zinn|Glas|Eisen|Stahl|Feuer)-$/.test(pre)) return null;
      return `${pre}E-Mail${emailRest(rest)}`;
    },
  ],
  [EMAIL_APART, (m) => `E-Mail${m.groups!.rest}`],
  [
    EMAIL_NOUN,
    (m) => {
      const noun = m.groups!.noun;
      return `E-Mail-${noun[0].toUpperCase()}${noun.slice(1)}`;
    },
  ],
  [EMAIL_AFTER, (m) => `E-Mail${emailRest(m.groups!.rest)}`],
  [
    EMAILS,
    (m) =>
      ({ Emails: "E-Mails", "E-Mailadresse": "E-Mail-Adresse" })[m.groups!.target] ??
      "E-Mail-Adressen",
  ],
  [
    DIN,
    (m) => {
      const { size, rest } = m.groups!;
      if (!rest) return `DIN${NBSP}A${size}`;
      const tail = rest.replace(/^[-\s]+/, "");
      return `DIN-A${size}-${tail[0].toUpperCase()}${tail.slice(1)}`;
    },
  ],
  [
    ADD_ON,
    (m) => {
      const plural = /s$/.test(m.groups!.target.replace(/-.*$/, ""));
      return `Add-on${plural ? "s" : ""}${m.groups!.rest ?? ""}`;
    },
  ],
];

/** "-adresse" → "-Adresse", "s" stays. */
function emailRest(rest = ""): string {
  if (!rest.startsWith("-")) return rest;
  return `-${rest[1].toUpperCase()}${rest.slice(2)}`;
}

function compounds(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const [regex, fix] of FRAMES) {
    if (!mayRun(ctx, regex)) continue;
    for (const m of frameMatches(ctx, regex)) {
      const typed = m.groups!.target;
      const replacement = fix(m, ctx);
      if (!replacement || replacement === typed || ctx.dictionary.has(typed.toLowerCase()))
        continue;
      const [start, end] = m.indices!.groups!.target;
      findings.push({
        ruleId: "germanCompounds",
        messageKey: "review_msg_closed_compound",
        range: { start, end },
        alternatives: [
          /^\p{Lu}/u.test(typed)
            ? replacement[0].toUpperCase() + replacement.slice(1)
            : replacement,
        ],
        context: { start: Math.max(0, start - 40), end: end + 20 },
      });
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanCompounds"], detect: compounds },
];
