/**
 * Review spelling micro-benchmark: how long PresageEngine.lookupWords takes per
 * word, for words the dictionary knows, near-miss typos and foreign words, per
 * language (plus stray short tokens). With --predictors it also times each spelling predictor alone
 * (a Presage instance whose presage.xml lists only that predictor).
 *
 *   bun scripts/benchmark-review-spelling.ts [--lang=fr_FR,pt_BR] [--predictors] [--runs=3]
 *
 * Words are our own; each is timed on a fresh engine call so Presage caches
 * nothing between words of the same kind.
 */
import libPresage from "../src/third_party/libpresage/libpresage.js";
import { PresageEngine } from "../src/adapters/chrome/background/PresageEngine";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";

const WORDS: Record<
  string,
  { known: string[]; typo: string[]; foreign: string[]; short?: string[] }
> = {
  en_US: {
    known: ["house", "because", "information", "beautiful", "running"],
    typo: ["becuase", "recieve", "definately", "untill", "beleive"],
    foreign: ["maintenant", "rapidement", "obrigado", "dziękuję", "schnell"],
    short: ["dd", "ll", "ov"],
  },
  fr_FR: {
    known: ["maison", "rapidement", "importait", "beaucoup", "travaillons"],
    typo: ["maisson", "rapidemment", "beaucop", "travailons", "aujourdhui"],
    foreign: ["understanding", "essentially", "obrigado", "schnell", "wonderful"],
    short: ["dd", "ll", "qq"],
  },
  pt_BR: {
    known: ["casa", "rapidamente", "obrigado", "trabalhamos", "essencialmente"],
    typo: ["rapidamete", "trabalhamso", "obrigafo", "resgastar", "excessão"],
    foreign: ["essentiellement", "understanding", "wonderful", "maintenant", "schnell"],
    short: ["dd", "ll", "nao"],
  },
  pl_PL: {
    known: ["dom", "szybko", "dziękuję", "pracujemy", "rzeczywiście"],
    typo: ["szybo", "dziekuje", "pracujmey", "rzeczywiscie", "wogóle"],
    foreign: ["understanding", "maintenant", "obrigado", "wonderful", "schnell"],
    short: ["dd", "ll", "naj"],
  },
  de_DE: {
    known: ["Haus", "schnell", "wirklich", "arbeiten", "Entscheidung"],
    typo: ["schnel", "wirklih", "arbieten", "Entscheidnug", "vieleicht"],
    foreign: ["understanding", "maintenant", "obrigado", "wonderful", "rapidement"],
    short: ["dd", "ll", "ss"],
  },
  es_ES: {
    known: ["casa", "rápidamente", "gracias", "trabajamos", "entonces"],
    typo: ["rapidamente", "grasias", "trabajamso", "entonses", "haber"],
    foreign: ["understanding", "maintenant", "obrigado", "wonderful", "schnell"],
    short: ["dd", "ll", "qe"],
  },
};

const PREDICTORS = [
  "DefaultHunspellPredictor",
  "DefaultAspellPredictor",
  "DefaultSmoothedNgramTriePredictor",
];

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const langs = (arg("lang") ?? Object.keys(WORDS).join(",")).split(",");
const runs = Number(arg("runs") ?? 3);
const root = `${import.meta.dir}/..`;

const module = (await libPresage({
  locateFile: (name: string) =>
    name.endsWith(".wasm")
      ? `${root}/src/third_party/libpresage/${name}`
      : `${root}/public/third_party/libpresage/${name}`,
})) as PresageModule;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (ms: number) => ms.toFixed(1).padStart(7);

function timeWord(lookup: (word: string) => unknown, word: string): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    lookup(word);
    times.push(performance.now() - t);
  }
  return median(times);
}

for (const lang of langs) {
  const words = WORDS[lang];
  if (!words) throw new Error(`no words for ${lang}`);
  const engine = new PresageEngine(module, { numSuggestions: 10, prefixOnlyMode: false }, lang);
  const lookup = (word: string) => engine.lookupWords([{ word, before: "" }]);
  lookup("warmup");
  console.log(`\n## ${lang}  (median of ${runs}, ms)`);
  const xml = module.FS.readFile(`/resources_js/${lang}/presage.xml`, { encoding: "utf8" });
  const alone = new Map<string, PresageEngine>();
  if (process.argv.includes("--predictors")) {
    for (const predictor of PREDICTORS) {
      const path = `/resources_js/${lang}/bench-${predictor}.xml`;
      module.FS.writeFile(
        path,
        xml.replace(/<PREDICTORS>[^<]*<\/PREDICTORS>/, `<PREDICTORS>${predictor}</PREDICTORS>`),
      );
      const only = new PresageEngine(module, { numSuggestions: 10, prefixOnlyMode: false }, lang);
      only.libPresage = new module.Presage(
        (only as unknown as { callbackImpl: unknown }).callbackImpl,
        path,
      );
      alone.set(predictor.replace(/^Default|Predictor$/g, ""), only);
    }
  }
  const header = ["lookup", ...alone.keys()].map((h) => h.slice(0, 9).padStart(9)).join("");
  console.log(`${"kind".padEnd(8)} ${"word".padEnd(18)}${header}  result`);
  const summary: string[] = [];
  for (const [kind, list] of Object.entries(words)) {
    const totals: number[] = [];
    for (const word of list) {
      const total = timeWord(lookup, word);
      totals.push(total);
      const parts = [...alone.values()].map((e) =>
        timeWord((w) => e.lookupWords([{ word: w, before: "" }]), word),
      );
      const [answer] = lookup(word);
      const shown = answer === null ? "known" : answer.slice(0, 4).join(", ");
      console.log(
        `${kind.padEnd(8)} ${word.padEnd(18)}${[total, ...parts].map((ms) => `  ${fmt(ms)}`).join("")}  ${shown}`,
      );
    }
    summary.push(
      `${kind} median ${median(totals).toFixed(0)} max ${Math.max(...totals).toFixed(0)}`,
    );
  }
  console.log(`summary ${lang}: ${summary.join(" | ")}`);
}
