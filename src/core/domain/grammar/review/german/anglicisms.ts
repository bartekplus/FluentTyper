import { namedExampleBefore } from "../exampleCues";
import { finding } from "../finding";
import { frameMatches } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { englishLine, isGerman, tokensAfter, WORD_GATE } from "./shared";

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
const cap = (w: string) => `[${w[0].toUpperCase()}]${w.slice(1)}`;
const ci = (w: string) => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`;
const PARTICLES = [...new Set(Object.values(PAIRS).flat())];
// A capital first part (a German noun), then the particle: apart, with a hyphen, or joined.
const PHRASAL_NOUN = new RegExp(
  `${WORD_GATE}(?<target>(?<verb>${Object.keys(PAIRS).map(cap).join("|")})(?<sep>[ \\t]+|-)?(?<particle>${PARTICLES.map(ci).join("|")})(?<plural>s)?)(?![\\p{L}\\p{N}-])(?![ \\t]+\\p{Lu})`,
  "gdu",
);

const DETERMINER =
  /^(?:der|die|das|den|dem|des|(?:k?ein|mein|dein|sein|ihr|unser|eu[e]?r|dies|jen|jed|welch)\p{Ll}*|\p{N}.*)$/iu;

function anglicisms(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PHRASAL_NOUN)) {
    const { target, verb, sep, particle, plural } = m.groups!;
    const low = verb.toLowerCase();
    if (!PAIRS[low].includes(particle.toLowerCase())) continue;
    // Already right, or joined where the joined form is in use.
    if (sep === "-" && particle === particle.toLowerCase()) continue;
    if (!sep && !JOINED_WRONG.has(low + particle.toLowerCase())) continue;
    const [start, end] = m.indices!.groups!.target;
    // "das Log in den Ordner", "zum Check in eine Werkstatt": the German preposition "in".
    if (particle === "in" && sep !== "-" && DETERMINER.test(tokensAfter(ctx.text, end, 1)[0] ?? ""))
      continue;
    if (ctx.dictionary.has(target.toLowerCase()) || englishLine(ctx.text, start)) continue;
    if (namedExampleBefore(ctx.text, start)) continue;
    findings.push(
      finding(
        "germanCompounds",
        "review_msg_closed_compound",
        start,
        end,
        [`${verb}-${particle.toLowerCase()}${plural ?? ""}`],
        { context: { start, end } },
      ),
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanCompounds"], detect: anglicisms },
];
