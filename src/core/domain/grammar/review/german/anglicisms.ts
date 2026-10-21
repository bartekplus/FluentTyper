import { namedExampleBefore } from "../exampleCues";
import { finding } from "../finding";
import type { MatchFixer } from "../../engine/reviewRules";
import { englishLine, tokensAfter } from "./shared";

// An English noun of a verb and a particle takes a hyphen in German, the particle in lowercase
// (Duden): "Check In", "Check-In" → "Check-in", "Make Up" → "Make-up", "Burn Out" → "Burn-out".
// Run by germanCompounds. Every pair is authored.

const PAIRS: Readonly<Record<string, readonly string[]>> = {
  check: ["in", "out"],
  make: ["up"],
  stand: ["up"],
  burn: ["out"],
  pop: ["up"],
  add: ["on"],
  plug: ["in"],
  log: ["in", "out"],
  drive: ["in"],
  buy: ["out", "in"],
  kick: ["off"],
  follow: ["up"],
  push: ["up"],
  coming: ["out"],
  roll: ["out"],
  set: ["up"],
  sit: ["in"],
  warm: ["up"],
  cool: ["down"],
  start: ["up"],
  take: ["off"],
  pick: ["up"],
  walk: ["in"],
  knock: ["out"],
  teach: ["in"],
  break: ["even"],
  must: ["have"],
};
// Written as one word, these are wrong too; "Plugin", "Popup", "Setup" and "Startup" are in use.
const JOINED_WRONG = new Set([
  "checkin",
  "checkout",
  "makeup",
  "standup",
  "drivein",
  "pushup",
  "comingout",
  "followup",
  "kickoff",
  "breakeven",
  "musthave",
]);
const DETERMINER =
  /^(?:der|die|das|den|dem|des|(?:k?ein|mein|dein|sein|ihr|unser|eu[e]?r|dies|jen|jed|welch)\p{L}*|\p{N}.*)$/iu;

/** The named frame fixes of the de.anglicisms rule (grammar/rules/de.yaml). */
export const FIXERS = {
  phrasalNoun: (m, ctx) => {
    const { target, verb, sep, particle, plural } = m.groups!;
    const low = verb.toLowerCase();
    if (!PAIRS[low].includes(particle.toLowerCase())) return null;
    // Already right, or joined where the joined form is in use.
    if (sep === "-" && particle === particle.toLowerCase()) return null;
    if (!sep && !JOINED_WRONG.has(low + particle.toLowerCase())) return null;
    const [start, end] = m.indices!.groups!.target;
    // "das Log in den Ordner", "zum Check in eine Werkstatt": the German preposition "in".
    if (particle === "in" && sep !== "-" && DETERMINER.test(tokensAfter(ctx.text, end, 1)[0] ?? ""))
      return null;
    if (ctx.dictionary.has(target.toLowerCase()) || englishLine(ctx.text, start)) return null;
    if (namedExampleBefore(ctx.text, start)) return null;
    return finding(
      "germanCompounds",
      "review_msg_closed_compound",
      start,
      end,
      [`${verb}-${particle.toLowerCase()}${plural ?? ""}`],
      { context: { start, end } },
    );
  },
} satisfies Record<string, MatchFixer>;
