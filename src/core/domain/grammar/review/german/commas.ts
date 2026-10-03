import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanAdjective, germanInfinitive } from "./germanLexicon";
import { ARTICLES, DEMONSTRATIVES, PREPOSITIONS } from "./nounCasing";
import {
  englishLine,
  isGerman,
  tokensAfter,
  tokensBefore,
  VERB_GOVERNORS,
  words,
  wordSet,
} from "./shared";
import { germanInfinitiveOf, isAuxiliary } from "./verbAgreement";

// The comma German sets before a clause or an infinitive group: "Er bleibt, weil es regnet",
// "Ich weiß nicht, ob er kommt", "Sie ging, um zu lesen", "Um zu lesen, ging sie", "Ich glaube,
// das stimmt". Each frame needs the word before to end the clause before; a joined pair ("als
// ob", "so dass", "und weil", "auch wenn") or a focus word ("nur weil") takes no comma between.

// Conjunctions that always open a subordinate clause.
const SUBORDINATORS = wordSet(
  "dass weil obwohl obgleich obschon wenngleich nachdem sobald sofern falls indem sodass " +
    "bevor wohingegen ob wenn sondern",
);
// Words that join with the conjunction after them, or set it off before themselves.
const JOINED = wordSet(
  "und oder sowie bzw beziehungsweise aber sondern denn doch jedoch als so ohne statt anstatt " +
    "außer kaum bis auf je nur auch selbst sogar gerade eben schon besonders insbesondere " +
    "allem zwar zumal nicht einfach allein bloß lediglich umso desto erst egal gleich dann " +
    "immer jedes halt also wie ja etwa vielleicht teils ob weil dass wenn außer nämlich " +
    "speziell vornehmlich hauptsächlich vermutlich wahrscheinlich sonst zum rund recht noch " +
    "kurz lang lange gleich bald unmittelbar direkt knapp beispiel spätestens frühestens " +
    "sofort nachdem",
);
// "drei Tage nachdem", "eine Woche bevor": the time span belongs to the clause.
const TIME_SPANS =
  /^(?:Tag|Tage|Tagen|Woche|Wochen|Monat|Monate|Monaten|Jahr|Jahre|Jahren|Stunde|Stunden|Minute|Minuten|Sekunde|Sekunden|Augenblick|Moment|Nacht|Nächte)$/;
