import { SUPPORTED_PREDICTION_LANGUAGE_KEYS, TEXT_EXPANDER_LANG } from "../../lang";
import { ptConjugate } from "../library/portuguese/verbs";
import { scanStarts } from "./prefixes";
import { parseRows, type PhraseRow } from "./rows";
import {
  fileCode,
  functionCode,
  type CodeScope,
  type FileCode,
  type FunctionCode,
  type Names,
} from "./ruleCode";
import {
  CLAUSE,
  COMPLETE,
  COMPLETE_OR_PAREN,
  EDGE,
  frame,
  notAfter,
  requiredLiterals,
  SPACE,
  TOKEN_END,
  WORD_END,
  WORD_START,
} from "../review/phraseTemplates";
import type { CheckSpec, CompiledFrame, CompiledRule, RuleFile, RuleSpec } from "./types";

/*
 * Validates the declarative rule files and compiles them. Pure: scripts/compile-grammar-rules.ts
 * runs it at build time and writes the result to the *.generated.ts modules; tests run it to
 * prove the generated modules are current. Every problem is collected and thrown at once.
 */

/** The order of rule files: shared rules first, then one file per language. */
export const RULE_FILES = [
  "common",
  "en",
  "es",
  "fr",
  "hr",
  "el",
  "sv",
  "pl",
  "de",
  "pt_BR",
  "ar_SA",
] as const;

const NAMED_LANGUAGES = SUPPORTED_PREDICTION_LANGUAGE_KEYS.filter(
  (lang) => lang !== TEXT_EXPANDER_LANG,
);
const PHRASE_KINDS = ["words", "phrases", "compounds", "style"] as const;
const RULE_KEYS = new Set<keyof RuleSpec>([
  "id",
  "checks",
  "lang",
  "modes",
  "stage",
  "cacheable",
  "message",
  "frames",
  "style",
  "filter",
  "group",
  "findings",
  "let",
  "when",
  "return",
  "triggers",
  "defs",
  "sets",
  "maps",
]);
const FRAME_KEYS = new Set([
  "regex",
  "fix",
  "let",
  "when",
  "return",
  "name",
  "raw",
  "message",
  "clauseStart",
  "check",
  "cue",
  "wordStart",
  "verbatim",
  "lowercase",
  "capitalized",
  "ownCase",
  "targetOnly",
  "flags",
  "scan",
  "lookback",
  "lookahead",
  "anyCheck",
  "owner",
  "gate",
  "gateFlags",
  "lang",
]);
const SCANS = new Set(["frame", "owned", "text", "polish"]);
const FILE_KEYS = new Set<keyof RuleFile>([
  "lang",
  "checks",
  "exclusive",
  "rules",
  "phrases",
  "tables",
  "fragments",
  "sets",
  "maps",
  "defs",
]);
const BUILTIN_FRAGMENTS: Readonly<Record<string, string>> = {
  S: SPACE,
  E: WORD_END,
  COMPLETE,
  COMPLETE_OR_PAREN,
  CLAUSE,
  TOKEN_END,
  EDGE,
};

/**
 * `regex` with its `{{NAME}}` fragments and `{{notAfter:words}}` guards expanded. Fragments may
 * hold fragments, also inside the words of a guard: the innermost ones expand first.
 */
export function expandFrame(
  regex: string,
  fragments: Readonly<Record<string, string>>,
  where: string,
  errors: string[],
): string {
  let text = regex;
  for (let round = 0; text.includes("{{"); round += 1) {
    if (round > 16) {
      errors.push(`${where}: fragments nest too deep`);
      break;
    }
    text = text.replace(/\{\{(\w+)(?::([^{}]*))?\}\}/g, (_, name: string, words?: string) => {
      if (name === "notAfter" && words !== undefined) return notAfter(words);
      const value = fragments[name] ?? BUILTIN_FRAGMENTS[name];
      if (value !== undefined) return value;
      errors.push(`${where}: unknown fragment "${name}"`);
      return "";
    });
  }
  return text;
}
const CHECK_KEYS = new Set<keyof CheckSpec>([
  "id",
  "modes",
  "priority",
  "scope",
  "title",
  "description",
  "rollout",
  "codeSafe",
  "category",
  "kind",
  "safeToFix",
  "enabled",
  "languages",
  "note",
  "excluded",
  "text",
  "example",
]);
export const UI_LANGUAGES = ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"];

