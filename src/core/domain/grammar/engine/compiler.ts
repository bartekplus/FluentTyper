import { SUPPORTED_PREDICTION_LANGUAGE_KEYS, TEXT_EXPANDER_LANG } from "../../lang";
import { isTokenPredicate } from "./predicates";
import { scanStarts } from "./prefixes";
import { parseRows, type PhraseRow } from "./rows";
import { tokenKey } from "./tokenizer";
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
import type {
  CheckSpec,
  CompiledFrame,
  CompiledMatcher,
  CompiledPattern,
  CompiledRule,
  RuleFile,
  RuleSpec,
  TokenMatcherSpec,
} from "./types";

/*
 * Validates the declarative rule files and compiles them. Pure: scripts/compile-grammar-rules.ts
 * runs it at build time and writes the result to the *.generated.ts modules; tests run it to
 * prove the generated modules are current. Every problem is collected and thrown at once.
 */

export { parseRows };
export type { PhraseRow };

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
const TOKEN_TYPES = new Set(["word", "number", "punct", "symbol", "protected"]);
const CASINGS = new Set(["lower", "upper", "title", "mixed", "none"]);
const MATCHER_KEYS = new Set<keyof TokenMatcherSpec>([
  "lower",
  "surface",
  "type",
  "regex",
  "negateRegex",
  "casing",
  "spaceBefore",
  "spaceAfter",
  "exactWhitespaceBefore",
  "matchRef",
  "isSentenceStart",
  "isSentenceEnd",
  "prevTokenNotLower",
  "nextTokenNotLower",
  "predicate",
]);
const RULE_KEYS = new Set<keyof RuleSpec>([
  "id",
  "checks",
  "lang",
  "includeLangs",
  "excludeLangs",
  "modes",
  "stage",
  "predicate",
  "cacheable",
  "pattern",
  "replacements",
  "target",
  "preserveCase",
  "message",
  "crossLines",
  "bulkBlock",
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
  "fixer",
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
const UI_LANGUAGES = ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"];

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

/** A live check: its named implementation, or the live patterns of its rules. */
interface LiveRuleOut {
  check: string;
  predicate?: string;
  patterns: number[];
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
  reviewPatterns: PatternSetOut;
  livePatterns: PatternSetOut;
  frames: CompiledFrame[];
  /** Two-letter language -> phrase table kind -> rows. */
  phrases: Record<string, Partial<Record<(typeof PHRASE_KINDS)[number], PhraseRow[]>>>;
  /** Named tables: "<file>.<name>" -> rows. */
  tables: Record<string, PhraseRow[]>;
  /** The code of each rule file (sets, maps, defs and frame fixes), by file name. */
  code: Record<string, FileCode>;
}

interface PatternSetOut {
  patterns: CompiledPattern[];
  anchors: Record<string, number[]>;
  structural: number[];
}

/** The two-letter code of a rule file language ("pt_BR" -> "pt"); undefined for "*". */
const code = (lang: string) => (lang === "*" ? undefined : lang.slice(0, 2));
const list = <T>(value: T | readonly T[] | undefined): T[] | undefined =>
  value === undefined ? undefined : ([] as T[]).concat(value as T);

function compileMatcher(
  spec: TokenMatcherSpec,
  j: number,
  where: string,
  errors: string[],
): CompiledMatcher {
  for (const key of Object.keys(spec))
    if (!MATCHER_KEYS.has(key as keyof TokenMatcherSpec))
      errors.push(`${where}: unknown pattern field "${key}"`);
  const out: CompiledMatcher = {};
  const lower = list(spec.lower);
  if (lower) out.lower = lower.map((literal) => tokenKey(String(literal)));
  const surface = list(spec.surface);
  if (surface) out.surface = surface.map(String);
  const type = list(spec.type);
  if (type) {
    for (const t of type) if (!TOKEN_TYPES.has(t)) errors.push(`${where}: unknown type "${t}"`);
    out.type = type;
  }
  const casing = list(spec.casing);
  if (casing) {
    for (const c of casing) if (!CASINGS.has(c)) errors.push(`${where}: unknown casing "${c}"`);
    out.casing = casing;
  }
  for (const key of ["regex", "negateRegex"] as const) {
    const source = spec[key];
    if (source === undefined) continue;
    try {
      new RegExp(source, "u");
      out[key] = source;
    } catch (error) {
      errors.push(`${where}: ${key} does not compile: ${String(error)}`);
    }
  }
  for (const key of ["spaceBefore", "spaceAfter", "isSentenceStart", "isSentenceEnd"] as const) {
    const value = spec[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") errors.push(`${where}: ${key} must be true or false`);
    out[key] = value;
  }
  if (spec.exactWhitespaceBefore !== undefined)
    out.exactWhitespaceBefore = spec.exactWhitespaceBefore;
  if (spec.matchRef !== undefined) {
    if (!Number.isInteger(spec.matchRef) || spec.matchRef < 1 || spec.matchRef >= j)
      errors.push(`${where}: matchRef must name an earlier element (1-${j - 1})`);
    out.matchRef = spec.matchRef;
  }
  if (spec.prevTokenNotLower) out.prevTokenNotLower = spec.prevTokenNotLower.map(tokenKey);
  if (spec.nextTokenNotLower) out.nextTokenNotLower = spec.nextTokenNotLower.map(tokenKey);
  if (spec.predicate !== undefined) {
    if (!isTokenPredicate(spec.predicate))
      errors.push(`${where}: unknown token predicate "${spec.predicate}"`);
    out.predicate = spec.predicate;
  }
  return out;
}

/** The element whose literals select the rule best (its shortest literal is longest), or -1. */
function chooseAnchor(elements: readonly CompiledMatcher[]): number {
  let anchor = -1;
  let best = 0;
  elements.forEach((element, j) => {
    const literals = element.lower ?? element.surface?.map(tokenKey);
    if (!literals?.length) return;
    const shortest = Math.min(...literals.map((literal) => literal.length));
    if (shortest > best) [anchor, best] = [j, shortest];
  });
  return anchor;
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
    for (const check of file.checks ?? []) {
      const where = `${name}.yaml check ${check.id}`;
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
          phrases[lang][k] = parseRows(file.phrases[k]!, `${name}.yaml phrases.${k}`, errors);
        }
        phraseTableKinds[lang] = PHRASE_KINDS.filter((kind) => phrases[lang][kind]);
      }
    }
    for (const [table, rows] of Object.entries(file.tables ?? {}))
      tables[`${name}.${table}`] = parseRows(rows, `${name}.yaml tables.${table}`, errors);
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
  const reviewPatterns: PatternSetOut = { patterns: [], anchors: {}, structural: [] };
  const livePatterns: PatternSetOut = { patterns: [], anchors: {}, structural: [] };
  const frames: CompiledFrame[] = [];
  const livePredicates = new Map<string, string>();
  const liveByCheck = new Map<string, number[]>();

  for (const { name, file, spec } of ordered) {
    const where = `${name}.yaml rule ${spec.id}`;
    for (const key of Object.keys(spec))
      if (!RULE_KEYS.has(key as keyof RuleSpec)) errors.push(`${where}: unknown field "${key}"`);
    if (ruleIds.has(spec.id)) errors.push(`${where}: duplicate rule id`);
    ruleIds.add(spec.id);
    if (!spec.checks?.length) errors.push(`${where}: "checks" names no check`);
    for (const id of spec.checks ?? [])
      if (!checks.has(id)) errors.push(`${where}: unknown check "${id}"`);
    const check = checks.get(spec.checks?.[0]);
    const modes = spec.modes ?? ["review"];
    const lang = code(spec.lang ?? file.lang);
    const expand = (source: string, at: string) =>
      expandFrame(source, fragmentsOf(file), at, errors);
    const addCode = (fn: FunctionCode | undefined) => {
      if (fn) (fileCodes[name].functions as FunctionCode[]).push(fn);
    };
    // A rule's own code (`let`, `when`, `return`) is its predicate: the detector of a Review rule
    // (after the frames of a frame rule) or the `apply` of a typing rule.
    let predicate = spec.predicate;
    if (spec.return !== undefined || spec.let !== undefined || spec.when !== undefined) {
      if (spec.predicate !== undefined)
        errors.push(`${where}: give "predicate" or a "return" expression, not both`);
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
    // A frame rule may also name a predicate: it runs after the frames.
    if (
      [spec.pattern, spec.frames ?? predicate, spec.findings].filter((k) => k !== undefined)
        .length !== 1 ||
      (spec.pattern !== undefined && predicate !== undefined)
    )
      errors.push(`${where}: give exactly one of "predicate", "pattern", "frames" and "findings"`);

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
        predicate: predicate.includes(":") ? predicate : `${name}:${predicate}`,
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
        if ([entry.fix, entry.fixer, entry.return].filter((v) => v !== undefined).length !== 1)
          errors.push(`${at}: give exactly one of "fix" and "fixer", or a "return" expression`);
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
        for (const word of entry.cue ?? [])
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
        const fixer = fixCode ? key : entry.fixer;
        frames.push({
          pattern,
          literals: requiredLiterals(pattern),
          // The start positions of a frame scan (comma and swap frames run a Polish scan).
          ...(scan === "frame" && spec.style !== "comma" && spec.style !== "swap"
            ? scanStarts(spec.style === "cased" ? `${WORD_START}${pattern}` : pattern)
            : {}),
          ...(entry.fix === undefined ? {} : { fix: entry.fix }),
          ...(fixer === undefined
            ? {}
            : { fixer: fixer.includes(":") ? fixer : `${name}:${fixer}` }),
          ...(entry.raw ? { raw: true as const } : {}),
          ...(entry.message === undefined ? {} : { message: entry.message }),
          ...(entry.clauseStart ? { clauseStart: true as const } : {}),
          ...(entry.check === undefined ? {} : { check: entry.check }),
          ...(entry.cue === undefined ? {} : { cue: [...entry.cue] }),
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
        ...(predicate === undefined
          ? {}
          : { predicate: predicate.includes(":") ? predicate : `${name}:${predicate}` }),
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
    if (spec.pattern === undefined) continue;

    const elements = spec.pattern.map((element, j) =>
      compileMatcher(element, j + 1, `${where} element ${j + 1}`, errors),
    );
    const target = spec.target ?? ([1, elements.length] as const);
    if (target[0] < 1 || target[1] > elements.length || target[0] > target[1])
      errors.push(`${where}: target [${target.join(", ")}] is outside the pattern`);
    if (!spec.replacements?.length) errors.push(`${where}: a pattern needs "replacements"`);
    if (modes.includes("review") && spec.message === undefined)
      errors.push(`${where}: a Review pattern needs "message"`);
    if (modes.includes("live") && !check?.safeToFix)
      errors.push(`${where}: a live pattern needs a check with safeToFix`);
    if (modes.includes("live") && !check?.modes.includes("live"))
      errors.push(`${where}: a live pattern needs a check with mode "live"`);
    const anchor = chooseAnchor(elements);
    const base = {
      rule: spec.id,
      check: spec.checks[0],
      langs: lang ? [lang] : (spec.includeLangs ?? []).map((l) => l.slice(0, 2)),
      excludeLangs: (spec.excludeLangs ?? []).map((l) => l.slice(0, 2)),
      live: modes.includes("live"),
      review: modes.includes("review"),
      safeToFix: check?.safeToFix ?? false,
      elements,
      anchor,
      replacements: [...(spec.replacements ?? [])],
      target: [target[0], target[1]] as const,
      preserveCase: spec.preserveCase ?? true,
      message: spec.message ?? "",
      crossLines: spec.crossLines ?? false,
      ...(spec.bulkBlock ? { bulkBlock: spec.bulkBlock } : {}),
    };
    for (const [set, wanted] of [
      [reviewPatterns, base.review],
      [livePatterns, base.live],
    ] as const) {
      if (!wanted) continue;
      const index = set.patterns.length;
      set.patterns.push({ index, ...base });
      if (anchor < 0) set.structural.push(index);
      else
        for (const literal of new Set(
          elements[anchor].lower ?? elements[anchor].surface!.map(tokenKey),
        ))
          (set.anchors[literal] ??= []).push(index);
      if (set === livePatterns) {
        const forCheck = liveByCheck.get(base.check) ?? [];
        forCheck.push(index);
        liveByCheck.set(base.check, forCheck);
      }
      if (set === reviewPatterns)
        rules.push({
          id: spec.id,
          checks: [...spec.checks],
          ...(lang ? { lang } : {}),
          pattern: index,
          source: name,
        });
    }
  }

  // Typing checks in priority order (stable: catalog order on ties).
  const live: LiveRuleOut[] = catalog
    .filter((entry) => entry.typing !== false)
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => ({
      check: entry.id,
      ...(livePredicates.has(entry.id) ? { predicate: livePredicates.get(entry.id) } : {}),
      patterns: liveByCheck.get(entry.id) ?? [],
    }));
  for (const rule of live)
    if (!rule.predicate && rule.patterns.length === 0)
      errors.push(`live check ${rule.check} has no live rule`);
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
    reviewPatterns,
    livePatterns,
    frames,
    phrases,
    tables,
    code: fileCodes,
  };
}
