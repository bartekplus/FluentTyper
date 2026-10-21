// The code of a rule file: its `sets`, `maps` and `defs` (of the file or of a rule), and the
// `let`, `when` and `return` of its frames and rules. The compiler checks each expression and the
// names it reads; the generator writes the code of each file into a typed module
// (engine/rules/<file>.generated.ts).
import { checkExpression, defSignature, EXPRESSION_GLOBALS } from "./expressions";
import type { FrameStyle } from "./types";

/** One step of a body: a binding, or a condition that ends the body when it fails. */
export type CodeStep =
  | { readonly kind: "let"; readonly name: string; readonly source: string }
  | { readonly kind: "when"; readonly source: string };

/**
 * What a function of a rule file is: the fix of a frame, the filter of a rule's findings, the
 * detector of a Review rule, or a typing rule's `apply`.
 */
export type CodeKind = "fixer" | "filter" | "detector" | "live";

/** A function of a rule file, from a frame's or a rule's `let`, `when` and `return`. */
export interface FunctionCode {
  /** The name the compiled rule or frame gives it ("@<rule id>" or "@<rule id>/<frame>"). */
  readonly key: string;
  readonly kind: CodeKind;
  /** Fixers: the frame style, which sets the parameters and the result type. */
  readonly style?: FrameStyle;
  readonly where: string;
  /** The parameters the body reads, in call order. */
  readonly params: readonly string[];
  /** Fixers: the match groups the body reads. */
  readonly groups: readonly string[];
  readonly steps: readonly CodeStep[];
  readonly result: string;
  /** What the function gives when a `when` fails. */
  readonly otherwise: string;
  /** Live rules: the events the rule runs on. */
  readonly triggers?: readonly string[];
}

/** A def: a constant (no `args`) or a function. */
export interface DefCode {
  readonly name: string;
  readonly where: string;
  readonly args?: string;
  readonly type?: string;
  readonly steps: readonly CodeStep[];
  readonly result: string;
  readonly otherwise: string;
}

/** The code of one rule file. */
export interface FileCode {
  readonly sets: Readonly<Record<string, readonly string[]>>;
  readonly maps: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly defs: readonly DefCode[];
  readonly functions: readonly FunctionCode[];
  /** The names the file defines (sets, maps, defs). */
  readonly names: ReadonlySet<string>;
}

/** A def as YAML: an expression, or a function. */
export type DefSpec =
  | string
  | {
      readonly args?: string;
      readonly type?: string;
      readonly let?: Readonly<Record<string, string>>;
      readonly when?: string | readonly string[];
      readonly return: string;
      readonly else?: string;
    };

/** A body as YAML: bindings, conditions and what it returns. */
export interface BodySpec {
  readonly let?: Readonly<Record<string, string>>;
  readonly when?: string | readonly string[];
  readonly return?: string;
}

/** The helpers a rule file, or one of its rules, defines for its expressions. */
export interface CodeSections {
  readonly sets?: Readonly<Record<string, readonly string[]>>;
  readonly maps?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly defs?: Readonly<Record<string, DefSpec>>;
}

/** The parameters of each kind of function, in call order, with their types. */
export const PARAMS: Readonly<Record<CodeKind, readonly (readonly [string, string])[]>> = {
  fixer: [
    ["m", "RegExpExecArray"],
    ["ctx", "DetectContext"],
    ["frame", "FrameRef"],
  ],
  filter: [
    ["ctx", "DetectContext"],
    ["findings", "RawFinding[]"],
  ],
  detector: [["ctx", "DetectContext"]],
  live: [
    ["context", "GrammarContext"],
    ["options", "LiveRuleOptions"],
  ],
};
/** Portuguese frames pass their fixer the typed target. */
export const PORTUGUESE_PARAMS: readonly (readonly [string, string])[] = [["target", "string"]];

/** What a frame of each style gives when one of its `when` conditions fails. */
const NO_FIX: Readonly<Partial<Record<FrameStyle, string>>> = {
  frame: "null",
  slot: "null",
  carry: "null",
  german: "null",
  portuguese: "[]",
  polish: "null",
  comma: "null",
  swap: "null",
  match: "null",
};
const OTHERWISE: Readonly<Record<Exclude<CodeKind, "fixer">, string>> = {
  filter: "findings",
  detector: "[]",
  live: "null",
};

const NAME = /^[A-Za-z_$][\w$]*$/;
const DEF_KEYS = new Set(["args", "type", "let", "when", "return", "else"]);

