// Runs the Review lexicon generators (scripts/generate-<language>-lexicon.ts).
// Usage: bun run generate:lexicons [language...]   (default: all; for example "german french")
const LANGUAGES = [
  "arabic",
  "english",
  "french",
  "german",
  "polish",
  "portuguese",
  "spanish",
  "swedish",
];

const asked = process.argv.slice(2);
const unknown = asked.filter((language) => !LANGUAGES.includes(language));
if (unknown.length) throw new Error(`unknown language: ${unknown.join(", ")}`);
for (const language of asked.length ? asked : LANGUAGES) {
  const run = Bun.spawnSync(
    [process.execPath, `${import.meta.dir}/generate-${language}-lexicon.ts`],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (run.exitCode !== 0) process.exit(run.exitCode ?? 1);
}