// "wenn möglich", "falls nötig": a shortened clause, set off or not.
const ELLIPTICAL = wordSet(
  "möglich nötig notwendig erforderlich gewünscht ja nein nicht überhaupt",
);
// Infinitive groups after these take a comma in either order.
const INFINITIVE_LEADS = wordSet("um ohne statt anstatt");
// Verbs that take "um" as their preposition: "es geht um", "er bat um", "sich um etwas
// kümmern"; and "um" for an amount: "um zwei Tage verschieben".
const UM_VERBS = wordSet(
  "geht ging gehen ginge handelt handelte handeln handle bitte bittet bat baten bitten " +
    "kämpfen kämpft kämpfte sorgen sorgt sorgte kümmern kümmert kümmerte streiten streitet " +
    "bewerben bewirbt bewarb werben wirbt warb drehte dreht drehen bemühen bemüht bemühte " +
    "beneiden beneidet verzögern verschieben erhöhen senken verlängern verkürzen steigern " +
    "reduzieren verringern vergrößern verkleinern anheben",
);
const IMPERSONAL_UM = wordSet("geht ging gehen ginge handelt handelte handeln handle");
// Verbs that report an opinion or knowledge before a clause without "dass": "ich glaube, …".
const OPINIONS = wordSet(
  "glaube glaub glauben glaubt denke denk denken denkt hoffe hoff hoffen hofft finde find " +
    "finden findet befürchte befürchten befürchtet fürchte fürchten vermute vermuten " +
    "vermutet schätze schätzen wette wetten weiß wissen wisst behauptet behaupten meine " +
    "meinen meint",
);
const SUBJECTS = wordSet("ich wir ihr sie er man du");
// Asking for an opinion: "Meinst du, das klappt?"
const OPINION_QUESTIONS = wordSet(
  "glaubst glaubt glauben meinst meint meinen denkst denkt denken findest findet finden",
);
const QUESTION_SUBJECTS = wordSet("du ihr Sie");
// Fillers between the verb and its clause: "ich glaube übrigens, …", "ich denke mal, …".
const FILLERS = wordSet("mal übrigens ja schon auch eher persönlich halt eigentlich doch");
// Finite verbs that show a main clause has begun.
const FINITE = wordSet(
  "ist sind war waren wird werden wurde wurden hat haben hatte hatten kann können konnte " +
    "konnten muss müssen musste mussten soll sollen sollte sollten will wollen wollte " +
    "wollten darf dürfen durfte mag möchte möchten würde würden wäre wären sei seien gibt " +
    "gab geht ging gehen kommt kam kommen gefällt gefallen braucht brauchen macht steht " +
    "liegt läuft funktioniert klappt bleibt passt stimmt reicht hilft fehlt fehlen",
);
// Verbs of asking and knowing before an indirect w-question: "er fragt, wie …".
const ASKING = wordSet(
  "weiß weißt wisst wissen wusste wussten fragt fragte fragten frage fragen erkundigte " +
    "erkundigt verstehe verstehst versteht verstanden überlege überlegt überlegen",
);
const W_WORDS = wordSet(
  "was wer wen wem wie wo wann warum wieso weshalb weswegen woran wohin woher womit wofür " +
    "worüber wovon wozu",
);
// Words that may stand between the asking verb and the question: "weiß nicht mehr, wie".
const ASK_FILLERS = wordSet(
  "nicht noch auch gar genau schon mal selbst mehr nie ich du er sie es wir ihr man mich " +
    "dich sich uns euch mir dir ihm ihnen jetzt nun ja leider wirklich überhaupt",
);
const OBJECT_PRONOUNS = wordSet("mich dich sich uns euch mir dir ihm ihn es");