interface CatalogEntryOut {
  id: string;
  typing?: false;
  titleI18nKey: string;
  descriptionI18nKey: string;
  languageScope: "all" | "en_US";
  priority: number;
  defaultRollout?: "on" | "off";
  codeSafe?: true;
}

export type ReviewMetadataOut =
  | {
      review: "supported";
      defaultEnabled: boolean;
      category: string;
      kind: string;
      bulk: "eligible" | "individual";
      note?: string;
      languages?: readonly string[];
    }
  | { review: "excluded"; category: string; reason: string };

/** A live check: "<file>:@<rule id>", the code of its typing rule. */
interface LiveRuleOut {
  check: string;
  predicate: string;
}

/** A check's settings example: [before, after]; after null for a warning. */
export interface CheckExampleOut {
  text: readonly [string, string | null];
  lang: string;
}

export interface CompiledRuleSet {
  catalog: CatalogEntryOut[];
  /** Settings copy: i18n key -> UI language -> text. */
  text: Record<string, Record<string, string>>;
  examples: Record<string, CheckExampleOut>;
  exclusive: string[][];
  reviewMetadata: Record<string, ReviewMetadataOut>;
  phraseTableKinds: Record<string, string[]>;
  /** Review rules in evaluation order. */
  rules: CompiledRule[];
  /** Typing checks in priority order. */
  live: LiveRuleOut[];
  frames: CompiledFrame[];
  /** Two-letter language -> phrase table kind -> rows. */
  phrases: Record<string, Partial<Record<(typeof PHRASE_KINDS)[number], PhraseRow[]>>>;
  /** Named tables: "<file>.<name>" -> rows. */
  tables: Record<string, PhraseRow[]>;
  /** The code of each rule file (sets, maps, defs and frame fixes), by file name. */
  code: Record<string, FileCode>;
}

/** The two-letter code of a rule file language ("pt_BR" -> "pt"); undefined for "*". */
const code = (lang: string) => (lang === "*" ? undefined : lang.slice(0, 2));

/**
 * Portuguese phrase rows: "~fazer uso de = ~usar; ~recorrer a" gives one row for each form of
 * ptConjugate, in its slot order ("faço uso de = uso; recorro a", ...); a typed form comes once.
 */
function conjugatedRows(text: string, lang: string, where: string, errors: string[]): string {
  return text
    .split("\n")
    .flatMap((line) => {
      if (!line.startsWith("~")) return [line];
      const at = line.indexOf(" = ");
      const [verb, ...rest] = line.slice(1, at).split(" ");
      const fixes = line.slice(at + 3).split("; ");
      if (lang !== "pt" || at < 0 || line.includes(" | ") || fixes.some((f) => f[0] !== "~")) {
        errors.push(`${where}: row "${line}": "~" needs Portuguese, one typed form and "~" fixes`);
        return [];
      }
      try {
        const forms = ptConjugate(verb);
        const fixForms = fixes.map((fix) => {
          const [fixVerb, ...fixRest] = fix.slice(1).split(" ");
          return ptConjugate(fixVerb).map((form) => [form, ...fixRest].join(" "));
        });
        const seen = new Set<string>();
        return forms.flatMap((form, slot) => {
          const typed = [form, ...rest].join(" ");
          if (seen.has(typed)) return [];
          seen.add(typed);
          return [`${typed} = ${fixForms.map((fix) => fix[slot]).join("; ")}`];
        });
      } catch (error) {
        errors.push(`${where}: row "${line}": ${(error as Error).message}`);
        return [];
      }
    })
    .join("\n");
}

function checkLanguages(
  check: CheckSpec,
  phraseTableKinds: Record<string, string[]>,
): readonly string[] | undefined {
  const { languages } = check;
  if (languages === undefined) return undefined;
  if (languages === "named") return NAMED_LANGUAGES;
  if (Array.isArray(languages)) return languages as readonly string[];
  const kinds = (languages as { phraseTables: readonly string[] }).phraseTables;
  return NAMED_LANGUAGES.filter(
    (lang) =>
      lang === "en_US" || kinds.some((kind) => phraseTableKinds[lang.slice(0, 2)]?.includes(kind)),
  );
}

/**
 * Compiles the rule files, given in RULE_FILES order as [name, parsed YAML]. `library`: the names
 * of the rule library, which expressions may read (unchecked when absent).
 */
