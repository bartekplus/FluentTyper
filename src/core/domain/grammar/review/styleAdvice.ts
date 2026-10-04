import type { RawFinding } from "./reviewDetectors";
import type { ProtectedRange, ReviewSourceSnapshot } from "./types";
import { MAX_REVIEW_CHARS } from "./types";
import { TOKEN_END, WORD_START } from "./phraseTemplates";

// Acronyms whose last letter already names the noun after them.
const PAIRS = [
  ...["PIN number", "VIN number", "ISBN number", "ATM machine", "GUI interface", "TUI interface"],
  ...["CLI interface", "LCD display", "LED diode", "LLM model", "USD dollar", "PCB board"],
  ...["BWT transform", "FFT transform", "DFT transform", "HIV virus", "RAM memory", "NIC card"],
  "UPC code",
];
const SINGULAR_NOUNS = new Set(PAIRS.map((pair) => pair.split(" ")[1]));
const PLEONASMS = PAIRS
  // A shouted pair and plurals too: "VIN NUMBER", "ATM machines".
  .map((pair) => {
    const [acronym, noun] = pair.split(" ");
    const plural = /(?:s|x|ch|sh)$/.test(noun) ? "es" : "s";
    return `${acronym}[ \\t\\u00a0]{1,8}(?:${noun}(?:${plural})?|${noun.toUpperCase()}(?:${plural.toUpperCase()})?)`;
  })
  .join("|");
const PLEONASM = new RegExp(`${WORD_START}(?:${PLEONASMS})${TOKEN_END}`, "gu");

/** Explicit acronym pairs only; this does not rewrite voice, hedges or measurements. */
export function redundantAcronyms(
  snapshot: ReviewSourceSnapshot,
  protectedRanges: readonly ProtectedRange[],
  dictionary: ReadonlySet<string>,
): RawFinding[] {
  const text = snapshot.text;
  if (text.length > MAX_REVIEW_CHARS || snapshot.incomplete) return [];
  // Most texts name no pair: skip the quote scan.
  const matches = [...text.matchAll(PLEONASM)];
  if (!matches.length) return [];
  // Quote state spans sentences/paragraphs. Apostrophes inside words are not quotes.
  const quoted = new Uint8Array(text.length);
  for (const range of protectedRanges)
    quoted.fill(1, Math.max(0, range.start), Math.min(text.length, range.end));
  const closers: Record<string, string> = {
    '"': '"',
    "'": "'",
    "“": "”",
    "‘": "’",
    "«": "»",
    "‹": "›",
    "„": "”“",
    "‚": "’‘",
  };
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (quoted[i]) continue;
    const char = text[i];
    if (
      (char === "'" || char === "’") &&
      /\p{L}/u.test(text[i - 1] ?? "") &&
      (/\p{L}/u.test(text[i + 1] ?? "") || stack.length === 0)
    ) {
      quoted[i] = stack.length > 0 ? 1 : 0;
      continue;
    }
    if (stack.at(-1)?.includes(char)) {
      quoted[i] = 1;
      stack.pop();
    } else if (char in closers) {
      stack.push(closers[char]);
      quoted[i] = 1;
    } else if (/[”’»›]/u.test(char)) {
      return [];
    } else quoted[i] = stack.length > 0 ? 1 : 0;
  }
  const findings: RawFinding[] = [];
  for (const match of matches) {
    const start = match.index,
      end = start + match[0].length;
    if (
      start < snapshot.scope.start ||
      end > snapshot.scope.end ||
      quoted.subarray(start, end).some(Boolean)
    )
      continue;
    const [acronym, noun] = match[0].split(/[ \t\u00a0]+/);
    if (dictionary.has(acronym.toLowerCase()) || dictionary.has(noun.toLowerCase())) continue;
    findings.push({
      ruleId: "styleRedundancy",
      messageKey: "review_msg_style_redundancy",
      range: { start, end },
      // "ATM machines" -> "ATMs"; an amount in "USD dollars" stays "USD".
      alternatives: [
        !SINGULAR_NOUNS.has(noun.toLowerCase()) && acronym !== "USD" ? `${acronym}s` : acronym,
      ],
      context: { start: 0, end: text.length },
    });
  }
  return findings;
}
