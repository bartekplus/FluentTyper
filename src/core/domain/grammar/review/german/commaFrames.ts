import { finding } from "../finding";
import { frameMatches, SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { germanVerbLike } from "./germanLexicon";
import { gated as re, isGerman } from "./shared";
import { isAuxiliary } from "./verbAgreement";

// Commas around fixed words (run by germanCommas): a tag question ("Du kommst, nicht wahr?"),
// an inserted "glaube ich" ("Das ist, glaube ich, egal"), and paired words ("teils lustig,
// teils traurig", "halb …, halb …", "einerseits …, andererseits", "je …, desto", "So weit,
// so gut").

const CLAUSE = "[^.!?;:,\\n]";
const COPULAS = /^(?:ist|sind|war|waren|wäre|wären|sei|scheint|klingt|wird|wurde|bin|bist|seid)$/;
const COORDINATORS = /^(?:und|oder|aber|sowie|bzw)$/;

// The word that takes the comma after it. The gate first checks the paired word after it, so
// the long lookbehinds run only there.
const PAIRED = re(
  `(?=\\p{L}+${S}(?:teils|halb|andererseits|desto|umso|so)${E})(?:` +
    `(?<=(?:[Tt]eils)${S}(?:${CLAUSE}{0,60}?${S})?)(?<word>\\p{L}+)(?=${S}teils${E})|` +
    `(?<=[Hh]alb${S})(?<w2>\\p{L}+)(?=${S}halb${S}\\p{L})|` +
    `(?<=(?:^|[.!?;:\\n]${S}?)[Ee]inerseits${S}${CLAUSE}{0,80}?)(?<w3>\\p{L}+)(?=${S}andererseits${E})|` +
    `(?<=(?:^|[.!?\\n,]${S}?)[Jj]e${S}${CLAUSE}{0,80}?)(?<w4>\\p{L}+)(?=${S}(?:desto|umso)${E})|` +
    `(?<=[Ss]o${S})(?<w5>weit)(?=${S}so${S}gut${E}))`,
);
// "Du kommst morgen oder?", "Das stimmt nicht wahr?": the tag question after a statement.
const TAG = re(
  `(?<word>\\p{L}+)(?=${S}(?:oder(?:${S}etwa${S}nicht)?|nicht${S}wahr|gell|stimmt's|stimmts)[ \\t]*\\?)`,
);
// "Hallo wie geht es euch?": a greeting before a sentence takes a comma ("Hallo du" and
// "Hallo ihr beiden" address someone).
const GREETING = re(
  `(?<=(?:^|\\n|[„"]))(?<word>Hallo|Hi|Hey|Servus|Moin)(?=${S}(?:wie|was|wo|wann|warum|ich|wir|da|habt|hast|kannst|könnt|seid|bist)${E})`,
);
// "Wo denkst du ist es?": a w-question's verb follows an inserted "denkst du".
const OPINION_INSIDE = re(
  `(?<=(?:^|[.!?\\n][ \\t]*)(?:Wo|Was|Wie|Wann|Warum|Wieso|Weshalb|Wer|Wen|Wem|Wohin|Woher|Welche\\p{Ll}*)${S}(?:denkst|glaubst|meinst|denkt|glaubt|meint|dachtest|dachtet|dachten|glaubtest|glaubten|meintest|meinten|denken|glauben|meinen)${S})(?<word>du|ihr|Sie)(?=${S}(?:ist|sind|war|waren|soll|sollte|sollen|kann|könnte|wird|würde|hat|hätte|muss|müsste|sei|wäre|kommt|geht|passiert|liegt|steht|gibt)${E})`,
);
// "Das ist glaube ich egal": an inserted "glaube ich" after the finite verb.
const INSERTED = re(
  `(?<=(?:ist|sind|war|waren|hat|haben|hatte|hatten|wird|werden|kann|können|muss|müssen|soll|sollte|wäre|würde)(?:${S}(?:aber|doch|ja|auch))?${S})(?<target>(?:glaube|denke|finde|meine|schätze|vermute)${S}ich)(?=${S}\\p{L})`,
);

const named = (m: RegExpExecArray) =>
  ["word", "w2", "w3", "w4", "w5"].find((k) => m.groups![k] !== undefined)!;

export function commaFrames(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const push = (start: number, end: number, alternative: string) =>
    findings.push(
      finding("germanCommas", "review_msg_german_comma", start, end, [alternative], {
        context: { start: Math.max(0, start - 40), end: Math.min(ctx.text.length, end + 40) },
      }),
    );
  for (const m of frameMatches(ctx, PAIRED, (m) => m.indices!.groups![named(m)][0])) {
    const word = m.groups![named(m)];
    if (COORDINATORS.test(word)) continue;
    const [start, end] = m.indices!.groups![named(m)];
    push(start, end, `${word},`);
  }
  for (const m of frameMatches(ctx, OPINION_INSIDE, "word")) {
    const [start, end] = m.indices!.groups!.word;
    push(start, end, `${m.groups!.word},`);
  }
  for (const m of frameMatches(ctx, GREETING, "word")) {
    const [start, end] = m.indices!.groups!.word;
    push(start, end, `${m.groups!.word},`);
  }
  for (const m of frameMatches(ctx, TAG, "word")) {
    const word = m.groups!.word;
    const [start, end] = m.indices!.groups!.word;
    // A question that opens with its verb ("Ist das nicht wahr?") or a copula before "nicht
    // wahr" ("Das ist nicht wahr?") is no tag.
    const clause = ctx.text
      .slice(Math.max(0, start - 200), start)
      .split(/[.!?;:\n]/)
      .at(-1)!;
    const first = /\p{L}+/u.exec(clause)?.[0] ?? word;
    if (COPULAS.test(word) || COORDINATORS.test(word) || /^(?:entweder|das|es)$/i.test(word))
      continue;
    const low = first.toLowerCase();
    const verbFirst = isAuxiliary(low) || /st$/.test(low) || germanVerbLike(low);
    if (!/[ \t]/.test(clause.trim()) || verbFirst || /(?<!\p{L})entweder(?!\p{L})/iu.test(clause))
      continue;
    push(start, end, `${word},`);
  }
  for (const m of frameMatches(ctx, INSERTED)) {
    const [at, end] = m.indices!.groups!.target;
    const start = at - /[ \t\u00a0]*$/.exec(ctx.text.slice(Math.max(0, at - 8), at))![0].length;
    push(start, end, `, ${m.groups!.target.replace(/[ \t\u00a0]+/g, " ")},`);
  }
  return findings;
}