/** Names an expression of a file may read besides its own: the library and the shared file. */
export interface CodeScope {
  /** The rule library's exports; undefined: names are not checked here (the type checker does). */
  readonly library?: ReadonlySet<string>;
  /** The names of common.yaml, which every other file reads. */
  readonly shared: ReadonlySet<string>;
}

type Expand = (source: string, where: string) => string;

/** The names of a file: `known` may be read; `taken` are defined (a binding may not reuse one). */
export interface Names {
  readonly known: (name: string) => boolean;
  readonly taken: (name: string) => boolean;
}

/**
 * Checks a body (lets, whens and its result) and orders the whens: each runs right after the
 * last binding it reads, so a cheap condition ends the body before a costly binding, and never
 * before the condition written above it.
 */
function body(
  where: string,
  spec: BodySpec,
  result: string,
  bound: ReadonlySet<string>,
  { known, taken }: Names,
  expand: Expand,
  errors: string[],
): { steps: CodeStep[]; result: string; reads: Set<string> } {
  const reads = new Set<string>();
  const scope = new Set(bound);
  const check = (source: string, at: string) => {
    const text = expand(source, at);
    const checked = checkExpression(text);
    for (const error of checked.errors) errors.push(`${at}: ${error}`);
    for (const name of checked.refs) {
      reads.add(name);
      if (!scope.has(name) && !known(name)) errors.push(`${at}: unknown name "${name}"`);
    }
    return { text, refs: checked.refs };
  };
  const lets: { name: string; source: string }[] = [];
  for (const [name, source] of Object.entries(spec.let ?? {})) {
    const at = `${where} let ${name}`;
    if (!NAME.test(name)) errors.push(`${at}: not a name`);
    else if (scope.has(name) || taken(name)) errors.push(`${at}: "${name}" is taken`);
    if (typeof source !== "string") {
      errors.push(`${at}: give an expression`);
      continue;
    }
    lets.push({ name, source: check(source, at).text });
    scope.add(name);
  }
  let previous = -1;
  const whens = ([] as unknown[]).concat(spec.when ?? []).map((source, i) => {
    const at = `${where} when ${i + 1}`;
    if (typeof source !== "string") {
      errors.push(`${at}: give an expression`);
      return { source: "true", after: -1 };
    }
    const { text, refs } = check(source, at);
    // The last binding the condition reads, or the place of the condition above it.
    let after = previous;
    lets.forEach((binding, j) => {
      if (refs.has(binding.name)) after = Math.max(after, j);
    });
    previous = after;
    return { source: text, after };
  });
  const steps: CodeStep[] = [];
  for (const when of whens)
    if (when.after === -1) steps.push({ kind: "when", source: when.source });
  lets.forEach((binding, j) => {
    steps.push({ kind: "let", ...binding });
    for (const when of whens)
      if (when.after === j) steps.push({ kind: "when", source: when.source });
  });
  return { steps, result: check(result, `${where} return`).text, reads };
}

/** The named groups of a regex. */
const groupsOf = (pattern: string) =>
  new Set([...pattern.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].map((m) => m[1]));

/**
 * Reads the helpers of a file: its own sections, then those of its rules in order (`where` names
 * each). All the names share the file's scope. Functions are added with `functionCode`.
 */
