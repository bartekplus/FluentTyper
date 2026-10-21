// The code of a rule file: its `sets`, `maps` and `defs`, and the `let`, `when` and `return` of its
// frames. The compiler checks each expression and the names it reads; the generator writes the
// code of each file into a typed module (engine/rules/<file>.generated.ts).
import { checkExpression, defSignature, EXPRESSION_GLOBALS } from "./expressions";
import type { FrameStyle } from "./types";

/** One step of a body: a binding, or a condition that ends the body when it fails. */
export type CodeStep =
  | { readonly kind: "let"; readonly name: string; readonly source: string }
  | { readonly kind: "when"; readonly source: string };

/** A frame's fix as code. */
export interface FrameCode {
  /** The fixer name the compiled frame names ("@<rule id>/<frame number>"). */
  readonly key: string;
  readonly style: FrameStyle;
  readonly where: string;
  /** The parameters the body reads, in call order: "m", "ctx", "frame" (or "target"). */
  readonly params: readonly string[];
  /** The match groups the body reads. */
  readonly groups: readonly string[];
  readonly steps: readonly CodeStep[];
  readonly fix: string;
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
  readonly frames: readonly FrameCode[];
  /** The names of the file (sets, maps, defs) that other names read. */
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

/** The code fields of a frame as YAML: bindings, conditions and the fix it returns. */
export interface FrameCodeSpec {
  readonly let?: Readonly<Record<string, string>>;
  readonly when?: string | readonly string[];
  readonly return?: string;
}

/** What a frame of each style gives when one of its `when` conditions fails. */
export const NO_FIX: Readonly<Partial<Record<FrameStyle, string>>> = {
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

/** Checks a body (lets, whens and its result) and orders the whens: each runs right after the
 * last binding it reads, so a cheap condition ends the body before a costly binding. */
function body(
  where: string,
  spec: {
    readonly let?: Readonly<Record<string, string>>;
    readonly when?: string | readonly string[];
  },
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
  const whens = ([] as string[]).concat(spec.when ?? []).map((source, i) => {
    const at = `${where} when ${i + 1}`;
    if (typeof source !== "string") {
      errors.push(`${at}: give an expression`);
      return { source: "true", after: -1 };
    }
    const { text, refs } = check(source, at);
    // The last binding the condition reads.
    let after = -1;
    lets.forEach((binding, j) => {
      if (refs.has(binding.name)) after = j;
    });
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

/** Reads the code sections of a file (sets, maps, defs); frames are added with `frameCode`. */
export function fileCode(
  name: string,
  file: {
    readonly sets?: Readonly<Record<string, unknown>>;
    readonly maps?: Readonly<Record<string, unknown>>;
    readonly defs?: Readonly<Record<string, DefSpec>>;
  },
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
    names.add(key);
  };
  for (const [key, words] of Object.entries(file.sets ?? {})) {
    const at = `${name}.yaml set ${key}`;
    claim(key, at);
    if (!Array.isArray(words) || !words.every((word) => typeof word === "string"))
      errors.push(`${at}: give a list of strings`);
    else sets[key] = [...words];
  }
  for (const [key, value] of Object.entries(file.maps ?? {})) {
    const at = `${name}.yaml map ${key}`;
    claim(key, at);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      errors.push(`${at}: give a mapping`);
    else maps[key] = { ...(value as Record<string, unknown>) };
  }
  const specs = Object.entries(file.defs ?? {});
  for (const [key] of specs) claim(key, `${name}.yaml def ${key}`);
  const taken = (ref: string) =>
    names.has(ref) ||
    EXPRESSION_GLOBALS.has(ref) ||
    (name !== "common" && scope.shared.has(ref)) ||
    !!scope.library?.has(ref);
  // Without the library's names any other name may be one of them: the type checker decides.
  const fileNames: Names = { known: (ref) => taken(ref) || !scope.library, taken };
  const defs: DefCode[] = [];
  for (const [key, spec] of specs) {
    const where = `${name}.yaml def ${key}`;
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
    const { steps, result } = body(
      where,
      spec,
      spec.return,
      new Set(signature.params),
      fileNames,
      expand,
      errors,
    );
    const otherwise =
      spec.else === undefined
        ? "null"
        : body(where, {}, spec.else, new Set(signature.params), fileNames, expand, errors).result;
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
  return { code: { sets, maps, defs, frames: [], names }, names: fileNames };
}

/** The code of one frame with a `return` expression. */
export function frameCode(
  key: string,
  style: FrameStyle,
  where: string,
  pattern: string,
  spec: FrameCodeSpec,
  names: Names,
  expand: Expand,
  errors: string[],
): FrameCode | undefined {
  if (typeof spec.return !== "string") {
    errors.push(`${where}: "return" is one expression`);
    return undefined;
  }
  const noFix = NO_FIX[style];
  if (noFix === undefined) errors.push(`${where}: style "${style}" has no "return" expression`);
  if (style === "cased" && spec.when !== undefined)
    errors.push(`${where}: a cased frame always gives its fix; it has no "when"`);
  const groups = groupsOf(pattern);
  const params = style === "portuguese" ? ["target"] : ["m", "ctx", "frame"];
  const bound = new Set(style === "portuguese" ? params : [...params, ...groups]);
  for (const group of groups)
    if (names.taken(group))
      errors.push(`${where}: group "${group}" has the name of a def or a library function`);
  const { steps, result, reads } = body(where, spec, spec.return, bound, names, expand, errors);
  const usedGroups = style === "portuguese" ? [] : [...groups].filter((g) => reads.has(g));
  // Only the parameters up to the last one the body reads (a group reads `m`).
  const last = params.reduce(
    (at, param, i) => (reads.has(param) || (param === "m" && usedGroups.length) ? i : at),
    -1,
  );
  return {
    key,
    style,
    where,
    params: params.slice(0, last + 1),
    groups: usedGroups,
    steps,
    fix: result,
  };
}