export function compileRuleFiles(
  files: readonly (readonly [string, RuleFile])[],
  options: { library?: ReadonlySet<string> } = {},
): CompiledRuleSet {
  const errors: string[] = [];
  const checks = new Map<string, CheckSpec>();
  const catalog: CatalogEntryOut[] = [];
  const text: CompiledRuleSet["text"] = {};
  const examples: CompiledRuleSet["examples"] = {};
  const exclusive: string[][] = [];
  const phrases: CompiledRuleSet["phrases"] = {};
  const tables: CompiledRuleSet["tables"] = {};
  const phraseTableKinds: Record<string, string[]> = {};

  for (const [name, file] of files) {
    for (const key of Object.keys(file))
      if (!FILE_KEYS.has(key as keyof RuleFile))
        errors.push(`${name}.yaml: unknown field "${key}"`);
    for (const spec of file.checks ?? []) {
      const where = `${name}.yaml check ${spec.id}`;
      if (!Array.isArray(spec.modes)) errors.push(`${where}: "modes" lists no mode`);
      const check = { ...spec, modes: spec.modes ?? [] };
      for (const key of Object.keys(check))
        if (!CHECK_KEYS.has(key as keyof CheckSpec))
          errors.push(`${where}: unknown field "${key}"`);
      if (checks.has(check.id)) errors.push(`${where}: duplicate check id`);
      checks.set(check.id, check);
      const live = check.modes.includes("live");
      const title = check.title ?? `grammar_rule_${check.id}`;
      catalog.push({
        id: check.id,
        ...(live ? {} : { typing: false as const }),
        titleI18nKey: title,
        descriptionI18nKey: check.description ?? `${title}_desc`,
        languageScope: check.scope ?? "all",
        ...(live ? { defaultRollout: check.rollout ?? "on" } : {}),
        priority: check.priority,
        ...(check.codeSafe ? { codeSafe: true as const } : {}),
      });
      if (!live && check.rollout) errors.push(`${where}: rollout needs mode "live"`);
      const { example } = check;
      if (typeof example?.before !== "string" || typeof example.lang !== "string")
        errors.push(`${where}: "example" needs lang, before and after`);
      else
        examples[check.id] = { text: [example.before, example.after ?? null], lang: example.lang };
      if (check.text) {
        const entry = catalog.at(-1)!;
        for (const [key, copy] of [
          [entry.titleI18nKey, check.text.title],
          [entry.descriptionI18nKey, check.text.description],
        ] as const) {
          const missing = UI_LANGUAGES.filter((lang) => !copy?.[lang]?.trim());
          if (missing.length) errors.push(`${where}: ${key} has no text in ${missing.join(", ")}`);
          text[key] = { ...copy };
        }
      } else if (!live) errors.push(`${where}: a Review-only check needs "text"`);
      if (check.modes.includes("review") === (check.excluded !== undefined))
        errors.push(`${where}: a check without mode "review" needs "excluded", and only it`);
    }
    for (const group of file.exclusive ?? []) exclusive.push([...group]);
    const lang = code(file.lang);
    if (file.phrases) {
      if (!lang) errors.push(`${name}.yaml: phrases need a language file`);
      else {
        phrases[lang] = {};
        for (const kind of Object.keys(file.phrases)) {
          if (!(PHRASE_KINDS as readonly string[]).includes(kind)) {
            errors.push(`${name}.yaml: unknown phrase table "${kind}"`);
            continue;
          }
          const k = kind as (typeof PHRASE_KINDS)[number];
          const where = `${name}.yaml phrases.${k}`;
          const rows = conjugatedRows(file.phrases[k]!, lang, where, errors);
          phrases[lang][k] = parseRows(rows, where, errors);
        }
        phraseTableKinds[lang] = PHRASE_KINDS.filter((kind) => phrases[lang][kind]);
      }
    }
    // review/english/tables.ts pools the "<module>.<kind>" tables of a kind: a typed form that
    // a pool has two times is a dead row.
    const typedIn = new Map<string, string>();
    for (const [table, rows] of Object.entries(file.tables ?? {})) {
      const where = `${name}.yaml tables.${table}`;
      const pool = table.replace(/^[^.]+(?=\.(?:phrases|compounds|style)$)/, "*");
      for (const [typed, fix] of (tables[`${name}.${table}`] = parseRows(rows, where, errors)))
        for (const form of [typed].flat()) {
          const key = `${pool} ${form.toLowerCase()}`;
          if ([fix].flat().includes(form)) errors.push(`${where}: row "${form}" fixes to itself`);
          if (typedIn.has(key))
            errors.push(`${where}: "${form}" is also a row of ${typedIn.get(key)}`);
          else typedIn.set(key, where);
        }
    }
  }

  const reviewMetadata: Record<string, ReviewMetadataOut> = {};
  for (const check of checks.values()) {
    if (check.excluded !== undefined) {
      reviewMetadata[check.id] = {
        review: "excluded",
        category: check.category,
        reason: check.excluded,
      };
      continue;
    }
    if (check.kind === undefined) errors.push(`check ${check.id}: a Review check needs "kind"`);
    const languages = checkLanguages(check, phraseTableKinds);
    reviewMetadata[check.id] = {
      review: "supported",
      defaultEnabled: check.enabled ?? true,
      category: check.category,
      kind: check.kind ?? "usage",
      bulk: check.safeToFix ? "eligible" : "individual",
      ...(check.note === undefined ? {} : { note: check.note }),
      ...(languages === undefined ? {} : { languages }),
    };
  }
  for (const group of exclusive)
    for (const id of group) if (!checks.has(id)) errors.push(`exclusive: unknown check "${id}"`);

  // Rules, in stage order, then file order.
  const ordered: { name: string; file: RuleFile; spec: RuleSpec; order: number }[] = [];
  for (const [name, file] of files)
    for (const spec of file.rules ?? []) ordered.push({ name, file, spec, order: ordered.length });
  ordered.sort((a, b) => (a.spec.stage ?? 0) - (b.spec.stage ?? 0) || a.order - b.order);

  // A language file reads the fragments of common.yaml too; its own fragments win.
  const shared = files.find(([name]) => name === "common")?.[1].fragments ?? {};
  const fragmentsOf = (file: RuleFile) => ({ ...shared, ...file.fragments });

  // The code of each file; common.yaml's names are shared with every other file.
  const common = files.find(([name]) => name === "common")?.[1];
  const scope: CodeScope = {
    ...(options.library ? { library: options.library } : {}),
    // common.yaml's names, of the file and of its rules, are shared with every other file.
    shared: new Set(
      [common, ...(common?.rules ?? [])].flatMap((section) =>
        [section?.sets, section?.maps, section?.defs].flatMap((names) => Object.keys(names ?? {})),
      ),
    ),
  };
  const fileCodes: Record<string, FileCode> = {};
  const namesOf = new Map<string, Names>();
  for (const [name, file] of files) {
    const expand = (source: string, at: string) =>
      expandFrame(source, fragmentsOf(file), at, errors);
    const sections = [
      [`${name}.yaml`, file] as const,
      ...(file.rules ?? []).map((rule) => [`${name}.yaml rule ${rule.id}`, rule] as const),
    ];
    const read = fileCode(name, sections, scope, expand, errors);
    fileCodes[name] = read.code;
    namesOf.set(name, read.names);
  }

  const ruleIds = new Set<string>();
  const frameNames = new Set<string>();
  const rules: CompiledRule[] = [];
  const frames: CompiledFrame[] = [];
  const livePredicates = new Map<string, string>();

  for (const { name, file, spec } of ordered) {
    const where = `${name}.yaml rule ${spec.id}`;
    for (const key of Object.keys(spec))
      if (!RULE_KEYS.has(key as keyof RuleSpec)) errors.push(`${where}: unknown field "${key}"`);
    if (ruleIds.has(spec.id)) errors.push(`${where}: duplicate rule id`);
    ruleIds.add(spec.id);
    if (!spec.checks?.length) {
      errors.push(`${where}: "checks" names no check`);
      continue;
    }
    for (const id of spec.checks ?? [])
      if (!checks.has(id)) errors.push(`${where}: unknown check "${id}"`);
    const modes = spec.modes ?? ["review"];
    const lang = code(spec.lang ?? file.lang);
    const expand = (source: string, at: string) =>
      expandFrame(source, fragmentsOf(file), at, errors);
    const addCode = (fn: FunctionCode | undefined) => {
      if (fn) (fileCodes[name].functions as FunctionCode[]).push(fn);
    };
    // A rule's own code (`let`, `when`, `return`) is its predicate: the detector of a Review rule
    // (after the frames of a frame rule) or the `apply` of a typing rule.
    let predicate: string | undefined;
    if (spec.return !== undefined || spec.let !== undefined || spec.when !== undefined) {
      const live = modes.includes("live");
      if (live && !spec.triggers?.length)
        errors.push(`${where}: a typing rule with code needs "triggers"`);
      addCode(
        functionCode(
          `@${spec.id}`,
          live ? "live" : "detector",
          where,
          spec,
          namesOf.get(name)!,
          expand,
          errors,
          undefined,
          live ? spec.triggers : undefined,
        ),
      );
      predicate = `${name}:@${spec.id}`;
    } else if (spec.triggers !== undefined) errors.push(`${where}: "triggers" needs "return"`);
    // A filter as code: `filter:` with `let`, `when` and `return` over `findings`.
    let filter = typeof spec.filter === "string" ? spec.filter : undefined;
    if (spec.filter !== undefined && typeof spec.filter !== "string") {
      addCode(
        functionCode(
          `@${spec.id}/filter`,
          "filter",
          `${where} filter`,
          spec.filter,
          namesOf.get(name)!,
          expand,
          errors,
        ),
      );
      filter = `${name}:@${spec.id}/filter`;
    }
    // A frame rule may also have code: it runs after the frames.
    if ([spec.frames ?? predicate, spec.findings].filter((k) => k !== undefined).length !== 1)
      errors.push(`${where}: give exactly one of "frames", "findings" and a "return" expression`);

    if (spec.findings !== undefined) {
      if (!["style", "terminology", "quotation"].includes(spec.findings))
        errors.push(`${where}: unknown findings "${spec.findings}"`);
      rules.push({
        id: spec.id,
        checks: [...spec.checks],
        ...(lang ? { lang } : {}),
        findings: spec.findings,
        ...(spec.group === undefined ? {} : { group: spec.group }),
        source: name,
      });
      continue;
    }
    if (predicate !== undefined && spec.frames === undefined) {
      if (modes.includes("live")) {
        if (modes.length > 1) errors.push(`${where}: a live predicate rule has only mode "live"`);
        if (livePredicates.has(spec.checks[0]))
          errors.push(`${where}: check ${spec.checks[0]} already has a live predicate`);
        livePredicates.set(spec.checks[0], predicate);
        continue;
      }
      rules.push({
        id: spec.id,
        checks: [...spec.checks],
        ...(lang ? { lang } : {}),
        predicate,
        ...(spec.cacheable ? { cacheable: true as const } : {}),
        ...(spec.group === undefined ? {} : { group: spec.group }),
        source: name,
      });
      continue;
    }
    if (spec.frames !== undefined) {
      if (spec.message === undefined) errors.push(`${where}: a frame rule needs "message"`);
      const indexes = spec.frames.map((entry, j) => {
        const at = `${where} frame ${j + 1}`;
        for (const key of Object.keys(entry))
          if (!FRAME_KEYS.has(key)) errors.push(`${at}: unknown frame field "${key}"`);
        if ((entry.fix === undefined) === (entry.return === undefined))
          errors.push(`${at}: give exactly one of "fix" and a "return" expression`);
        if (entry.return === undefined && (entry.let !== undefined || entry.when !== undefined))
          errors.push(`${at}: "let" and "when" need "return"`);
        const match = spec.style === "match";
        const scan = entry.scan ?? "frame";
        if (spec.style === "template" && (typeof entry.fix !== "string" || entry.raw))
          errors.push(`${at}: a template has one "fix" string and no "raw"`);
        if (spec.style !== "template" && spec.style !== "portuguese" && entry.clauseStart)
          errors.push(`${at}: "clauseStart" needs style "template" or "portuguese"`);
        if (spec.style !== "german" && entry.ownCase)
          errors.push(`${at}: "ownCase" needs style "german"`);
        if (spec.style !== "portuguese" && entry.capitalized)
          errors.push(`${at}: "capitalized" needs style "portuguese"`);
        if (spec.style === "portuguese" && entry.fix !== undefined && !Array.isArray(entry.fix))
          errors.push(`${at}: a portuguese frame gives its fixes as a list`);
        if (spec.style !== "slot" && entry.cue !== undefined)
          errors.push(`${at}: "cue" needs style "slot"`);
        if (
          !["slot", "polish", "carry", "cased", "comma", "match"].includes(spec.style ?? "") &&
          entry.check !== undefined
        )
          errors.push(`${at}: "check" needs a style with a check per frame`);
        if (match && entry.raw) errors.push(`${at}: "raw" does not apply to style "match"`);
        if (!["comma", "swap", "match"].includes(spec.style ?? "") && entry.flags !== undefined)
          errors.push(`${at}: "flags" needs style "comma", "swap" or "match"`);
        for (const key of ["scan", "lookback", "lookahead", "anyCheck", "owner"] as const)
          if (!match && entry[key] !== undefined)
            errors.push(`${at}: "${key}" needs style "match"`);
        if (!SCANS.has(scan)) errors.push(`${at}: unknown scan "${scan}"`);
        if (match && scan !== "frame" && (entry.flags === undefined || !entry.flags.includes("g")))
          errors.push(`${at}: a "${scan}" scan needs "flags" with "g"`);
        if (
          match &&
          scan === "frame" &&
          entry.flags !== undefined &&
          !/^(?=.*g)(?=.*d)/.test(entry.flags)
        )
          errors.push(`${at}: a frame scan needs "flags" with "g" and "d"`);
        if (scan !== "frame" && (entry.owner !== undefined || entry.wordStart !== undefined))
          errors.push(`${at}: "owner" and "wordStart" need the frame scan`);
        for (const key of ["lookback", "lookahead"] as const) {
          const count = entry[key];
          if (count === undefined) continue;
          if (scan !== "owned" && scan !== "text")
            errors.push(`${at}: "${key}" needs scan "owned" or "text"`);
          if (!Number.isInteger(count) || count < 0)
            errors.push(`${at}: "${key}" is a count of characters`);
        }
        if (spec.style === "cased" && entry.fix !== undefined && typeof entry.fix !== "string")
          errors.push(`${at}: a cased frame has one "fix" string`);
        if (spec.style !== "polish" && entry.lowercase)
          errors.push(`${at}: "lowercase" needs style "polish"`);
        if (spec.style !== "polish" && spec.style !== "carry" && entry.verbatim)
          errors.push(`${at}: "verbatim" needs style "polish" or "carry"`);
        if (spec.style !== "carry" && entry.targetOnly)
          errors.push(`${at}: "targetOnly" needs style "carry"`);
        if (entry.check !== undefined && !spec.checks.includes(entry.check))
          errors.push(`${at}: check "${entry.check}" is not a check of the rule`);
        for (const word of entry.cue || [])
          if (!/^\p{Ll}+$/u.test(word)) errors.push(`${at}: cue "${word}" is not a lowercase word`);
        if (entry.gateFlags !== undefined && entry.gate === undefined)
          errors.push(`${at}: "gateFlags" needs "gate"`);
        if (entry.gate !== undefined)
          try {
            if (!new RegExp(entry.gate, entry.gateFlags ?? "gi").global)
              errors.push(`${at}: "gateFlags" needs "g"`);
          } catch (error) {
            errors.push(`${at}: gate does not compile: ${String(error)}`);
          }
        const pattern = expandFrame(entry.regex, fragmentsOf(file), at, errors);
        try {
          if (spec.style === "german") new RegExp(pattern, "gdu");
          else if (spec.style === "cased") new RegExp(`${WORD_START}${pattern}`, "gdu");
          else if (spec.style === "comma") new RegExp(pattern, entry.flags ?? "dgu");
          else if (spec.style === "swap") new RegExp(pattern, entry.flags ?? "gu");
          else if (match && (scan !== "frame" || entry.flags !== undefined))
            new RegExp(pattern, entry.flags ?? "gidu");
          else if (entry.wordStart === false) new RegExp(pattern, "gidu");
          else frame(pattern);
        } catch (error) {
          errors.push(`${at}: regex does not compile: ${String(error)}`);
        }
        if (
          spec.style !== "german" &&
          spec.style !== "swap" &&
          (!match ||
            entry.fix !== undefined ||
            (scan === "frame" && (entry.owner ?? "target") === "target")) &&
          !pattern.includes("(?<target>")
        )
          errors.push(`${at}: a frame needs a "target" group`);
        // A `return` expression becomes a fixer of the file's generated module.
        // The name of the frame's code: its `name`, or "@<rule id>/<frame number>".
        if (entry.name !== undefined) {
          if (!/^[A-Za-z_$][\w$]*$/.test(entry.name) || entry.return === undefined)
            errors.push(`${at}: "name" is a name, for a frame with "return"`);
          if (frameNames.has(`${name}:${entry.name}`))
            errors.push(`${at}: frame name "${entry.name}" is used twice in ${name}.yaml`);
          frameNames.add(`${name}:${entry.name}`);
        }
        const key = entry.name ?? `@${spec.id}/${j + 1}`;
        const fixCode =
          entry.return === undefined
            ? undefined
            : functionCode(key, "fixer", at, entry, namesOf.get(name)!, expand, errors, {
                style: spec.style ?? "frame",
                pattern,
              });
        addCode(fixCode);
        const literals = requiredLiterals(pattern);
        // A slot frame without "cue" runs only near one of its literals, when each is a word.
        const cue =
          entry.cue ??
          (spec.style === "slot" &&
            literals.length > 0 &&
            literals.every((word) => /^\p{Ll}+$/u.test(word)) &&
            literals);
        frames.push({
          pattern,
          literals,
          // The start positions of a frame scan (comma and swap frames run a Polish scan).
          ...(scan === "frame" && spec.style !== "comma" && spec.style !== "swap"
            ? scanStarts(spec.style === "cased" ? `${WORD_START}${pattern}` : pattern)
            : {}),
          ...(entry.fix === undefined ? {} : { fix: entry.fix }),
          ...(fixCode ? { fixer: `${name}:${key}` } : {}),
          ...(entry.raw ? { raw: true as const } : {}),
          ...(entry.message === undefined ? {} : { message: entry.message }),
          ...(entry.clauseStart ? { clauseStart: true as const } : {}),
          ...(entry.check === undefined ? {} : { check: entry.check }),
          ...(cue ? { cue: [...cue] } : {}),
          ...(entry.wordStart === false ? { wordStart: false as const } : {}),
          ...(entry.verbatim ? { verbatim: true as const } : {}),
          ...(entry.lowercase ? { lowercase: true as const } : {}),
          ...(entry.capitalized ? { capitalized: true as const } : {}),
          ...(entry.ownCase ? { ownCase: true as const } : {}),
          ...(entry.targetOnly ? { targetOnly: true as const } : {}),
          ...(entry.flags === undefined ? {} : { flags: entry.flags }),
          ...(entry.scan === undefined || entry.scan === "frame" ? {} : { scan: entry.scan }),
          ...(entry.lookback === undefined ? {} : { lookback: entry.lookback }),
          ...(entry.lookahead === undefined ? {} : { lookahead: entry.lookahead }),
          ...(entry.anyCheck ? { anyCheck: true as const } : {}),
          ...(entry.owner === undefined ? {} : { owner: entry.owner }),
          ...(entry.gate === undefined ? {} : { gate: entry.gate }),
          ...(entry.lang === undefined ? {} : { lang: code(entry.lang) }),
          ...(entry.gateFlags === undefined ? {} : { gateFlags: entry.gateFlags }),
        });
        return frames.length - 1;
      });
      rules.push({
        id: spec.id,
        checks: [...spec.checks],
        ...(lang ? { lang } : {}),
        frames: indexes,
        ...(predicate === undefined ? {} : { predicate }),
        message: spec.message!,
        ...(spec.style && spec.style !== "frame" ? { style: spec.style } : {}),
        ...(filter === undefined
          ? {}
          : { filter: filter.includes(":") ? filter : `${name}:${filter}` }),
        ...(spec.cacheable ? { cacheable: true as const } : {}),
        ...(spec.group === undefined ? {} : { group: spec.group }),
        source: name,
      });
      continue;
    }
  }

  // Typing checks in priority order (stable: catalog order on ties).
  const live: LiveRuleOut[] = catalog
    .filter((entry) => entry.typing !== false)
    .sort((a, b) => a.priority - b.priority)
    .flatMap((entry) => {
      const predicate = livePredicates.get(entry.id);
      if (predicate) return [{ check: entry.id, predicate }];
      errors.push(`live check ${entry.id} has no live rule`);
      return [];
    });
  for (const [id] of livePredicates)
    if (!checks.get(id)?.modes.includes("live"))
      errors.push(`check ${id}: a live predicate needs mode "live"`);

  if (errors.length) throw new Error(`Invalid grammar rules:\n${errors.join("\n")}`);
  return {
    catalog,
    text,
    examples,
    exclusive,
    reviewMetadata,
    phraseTableKinds,
    rules,
    live,
    frames,
    phrases,
    tables,
    code: fileCodes,
  };
}