export function fileCode(
  name: string,
  sections: readonly (readonly [where: string, sections: CodeSections])[],
  scope: CodeScope,
  expand: Expand,
  errors: string[],
): { code: FileCode; names: Names } {
  const names = new Set<string>();
  const sets: Record<string, string[]> = {};
  const maps: Record<string, Record<string, unknown>> = {};
  const claim = (key: string, at: string) => {
    if (!NAME.test(key)) errors.push(`${at}: not a name`);
    if (names.has(key)) errors.push(`${at}: "${key}" is defined twice`);
    if (name !== "common" && scope.shared.has(key))
      errors.push(`${at}: "${key}" is a name of common.yaml`);
    if (scope.library?.has(key)) errors.push(`${at}: "${key}" is a name of the rule library`);
    if (EXPRESSION_GLOBALS.has(key)) errors.push(`${at}: "${key}" is a global`);
    names.add(key);
  };
  const specs: [string, string, DefSpec][] = [];
  for (const [where, section] of sections) {
    for (const [key, words] of Object.entries(section.sets ?? {})) {
      const at = `${where} set ${key}`;
      claim(key, at);
      if (!Array.isArray(words) || !words.every((word) => typeof word === "string"))
        errors.push(`${at}: give a list of strings`);
      else sets[key] = [...words];
    }
    for (const [key, value] of Object.entries(section.maps ?? {})) {
      const at = `${where} map ${key}`;
      claim(key, at);
      if (typeof value !== "object" || value === null || Array.isArray(value))
        errors.push(`${at}: give a mapping`);
      else maps[key] = { ...(value as Record<string, unknown>) };
    }
    for (const [key, spec] of Object.entries(section.defs ?? {})) {
      claim(key, `${where} def ${key}`);
      specs.push([where, key, spec]);
    }
  }
  const taken = (ref: string) =>
    names.has(ref) ||
    EXPRESSION_GLOBALS.has(ref) ||
    (name !== "common" && scope.shared.has(ref)) ||
    !!scope.library?.has(ref);
  // Without the library's names any other name may be one of them: the type checker decides.
  const fileNames: Names = { known: (ref) => taken(ref) || !scope.library, taken };
  const defs: DefCode[] = [];
  for (const [at, key, spec] of specs) {
    const where = `${at} def ${key}`;
    if (typeof spec === "string") {
      const { steps, result } = body(where, {}, spec, new Set(), fileNames, expand, errors);
      defs.push({ name: key, where, steps, result, otherwise: "null" });
      continue;
    }
    if (typeof spec !== "object" || spec === null || typeof spec.return !== "string") {
      errors.push(`${where}: give an expression, or a mapping with "return"`);
      continue;
    }
    for (const field of Object.keys(spec))
      if (!DEF_KEYS.has(field)) errors.push(`${where}: unknown field "${field}"`);
    const signature = defSignature(`${key}(${spec.args ?? ""})`);
    if (!signature) {
      errors.push(`${where}: "args" is not a parameter list`);
      continue;
    }
    const params = new Set(signature.params);
    const { steps, result } = body(where, spec, spec.return, params, fileNames, expand, errors);
    const otherwise =
      spec.else === undefined
        ? "null"
        : body(`${where} else`, {}, spec.else, params, fileNames, expand, errors).result;
    defs.push({
      name: key,
      where,
      args: spec.args ?? "",
      ...(spec.type === undefined ? {} : { type: spec.type }),
      steps,
      result,
      otherwise,
    });
  }
  return { code: { sets, maps, defs, functions: [], names }, names: fileNames };
}

/**
 * The function of a frame (kind "fixer", with its style and regex) or of a rule (a filter, a
 * detector or a live rule) whose body has a `return` expression.
 */
export function functionCode(
  key: string,
  kind: CodeKind,
  where: string,
  spec: BodySpec,
  names: Names,
  expand: Expand,
  errors: string[],
  frame?: { readonly style: FrameStyle; readonly pattern: string },
  triggers?: readonly string[],
): FunctionCode | undefined {
  if (typeof spec.return !== "string") {
    errors.push(`${where}: "return" is one expression`);
    return undefined;
  }
  const style = frame?.style;
  if (style !== undefined) {
    if (NO_FIX[style] === undefined && style !== "cased")
      errors.push(`${where}: style "${style}" has no "return" expression`);
    if (style === "cased" && spec.when !== undefined)
      errors.push(`${where}: a cased frame always gives its fix; it has no "when"`);
  }
  const portuguese = style === "portuguese";
  const params = (portuguese ? PORTUGUESE_PARAMS : PARAMS[kind]).map(([param]) => param);
  const groups = frame && !portuguese ? groupsOf(frame.pattern) : new Set<string>();
  for (const group of groups)
    if (names.taken(group))
      errors.push(`${where}: group "${group}" has the name of a def or a library function`);
  const otherwise = kind === "fixer" ? (NO_FIX[style ?? "frame"] ?? "null") : OTHERWISE[kind];
  const { steps, result, reads } = body(
    where,
    spec,
    spec.return,
    new Set([...params, ...groups]),
    names,
    expand,
    errors,
  );
  if (steps.some((step) => step.kind === "when"))
    for (const ref of checkExpression(otherwise).refs) reads.add(ref);
  const usedGroups = [...groups].filter((g) => reads.has(g));
  // Only the parameters up to the last one the body reads (a group reads `m`).
  const last = params.reduce(
    (at, param, i) => (reads.has(param) || (param === "m" && usedGroups.length) ? i : at),
    -1,
  );
  return {
    key,
    kind,
    ...(style === undefined ? {} : { style }),
    where,
    params: params.slice(0, last + 1),
    groups: usedGroups,
    steps,
    result,
    otherwise,
    ...(triggers === undefined ? {} : { triggers: [...triggers] }),
  };
}
