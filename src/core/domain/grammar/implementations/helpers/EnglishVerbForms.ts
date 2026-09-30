/** Authored common forms, not suffix inference. Shared by finished-text verb checks. */
export interface EnglishVerbForms {
  lemma: string;
  third: string;
  past: string;
  participle: string;
  /** Forms that are also an independent base verb (saw wood, found a company). */
  ambiguous: readonly string[];
}

export const ENGLISH_VERB_FORMS: readonly EnglishVerbForms[] = [
  ["understand", "understands", "understood", "understood"],
  ["go", "goes", "went", "gone"],
  ["work", "works", "worked", "worked"],
  ["know", "knows", "knew", "known"],
  ["come", "comes", "came", "come"],
  ["eat", "eats", "ate", "eaten"],
  ["give", "gives", "gave", "given"],
  ["take", "takes", "took", "taken"],
  ["write", "writes", "wrote", "written"],
  ["speak", "speaks", "spoke", "spoken"],
  ["make", "makes", "made", "made"],
  ["run", "runs", "ran", "run"],
  ["do", "does", "did", "done"],
  ["have", "has", "had", "had"],
  ["read", "reads", "read", "read"],
  ["cut", "cuts", "cut", "cut"],
  ["set", "sets", "set", "set"],
  ["see", "sees", "saw", "seen", "saw"],
  ["find", "finds", "found", "found", "found"],
  ["bring", "brings", "brought", "brought"],
  ["buy", "buys", "bought", "bought"],
  ["send", "sends", "sent", "sent"],
  ["choose", "chooses", "chose", "chosen"],
  ["begin", "begins", "began", "begun"],
].map(([lemma, third, past, participle, ...ambiguous]) => ({
  lemma,
  third,
  past,
  participle,
  ambiguous,
}));

// Built once. A collision is ambiguity, never last-entry-wins.
const BY_FORM = new Map<string, EnglishVerbForms | null>();
for (const entry of ENGLISH_VERB_FORMS) {
  for (const form of new Set([entry.lemma, entry.third, entry.past, entry.participle])) {
    BY_FORM.set(form, BY_FORM.has(form) ? null : entry);
  }
}

export function englishVerbForms(word: string): EnglishVerbForms | null {
  return BY_FORM.get(word.toLowerCase()) ?? null;
}

// Only the gerunds used by the native complement frames; never infer by suffix.
const GERUNDS: Readonly<Record<string, string>> = {
  fix: "fixing",
  deploy: "deploying",
  meet: "meeting",
  make: "making",
  take: "taking",
  write: "writing",
  run: "running",
  come: "coming",
  see: "seeing",
  learn: "learning",
  visit: "visiting",
  read: "reading",
  send: "sending",
  go: "going",
};
export function englishVerbGerund(lemma: string): string | null {
  return Object.hasOwn(GERUNDS, lemma.toLowerCase()) ? GERUNDS[lemma.toLowerCase()] : null;
}
