/** Authored common forms, not suffix inference. Shared by finished-text verb checks. */
export interface EnglishVerbForms {
  lemma: string;
  third: string;
  past: string;
  participle: string;
  /**
   * Forms that are also a word written on purpose: another base verb (saw wood,
   * found a company, fell a tree) or a common noun or adjective (a bit, the left).
   */
  ambiguous: readonly string[];
}

// "lemma third past participle [ambiguous...]". "lay" is both a lemma and lie's
// past, so its lookup is null. Verbs whose regular past is also a standard
// participle (show, sew, prove) and dialect-split forms (dove, gotten) stay out.
export const ENGLISH_VERB_FORMS: readonly EnglishVerbForms[] = [
  "arise arises arose arisen",
  "awake awakes awoke awoken",
  "bear bears bore borne bore",
  "beat beats beat beaten",
  "become becomes became become",
  "begin begins began begun",
  "bend bends bent bent",
  "bet bets bet bet",
  "bind binds bound bound bound",
  "bite bites bit bitten bit",
  "bleed bleeds bled bled",
  "blow blows blew blown",
  "break breaks broke broken",
  "breed breeds bred bred",
  "bring brings brought brought",
  "build builds built built",
  "burst bursts burst burst",
  "buy buys bought bought",
  "catch catches caught caught",
  "choose chooses chose chosen",
  "cling clings clung clung",
  "come comes came come",
  "cost costs cost cost",
  "creep creeps crept crept",
  "cut cuts cut cut",
  "deal deals dealt dealt",
  "dig digs dug dug",
  "do does did done",
  "draw draws drew drawn",
  "drink drinks drank drunk drunk",
  "drive drives drove driven",
  "eat eats ate eaten",
  "fall falls fell fallen fell",
  "feed feeds fed fed",
  "feel feels felt felt felt",
  "fight fights fought fought",
  "find finds found found found",
  "flee flees fled fled",
  "fling flings flung flung",
  "fly flies flew flown",
  "forbid forbids forbade forbidden",
  "forget forgets forgot forgotten",
  "forgive forgives forgave forgiven",
  "freeze freezes froze frozen",
  "get gets got got",
  "give gives gave given",
  "go goes went gone",
  "grind grinds ground ground ground",
  "grow grows grew grown",
  "hang hangs hung hung",
  "have has had had",
  "hear hears heard heard",
  "hide hides hid hidden",
  "hit hits hit hit",
  "hold holds held held",
  "hurt hurts hurt hurt",
  "keep keeps kept kept",
  "kneel kneels knelt knelt",
  "know knows knew known",
  "lay lays laid laid",
  "lead leads led led led",
  "leave leaves left left left",
  "lend lends lent lent",
  "let lets let let",
  "lie lies lay lain",
  "light lights lit lit lit",
  "lose loses lost lost",
  "make makes made made",
  "mean means meant meant",
  "meet meets met met",
  "mislead misleads misled misled",
  "mistake mistakes mistook mistaken",
  "misunderstand misunderstands misunderstood misunderstood",
  "overcome overcomes overcame overcome",
  "overtake overtakes overtook overtaken",
  "overwrite overwrites overwrote overwritten",
  "pay pays paid paid",
  "put puts put put",
  "quit quits quit quit",
  "read reads read read",
  "rebuild rebuilds rebuilt rebuilt",
  "redo redoes redid redone",
  "rerun reruns reran rerun",
  "reset resets reset reset",
  "rewrite rewrites rewrote rewritten",
  "ride rides rode ridden",
  "ring rings rang rung rung",
  "rise rises rose risen rose",
  "run runs ran run",
  "say says said said",
  "see sees saw seen saw",
  "seek seeks sought sought",
  "sell sells sold sold",
  "send sends sent sent",
  "set sets set set",
  "shake shakes shook shaken",
  "shine shines shone shone",
  "shoot shoots shot shot shot",
  "shrink shrinks shrank shrunk",
  "shut shuts shut shut",
  "sing sings sang sung",
  "sink sinks sank sunk",
  "sit sits sat sat",
  "sleep sleeps slept slept",
  "slide slides slid slid",
  "speak speaks spoke spoken",
  "spend spends spent spent",
  "spin spins spun spun",
  "split splits split split",
  "spread spreads spread spread",
  "spring springs sprang sprung",
  "stand stands stood stood",
  "steal steals stole stolen stole",
  "stick sticks stuck stuck",
  "sting stings stung stung",
  "stink stinks stank stunk",
  "strike strikes struck struck",
  "swear swears swore sworn",
  "sweep sweeps swept swept",
  "swim swims swam swum",
  "swing swings swung swung",
  "take takes took taken",
  "teach teaches taught taught",
  "tear tears tore torn",
  "tell tells told told",
  "think thinks thought thought",
  "throw throws threw thrown",
  "undergo undergoes underwent undergone",
  "understand understands understood understood",
  "undertake undertakes undertook undertaken",
  "undo undoes undid undone",
  "upset upsets upset upset",
  "wake wakes woke woken",
  "wear wears wore worn",
  "weep weeps wept wept",
  "win wins won won",
  "wind winds wound wound wound",
  "withdraw withdraws withdrew withdrawn",
  "work works worked worked",
  "write writes wrote written",
].map((row) => {
  const [lemma, third, past, participle, ...ambiguous] = row.split(" ");
  return { lemma, third, past, participle, ambiguous };
});

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