const isClauseEnd = (token: string | undefined) =>
  !token || /^(?:[.!?:;,()[\]"“”„«»‚‘’–—\n-])/.test(token);

function finding(ctx: DetectContext, wordStart: number, word: string, at: number): RawFinding {
  return {
    ruleId: "germanCommas",
    messageKey: "review_msg_german_comma",
    range: { start: wordStart, end: wordStart + word.length },
    alternatives: [`${word},`],
    context: { start: Math.max(0, wordStart - 40), end: Math.min(ctx.text.length, at + 40) },
  };
}

/** The word right before `index`, and where it starts, when only spaces come between. */
function wordBefore(text: string, index: number): { word: string; start: number } | null {
  const m = /([\p{L}\p{N}]+)[ \t ]+$/u.exec(text.slice(Math.max(0, index - 64), index));
  return m ? { word: m[1], start: index - m[0].length } : null;
}

/** A finite verb form: listed, or a regular third person ("lernt") of a known verb; not a
 * participle ("übereilt", "garantiert"). */
const finiteWord = (t: string) =>
  FINITE.has(t) ||
  isAuxiliary(t) ||
  (/^\p{Ll}{3,}t$/u.test(t) &&
    !/^(?:ge|be|ver|er|ent|zer|miss|über|unter|hinter|wider)|iert$/u.test(t) &&
    germanInfinitive(`${t.replace(/e?t$/, "")}en`));
// Capitalized words that open a clause without being its subject.
const NOT_SUBJECTS = wordSet(
  "wenn was wer wie wo wann warum als dass weil ob und aber doch denn so da dann dort hier " +
    "heute jetzt nun auch nur noch schon bitte danke ja nein vielleicht leider außerdem alle " +
    "viele einige manche beide jeder jede jedes keiner niemand jemand",
);

// Pairs that take the comma before their first word: "…, auch wenn", "…, ohne dass".
const PAIRS: Readonly<Record<string, readonly string[]>> = {
  auch: ["wenn"],
  selbst: ["wenn"],
  ohne: ["dass"],
  außer: ["dass", "wenn"],
  kaum: ["dass"],
  als: ["ob", "wenn", "dass"],
  anstatt: ["dass"],
  statt: ["dass"],
};

/** The tokens of the clause after `index`, up to its end (at most `n`). */
function clauseAfter(text: string, index: number, n: number): string[] {
  const tokens = tokensAfter(text, index, n);
  const end = tokens.findIndex((t) => isClauseEnd(t));
  return end < 0 ? tokens : tokens.slice(0, end);
}

/**
 * Whether the clause after `index` ends in a lowercase word, as a subordinate clause ends in
 * its verb ("weil es regnet"); "ob deiner Antwort" ends in a noun. Unknown past 24 tokens.
 */
function verbFinal(text: string, index: number): boolean {
  const tokens = tokensAfter(text, index, 24);
  const end = tokens.findIndex((t) => isClauseEnd(t));
  return end < 0 || (end > 0 && /^\p{Ll}/u.test(tokens[end - 1]));
}

/** Whether the clause before `index` starts right at `start` tokens back: a sentence start. */
const clauseStartBefore = (before: string[], at: number) =>
  at === 0 || isClauseEnd(before[at - 1]) || /^(?:und|aber|doch|denn)$/i.test(before[at - 1]);

const IRREGULAR = wordSet("sein tun haben werden wissen");

/** A zu-infinitive in the clause: "zu lesen", "anzurufen". */
function zuInfinitive(clause: string[]): number {
  for (let i = 0; i < clause.length; i++) {
    const token = clause[i];
    if (token === "zu" && i + 1 < clause.length) {
      const verb = clause[i + 1];
      if (/^\p{Ll}+$/u.test(verb) && (germanInfinitive(verb) || IRREGULAR.has(verb))) return i + 1;
    }
    if (
      /^\p{Ll}{2,}zu\p{Ll}+(?:en|ln|rn)$/u.test(token) &&
      germanInfinitive(token.replace("zu", ""))
    )
      return i;
  }
  return -1;
}

// Words that announce an infinitive group the clause's verb governs: "Es geht darum, …", "Es
// kommt darauf an, …", "Ich denke nicht daran, …".
const CORRELATES = wordSet("darum daran darauf dazu davon darüber darin davor");
// Particles that close the main clause after the correlate ("kommt darauf an"), when they
// make a verb with one of the clause's verbs.
const CORRELATE_PARTICLES = wordSet("an ab hin aus auf ein vor nach mit zu fest hinaus zurück");
// Verbs that take the infinitive themselves, so the pronominal adverb is an adverb ("Er
// versuchte darauf das Fenster zu öffnen": then).
const OWN_INFINITIVE =
  /^(?:gibt$|gab$|geben$|gäbe$|find|fand|ist$|war$|sind$|waren$|bleibt$|blieb$|steht$|stand$|versuch|begann|beginn|fing|hörte|vergaß|vergess|vergiss|plan|beschloss|beschließ|hoff|schein|wagt|droht|versprach|versprich|versprech|entschied|entschließ|vermocht|pflegt|lernt|lernte|half|hilf|bat|bitt|erlaub|empfahl|empfehl|riet|rät)/;
// Verbs before an adjective or participle that an infinitive group the "es" stands for
// completes: "Er ist es gewohnt, …", "Es macht mich traurig, …", "Es fällt mir schwer, …". A
// copula after "es" ("Es ist schwer(,) das zu sagen") leaves the comma optional.
const ES_LINKS = wordSet(
  "ist war wäre sei sind waren bin bist seid wird wurde würde macht machte fällt fiel habe " +
    "hast hat haben hatte hatten",
);
// Verbs whose object "es" is the infinitive group: "Er liebt es, lange zu schlafen".
const ES_OBJECT_VERBS = wordSet(
  "liebe liebst liebt lieben liebte hasse hasst hassen hasste genieße genießt genießen " +
    "genoss vermeide vermeidet vermeiden vermied bevorzuge bevorzugt bevorzugen",
);
const COPULAS = wordSet("ist war wäre sei sind waren bin bist seid wird wurde würde");
// Words between the verb and the adjective: "Es war Frauen damals nicht möglich".
const ES_FILLERS = wordSet(
  "es mich dich ihn ihm ihr uns euch ihnen mir dir sich nicht nie immer noch schon auch " +
    "damals heute jetzt oft wirklich gar so sehr ganz echt ziemlich recht doch ja eben " +
    "eigentlich wohl einfach",
);
const DETERMINER = /^(?:k?ein|mein|dein|sein|ihr|unser|euer|d(?:er|ie|as|en|em|es))\p{Ll}*$/u;
// Degree words that modify the next adjective, which would be the group's ("gut möglich").
const ES_DEGREE = wordSet("gut ganz sehr so recht ziemlich echt viel wenig zu");

/**
 * The tokens after `index` up to the clause end, when they form an infinitive group of at
 * least one word before its zu-infinitive, which ends the clause: "ihn so zu sehen", "hart
 * zu arbeiten", "euch einzuladen". Null otherwise.
 */
function infinitiveGroup(text: string, index: number): string[] | null {
  const clause = clauseAfter(text, index, 12);
  const verb = zuInfinitive(clause);
  if (verb < 0 || verb !== clause.length - 1) return null;
  const words = clause.slice(0, clause[verb - 1] === "zu" ? verb - 1 : verb);
  if (words.length === 0 || words.some((w) => !/^\p{L}+$/u.test(w))) return null;
  // A verb form inside would close another clause: "darauf gewartet ihn zu sehen"; so would
  // the clause's own verb: "schwer sein das zu erklären".
  const verbForm = (w: string) =>
    w === w.toLowerCase() &&
    (finiteWord(w) ||
      /^ge\p{Ll}{3,}(?:t|en)$/u.test(w) ||
      VERB_GOVERNORS.has(w) ||
      IRREGULAR.has(w));
  // Another clause or group inside: "darum und …", "daran dass …", "darauf ohne …".
  const linked = /^(?:und|oder|aber|sondern|denn|doch|dass|weil|wenn|ob|ohne|um|statt|anstatt)$/;
  if (words.some((w) => verbForm(w) || linked.test(w))) return null;
  // "Es gibt daran nichts zu tun": the object of the infinitive, which "gibt" governs.
  return /^(?:nichts|etwas|viel|vieles|wenig|einiges|genug|mehr|was)$/.test(words[0])
    ? null
    : words;
}

/** "Es geht darum euch …", "Es kommt darauf an ihn …": the word the comma follows. */
function correlateComma(
  ctx: DetectContext,
  typed: string,
  at: number,
  before: string[],
): { word: string; start: number } | null {
  const end = at + typed.length;
  const sentence = before.slice(before.findLastIndex((t) => isClauseEnd(t)) + 1);
  if (sentence.length === 0 || sentence.some((t) => OWN_INFINITIVE.test(t.toLowerCase())))
    return null;
  // "kurz darauf", "noch dazu", "gleich danach": an adverb of time or addition.
  if (/^(?:kurz|gleich|bald|noch|bis|und|oder|aber)$/i.test(before.at(-1) ?? "")) return null;
  let last = { word: typed, start: at };
  const next = /^[ \t]+(\p{Ll}+)(?=[ \t])/u.exec(ctx.text.slice(end, end + 24));
  const word = next?.[1] ?? "";
  // "kommt darauf an", "denken darüber nach": a particle of the clause's verb; "nicht daran
  // gedacht": the participle that closes the clause.
  const particle =
    CORRELATE_PARTICLES.has(word) &&
    sentence.some((t) => {
      const low = t.toLowerCase();
      const listed = germanInfinitiveOf(low);
      const stem = low.replace(/(?:e?test|e?tet|e?ten|e?te|e?st|e?t|en|e)$/, "");
      return [listed, `${stem}en`, `${stem}n`].some((inf) => inf && germanInfinitive(word + inf));
    });
  const participle = /^ge\p{Ll}{3,}(?:t|en)$/u.test(word) && !isAuxiliary(word);
  if (next && (particle || participle)) {
    last = { word, start: end + next[0].length - word.length };
  }
  return infinitiveGroup(ctx.text, last.start + last.word.length) ? last : null;
}

/**
 * "Er ist es gewohnt hart …", "Es macht mich traurig ihn …": the word the comma follows, for
 * an "es" at `at` that stands for the infinitive group.
 */
function esComma(ctx: DetectContext, at: number): { word: string; start: number } | null {
  const back = tokensBefore(ctx.text, at, 2);
  const prior = (back.at(-1) ?? "").toLowerCase();
  let tokens = tokensAfter(ctx.text, at + 2, 9);
  let from = at + 2;
  if (ES_OBJECT_VERBS.has(prior)) {
    return infinitiveGroup(ctx.text, at + 2)
      ? { word: ctx.text.slice(at, at + 2), start: at }
      : null;
  }
  // "Es macht …" opens the clause; "… ist es …" follows the verb.
  if (!ES_LINKS.has(prior)) {
    const verb = tokens[0] ?? "";
    if (!isClauseEnd(back.at(-1)) || !ES_LINKS.has(verb) || COPULAS.has(verb)) return null;
    from = ctx.text.indexOf(tokens[0], from) + tokens[0].length;
    tokens = tokens.slice(1);
  }
  let i = 0;
  while (i < tokens.length && (ES_FILLERS.has(tokens[i]) || /^\p{Lu}\p{Ll}+$/u.test(tokens[i]))) {
    // Only a dative noun or two ("Frauen") between, never a whole phrase.
    if (i > 3) return null;
    i++;
  }
  const word = tokens[i];
  if (!word || !/^\p{Ll}+$/u.test(word) || ES_DEGREE.has(word) || DETERMINER.test(word))
    return null;
  const participle = /^(?:ge\p{Ll}{3,}t|\p{Ll}{3,}iert)$/u.test(word);
  if (!germanAdjective(word) && !participle) return null;
  const last = { word, start: ctx.text.indexOf(word, from) };
  const group = infinitiveGroup(ctx.text, last.start + last.word.length);
  // "Es ist gut möglich zu …": a degree word, not a group.
  return group && !(group.length === 1 && ES_DEGREE.has(group[0])) ? last : null;
}

function commas(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const seen = new Set<number>();
  const push = (f: RawFinding | null) => {
    if (
      f &&
      !seen.has(f.range.end) &&
      !ctx.dictionary.has(ctx.text.slice(f.range.start, f.range.end).toLowerCase())
    ) {
      seen.add(f.range.end);
      findings.push(f);
    }
  };
  for (const m of words(ctx)) {
    const typed = m[0];
    const low = typed.toLowerCase();
    const at = m.index;
    const end = at + typed.length;
    if (englishLine(ctx.text, at) || namedExampleBefore(ctx.text, at)) continue;
    const prior = wordBefore(ctx.text, at);
    const before = tokensBefore(ctx.text, at, 8);
    // "Es geht darum euch …", "Es ist wichtig gesund zu essen": an infinitive group that a
    // correlate or "es" announces.
    if (typed === low && CORRELATES.has(low)) {
      const last = correlateComma(ctx, typed, at, before);
      if (last) push(finding(ctx, last.start, last.word, last.start));
      continue;
    }
    if (low === "es") {
      const last = esComma(ctx, at);
      if (last) push(finding(ctx, last.start, last.word, last.start));
      continue;
    }
    // A conjunction inside a sentence: "Er bleibt weil es regnet".
    const joined = (word: string) =>
      JOINED.has(word.toLowerCase()) && !(word === "nicht" && (low === "ob" || low === "dass"));
    if (typed === low && SUBORDINATORS.has(low) && prior && !joined(prior.word)) {
      const clause = clauseAfter(ctx.text, end, 12);
      // "sondern" joins any phrase: "kein Zufall, sondern Absicht".
      const ok =
        clause.length >= (low === "sondern" ? 1 : 2) &&
        (low === "sondern" || verbFinal(ctx.text, end)) &&
        !TIME_SPANS.test(prior.word) &&
        !(/^(?:wenn|falls|sofern)$/.test(low) && ELLIPTICAL.has(clause[0])) &&
        // "Insekten sondern Duftstoffe ab": the verb "absondern".
        !(low === "sondern" && clause.at(-1) === "ab") &&
        !(low === "nachdem" && prior.word.toLowerCase() === "je");
      if (ok) push(finding(ctx, prior.start, prior.word, at));
      continue;
    }
    // "Sie ging um zu lesen": an infinitive group inside the sentence.
    if (typed === low && INFINITIVE_LEADS.has(low) && prior) {
      if (JOINED.has(prior.word.toLowerCase())) continue;
      const clause = clauseAfter(ctx.text, end, 12);
      const verb = zuInfinitive(clause);
      // "ohne Schlüssel zu öffnen", "um 8 Uhr an zu fangen": a preposition before a noun or
      // a time; "es geht um das Recht zu leben", "sich um etwas zu kümmern": "um" the verb's.
      if (verb < 0 || /^(?:\p{Lu}|\p{N}|halb$|viertel$)/u.test(clause[0])) continue;
      if (clause.slice(0, 3).includes("Uhr")) continue;
      // "Sie ging nach Hause um sich umzuziehen": "gehen" and "handeln" take "um" only with
      // "es" ("es geht um", "es handelt sich um").
      const impersonal = before.some((t) => /^es$/i.test(t));
      const umVerb = (t: string) =>
        UM_VERBS.has(t.toLowerCase()) && (impersonal || !IMPERSONAL_UM.has(t.toLowerCase()));
      if (low === "um" && [...before, clause[verb]].some(umVerb)) continue;
      push(finding(ctx, prior.start, prior.word, at));
      continue;
    }
    // "Um zu lesen ging sie": an infinitive group that opens the sentence.
    if (INFINITIVE_LEADS.has(low) && typed !== low && clauseStartBefore(before, before.length)) {
      const clause = clauseAfter(ctx.text, end, 12);
      const verb = zuInfinitive(clause);
      const next = clause[verb + 1];
      if (verb >= 0 && next && /^\p{Ll}+$/u.test(next) && !JOINED.has(next)) {
        const verbStart = ctx.text.indexOf(clause[verb], end);
        push(finding(ctx, verbStart, clause[verb], verbStart));
      }
      continue;
    }
    // "Als ich es gesagt hatte bin ich gegangen": a clause's last verb right
    // before the next clause's verb; not a verb chain ("gesehen werden kann").
    if (typed === low && isAuxiliary(low)) {
      const next = /^[ \t]+(\p{Ll}+)(?!\p{L})/u.exec(ctx.text.slice(end, end + 24))?.[1];
      const chain = germanInfinitiveOf(low) === low || germanInfinitiveOf(next ?? "") === next;
      if (next && next !== low && isAuxiliary(next) && !chain) {
        push(finding(ctx, at, typed, end));
        continue;
      }
    }
    // "Sag mal hast du Zeit?": the request before the question.
    if (
      /^[Ss]agt?$/.test(typed) &&
      /^[ \t]+mal[ \t]+(\p{Ll}+)/u.test(ctx.text.slice(end, end + 24))
    ) {
      const verb = /^[ \t]+mal[ \t]+(\p{Ll}+)/u.exec(ctx.text.slice(end, end + 24))![1];
      const malAt = ctx.text.indexOf("mal", end);
      if (isAuxiliary(verb)) push(finding(ctx, malAt, "mal", malAt));
      continue;
    }
    // "Er kommt auch wenn es regnet": the comma goes before the pair.
    const pair = PAIRS[low];
    if (typed === low && pair && prior && !JOINED.has(prior.word.toLowerCase())) {
      const after = /^[ \t]+(\p{Ll}+)/u.exec(ctx.text.slice(end, end + 16))?.[1] ?? "";
      if (pair.includes(after) && verbFinal(ctx.text, end + 1 + after.length)) {
        push(finding(ctx, prior.start, prior.word, at));
        continue;
      }
    }
    // "Ich glaube das stimmt", "Meinst du das klappt?", "Peter behauptet seine Mutter …":
    // a main clause after an opinion verb.
    const last = before.length - 1;
    const subjectWord = before[last] ?? "";
    const pronounSubject =
      SUBJECTS.has(subjectWord.toLowerCase()) && clauseStartBefore(before, last);
    // "Peter behauptet …", "Die Menschen glauben …" at a sentence start; not "Für meinen
    // Bruder", "Wenn behauptet wird", "Was glauben Sie", "John F. Kennedy wissen".
    const sentenceOpens = (k: number) =>
      k < 0 || (/^[.!?\n]$/.test(before[k]) && (k === 0 || (before[k - 1] ?? "").length > 1));
    const subjectLow = subjectWord.toLowerCase();
    const nounSubject =
      /^\p{Lu}\p{Ll}+$/u.test(subjectWord) &&
      !SUBJECTS.has(subjectLow) &&
      !NOT_SUBJECTS.has(subjectLow) &&
      !ARTICLES.has(subjectLow) &&
      !DEMONSTRATIVES.has(subjectLow) &&
      !PREPOSITIONS.has(subjectLow) &&
      (sentenceOpens(last - 1) ||
        (/^(?:der|die|das)$/i.test(before[last - 1] ?? "") && sentenceOpens(last - 2)));
    const subjectFirst = typed === low && OPINIONS.has(low) && (pronounSubject || nounSubject);
    const asked = OPINION_QUESTIONS.has(low) && clauseStartBefore(before, before.length);
    if (subjectFirst || asked) {
      const clause = clauseAfter(ctx.text, end, 9);
      // The word the comma follows: the verb, its subject in a question, then fillers.
      let i = 0;
      let last = { word: typed, start: at };
      const take = () => {
        const start = ctx.text.indexOf(clause[i], last.start + last.word.length);
        last = { word: clause[i++], start };
      };
      if (!subjectFirst) {
        if (!QUESTION_SUBJECTS.has(clause[0] ?? "")) continue;
        take();
      }
      // "Ich denke mal, …": fillers stay before the comma ("ich hoffe, dir geht es gut").
      while (i < clause.length && FILLERS.has(clause[i])) take();
      const rest = clause.slice(i);
      // The clause's own finite verb within four words, something before it.
      const verbAt = rest.findIndex((t, k) => k > 0 && k <= 4 && finiteWord(t));
      if (verbAt < 1) continue;
      // "Ich glaube an Gott", "ich finde nicht, …": no clause of its own begins here.
      if (/^(?:an|auf|daran|darauf|nicht|nichts|kein|keine|so|auch|zu|sehr)$/i.test(rest[0]))
        continue;
      push(finding(ctx, last.start, last.word, last.start));
      continue;
    }
    // "Er fragt wie das geht": an indirect question.
    if (typed === low && W_WORDS.has(low) && prior) {
      let k = before.length - 1;
      while (k >= 0 && ASK_FILLERS.has(before[k].toLowerCase())) k--;
      if (k < 0 || !ASKING.has(before[k].toLowerCase())) continue;
      if (JOINED.has(prior.word.toLowerCase()) && prior.word.toLowerCase() !== "nicht") continue;
      const clause = clauseAfter(ctx.text, end, 12);
      const last = clause.at(-1) ?? "";
      if (clause.length >= 2 && /^\p{Ll}+$/u.test(last) && !OBJECT_PRONOUNS.has(last))
        push(finding(ctx, prior.start, prior.word, at));
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanCommas"], detect: commas },
];
