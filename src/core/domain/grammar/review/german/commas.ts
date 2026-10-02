import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanInfinitive } from "./germanLexicon";
import { englishLine, isGerman, tokensAfter, tokensBefore, words, wordSet } from "./shared";

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
      if (low === "um" && [...before, clause[verb]].some((t) => UM_VERBS.has(t.toLowerCase())))
        continue;
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
    // "Ich glaube das stimmt", "Meinst du das klappt?": a main clause after an opinion verb.
    const subjectFirst =
      typed === low &&
      OPINIONS.has(low) &&
      SUBJECTS.has(before.at(-1)?.toLowerCase() ?? "") &&
      clauseStartBefore(before, before.length - 1);
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
      const verbAt = rest.findIndex((t, k) => k > 0 && k <= 4 && FINITE.has(t));
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
