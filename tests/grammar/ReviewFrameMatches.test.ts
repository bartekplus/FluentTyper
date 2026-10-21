import { expect, test } from "bun:test";
import { frameScan } from "../../src/core/domain/grammar/review/phraseTemplates";
import type { DetectContext } from "../../src/core/domain/grammar/review/reviewDetectors";

const text = "We saw it. They saw it. You saw it.";
const ctx = {
  source: text,
  text,
  scanText: text,
  from: 0,
  to: text.length,
  lang: "en_US",
  dictionary: new Set<string>(),
  insertSpaceAfterAutocomplete: true,
} as DetectContext;
const PATTERN = "(?<target>saw)";
const starts = () => [...frameScan(ctx, PATTERN)].map((m) => m.index);

test("a cached string pattern scans the same on every call", () => {
  expect(starts()).toEqual([3, 16, 28]);
  expect(starts()).toEqual([3, 16, 28]);
});

test("a nested scan of the same pattern does not disturb the outer scan", () => {
  const outer: number[] = [];
  for (const m of frameScan(ctx, PATTERN)) {
    outer.push(m.index);
    expect(starts()).toEqual([3, 16, 28]);
  }
  expect(outer).toEqual([3, 16, 28]);
});

test("an abandoned scan leaves the pattern usable", () => {
  for (const m of frameScan(ctx, PATTERN)) if (m) break;
  const open = frameScan(ctx, PATTERN)[Symbol.iterator]();
  open.next();
  expect(starts()).toEqual([3, 16, 28]);
});

test("trailing context after the owner can open the next frame", () => {
  // Each frame owns a word and reads the next one: "saw it", then "it. They".
  const owners = [...frameScan(ctx, "(?<target>\\p{L}+)[ .]+(?<next>\\p{L}+)")].map(
    (m) => m.groups!.target,
  );
  expect(owners).toEqual(["We", "saw", "it", "They", "saw", "it", "You", "saw"]);
});

test("the literal prefilter keeps every match of case-sensitive and accented frames", () => {
  const at = (source: string) => {
    const ctxOf = (value: string) => ({
      ...ctx,
      source: value,
      text: value,
      scanText: value,
      to: value.length,
    });
    return (pattern: RegExp) =>
      [...frameScan(ctxOf(source) as DetectContext, pattern, null)].map((m) => m[0]);
  };
  // Case-sensitive: "Straße" is a literal run; the scan finds it, and only with its case.
  expect(at("Die Straße ist lang.")(/Straße/gu)).toEqual(["Straße"]);
  expect(at("die CAFÉ-Bar")(/Café/gu)).toEqual([]);
  expect(at("Das Café ist offen.")(/(?<target>Café)/dgu)).toEqual(["Café"]);
  // Ignoring case, an accented literal still matches its other case.
  expect(at("DAS CAFÉ IST OFFEN.")(/(?<target>café)/dgiu)).toEqual(["CAFÉ"]);
  // Letters that fold to others keep the scan running: a long s still matches "s".
  expect(at("Klaſse")(/(?<target>klasse)/dgiu)).toEqual(["Klaſse"]);
  expect(at("GROẞE")(/(?<target>große)/dgiu)).toEqual(["GROẞE"]);
});

test("İ, ſ, K, Å and ẞ keep the literal prefilter and the start positions on", () => {
  const ctxOf = (value: string) =>
    ({ ...ctx, source: value, text: value, scanText: value, to: value.length }) as DetectContext;
  // A frame that runs at its start positions runs a sticky copy: the regex itself never runs.
  const execs = (text: string, regex: RegExp) => {
    let calls = 0;
    const exec = regex.exec.bind(regex);
    regex.exec = (value) => (calls++, exec(value));
    const found = [...frameScan(ctxOf(text), regex)].map((m) => m.index);
    return { found, calls };
  };
  for (const letter of ["İ", "ſ", "K", "Å", "ẞ"]) {
    const text = `${letter}zmir. We saw it.`;
    expect(execs(text, /(?<target>saw)/dgiu)).toEqual({ found: [text.indexOf("saw")], calls: 0 });
    expect(execs(text, /(?<target>zebra)/dgiu)).toEqual({ found: [], calls: 0 });
  }
});

test("frames match across İ, ſ, K, Å and ẞ", () => {
  const at = (value: string, pattern: string | RegExp) =>
    [
      ...frameScan(
        { ...ctx, source: value, text: value, scanText: value, to: value.length },
        pattern,
        null,
      ),
    ].map((m) => [m.index, m[0]]);
  expect(at("İzmir İs nice. We saw it.", "saw")).toEqual([[18, "saw"]]);
  expect(at("İ saw", "saw")).toEqual([[2, "saw"]]);
  expect(at("Gut ſo. Klaſse", /klasse/dgiu)).toEqual([[8, "Klaſse"]]);
  expect(at("300 Kelvin", "kelvin")).toEqual([[4, "Kelvin"]]);
  expect(at("1 Ångström", "ångström")).toEqual([[2, "Ångström"]]);
  expect(at("DIE GROẞE STRAẞE", /stra(?:ß|ss)e/dgiu)).toEqual([[10, "STRAẞE"]]);
});

test("a frame may open on a contraction clitic glued to its host word", () => {
  const scan = (value: string, pattern: string, lang = "en_US") =>
    [
      ...frameScan(
        { ...ctx, source: value, text: value, scanText: value, to: value.length, lang },
        pattern,
      ),
    ].map((m) => m.groups!.target);
  // "'m", "'re", "'ll", "'ve" and "n't" start a word after their host.
  expect(scan("I'm no expert. They’re no help.", "['’](?:m|re)[ ](?<target>no)")).toEqual([
    "no",
    "no",
  ]);
  expect(scan("We don't care.", "n['’]t[ ](?<target>care)")).toEqual(["care"]);
  expect(scan("We'll go and you've seen it.", "['’](?:ll|ve)[ ](?<target>\\p{L}+)")).toEqual([
    "go",
    "seen",
  ]);
  // "'s" and "'d" are also possessives and past forms; other letters stay glued.
  expect(scan("Kim's car. He'd left.", "['’](?:s|d)[ ](?<target>\\p{L}+)")).toEqual([]);
  expect(scan("I'mmense.", "['’]m(?<target>m)")).toEqual([]);
  expect(scan("Notably", "(?<target>tably)")).toEqual([]);
  // Other languages' elisions keep their word edges.
  expect(scan("aujourd'hui", "['’](?<target>hui)", "fr_FR")).toEqual([]);
  expect(scan("Rio d'Janeiro", "['’](?<target>Janeiro)", "pt_BR")).toEqual([]);
  expect(scan("Ich hab's.", "['’](?<target>s)", "de_DE")).toEqual([]);
});
