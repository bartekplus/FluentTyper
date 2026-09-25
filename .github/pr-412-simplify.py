from pathlib import Path
import json
import sys

ROOT = Path('.')


def replace(path, old, new):
    file = ROOT / path
    text = file.read_text()
    assert text.count(old) == 1, (path, old[:100], text.count(old))
    file.write_text(text.replace(old, new))


def remove_function(path, name, next_marker):
    file = ROOT / path
    text = file.read_text()
    start = text.index('function ' + name + '(')
    end = text.index(next_marker, start)
    file.write_text(text[:start] + text[end:])


def tests():
    Path('tests/codeContextTestUtils.ts').write_text('''import { expect } from "bun:test";

export function createEditor(html: string, doc: Document = document): HTMLDivElement {
  const element = doc.createElement("div");
  element.setAttribute("contenteditable", "true");
  // jsdom does not implement inherited isContentEditable.
  Object.defineProperty(element, "isContentEditable", { configurable: true, value: true });
  element.innerHTML = html;
  doc.body.append(element);
  return element;
}

export function setCaret(
  node: Node,
  offset = node.nodeType === 3 ? (node.textContent?.length ?? 0) : node.childNodes.length,
): void {
  const doc = node.ownerDocument ?? document;
  const selection = doc.getSelection();
  if (!selection) throw new Error("Missing fixture selection");
  const range = doc.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Scoped, synchronous override; inherited jsdom methods need own properties in Bun. */
export function withProperty(target: object, name: string, value: unknown, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  try {
    expect(Reflect.get(target, name)).toBe(value);
    run();
  } finally {
    if (previous) Object.defineProperty(target, name, previous);
    else Reflect.deleteProperty(target, name);
  }
}
''')
    resolver = 'tests/CodeContextResolver.test.ts'
    replace(resolver, 'import { afterEach, expect, jest, test } from "bun:test";', 'import { afterEach, expect, jest, test } from "bun:test";\nimport { createEditor as editor, setCaret as caret, withProperty } from "./codeContextTestUtils";')
    remove_function(resolver, 'editor', 'function text(')
    remove_function(resolver, 'withProperty', 'afterEach(')

    grammar = 'tests/CodeContextGrammar.test.ts'
    replace(grammar, 'import { afterEach, expect, jest, test } from "bun:test";', 'import { afterEach, expect, jest, test } from "bun:test";\nimport { createEditor, setCaret as select } from "./codeContextTestUtils";')
    replace(grammar, '''  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  Object.defineProperty(root, "isContentEditable", { configurable: true, value: true });
  root.innerHTML = '<p>teh </p><div class="ql-code-block">teh </div>';
  document.body.append(root);''', '''  const root = createEditor('<p>teh </p><div class="ql-code-block">teh </div>');''')
    remove_function(grammar, 'select', 'function coordinator(')

    shadow = 'tests/CodeContextShadow.test.ts'
    replace(shadow, 'import { expect, jest, test } from "bun:test";', 'import { expect, jest, test } from "bun:test";\nimport { createEditor, withProperty } from "./codeContextTestUtils";')
    remove_function(shadow, 'withProperty', 'function fixture(')
    replace(shadow, '''  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  Object.defineProperty(root, "isContentEditable", { value: true });
  root.innerHTML = '<p>prose</p><div class="ql-code-block">code</div>';''', '''  const root = createEditor('<p>prose</p><div class="ql-code-block">code</div>');''')
    with Path(shadow).open('a') as file:
        file.write('''

test("code-context fixtures restore inherited properties after exceptions", () => {
  const target = Object.create({ value: "inherited" }) as { value: string };
  expect(() => withProperty(target, "value", "temporary", () => {
    expect(target.value).toBe("temporary");
    throw new Error("fixture failure");
  })).toThrow("fixture failure");
  expect(Object.hasOwn(target, "value")).toBe(false);
  expect(target.value).toBe("inherited");
});

test("code-context fixtures restore nested overrides and exact accessor descriptors", () => {
  const target = {};
  Object.defineProperty(target, "value", {
    configurable: true,
    enumerable: false,
    get: () => "original",
  });
  const original = Object.getOwnPropertyDescriptor(target, "value");
  withProperty(target, "value", "outer", () => {
    expect(() => withProperty(target, "value", "inner", () => {
      throw new Error("nested failure");
    })).toThrow("nested failure");
    expect(Reflect.get(target, "value")).toBe("outer");
  });
  expect(Object.getOwnPropertyDescriptor(target, "value")).toEqual(original);
  expect(Reflect.get(target, "value")).toBe("original");
});
''')

    prediction = 'tests/CodePredictionCapitalization.test.ts'
    replace(prediction, 'import { afterEach, describe, expect, jest, test } from "bun:test";', 'import { afterEach, describe, expect, jest, test } from "bun:test";\nimport type { ContentScriptPredictRequestContext } from "../src/core/domain/messageTypes";\nimport { createEditor, setCaret as caret, withProperty } from "./codeContextTestUtils";')
    remove_function(prediction, 'caret', 'describe(')
    replace(prediction, '''    const root = document.createElement("div");
    root.setAttribute("contenteditable", "true");
    Object.defineProperty(root, "isContentEditable", { value: true });
    root.innerHTML = '<p>what . wa</p><div class="ql-code-block">what . wa</div>';
    document.body.append(root);
    const getPrediction = jest.fn();''', '''    const root = createEditor('<p>what . wa</p><div class="ql-code-block">what . wa</div>');
    const getPrediction = jest.fn<(context: ContentScriptPredictRequestContext) => void>();''')
    replace(prediction, '    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "chrome");\n', '')
    replace(prediction, '''    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { runtime: { sendMessage } },
    });
    try {''', '''    withProperty(globalThis, "chrome", { runtime: { sendMessage } }, () => {''')
    replace(prediction, '''    } finally {
      if (descriptor) Object.defineProperty(globalThis, "chrome", descriptor);
      else Reflect.deleteProperty(globalThis, "chrome");
    }''', '''    });''')

    routing_test = '''  test("onMessage combines code casing suppression with site suggestion-count overrides", async () => {
    const cases = [
      [undefined, undefined, undefined],
      [4, undefined, { numSuggestions: 4 }],
      [undefined, true, { suppressAutoCapitalize: true }],
      [4, true, { numSuggestions: 4, suppressAutoCapitalize: true }],
      [undefined, false, undefined],
      [4, false, { numSuggestions: 4 }],
      [undefined, "true", undefined],
      [4, 1, { numSuggestions: 4 }],
    ] as const;
    for (const [numSuggestions, suppressAutoCapitalize, expected] of cases) {
      const harness = await loadBackgroundHarness({
        language: "en_US",
        [KEY_SITE_PROFILES]: numSuggestions === undefined
          ? {}
          : { "example.com": { numSuggestions } },
      });
      const runPrediction = jest
        .spyOn(harness.module.BackgroundServiceWorker.prototype, "runPrediction")
        .mockResolvedValue(undefined);
      try {
        const reply = await new Promise<unknown>((resolve) => {
          harness.onMessage({
            command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
            context: {
              text: "what . wa", nextChar: "", afterCursorTokenSuffix: "s",
              lang: "en_US", suggestionId: 1, requestId: 2,
              suppressAutoCapitalize,
            },
          }, { tab: { id: 77, url: "https://example.com" } as chrome.tabs.Tab, frameId: 3 }, resolve);
        });
        expect(reply).toEqual({ ok: true });
        expect(runPrediction).toHaveBeenCalledTimes(1);
        expect(runPrediction).toHaveBeenCalledWith(expect.objectContaining({
          context: expect.objectContaining({
            text: "what . wa", afterCursorTokenSuffix: "s", tabId: 77, frameId: 3,
          }),
        }), expected);
      } finally {
        runPrediction.mockRestore();
      }
    }
  });

'''
    anchor = '  test("onMessage applies site profile language and suggestion count override", async () => {'
    replace('tests/background.routing.test.ts', anchor, routing_test + anchor)

    e2e = Path('tests/e2e/full.e2e.test.ts')
    text = e2e.read_text()
    text = 'import type Quill from "quill";\n' + text
    start = text.index('  test(\n    "Quill code predictions keep lowercase through Tab and restore prose casing",')
    end = text.index('  test(\n    "Quill preserves block structure and caret-correct insertion on Tab acceptance",', start)
    block = text[start:end]
    # Replace only the three local structural type declarations in this new test.
    import re
    block, count = re.subn(r'window as typeof window & \{\s+__testQuill\?: \{.*?\};\s+\}', 'window as typeof window & { __testQuill?: Quill }', block, flags=re.S)
    assert count == 2, count
    block = block.replace('window as typeof window & { __testQuill?: { getText: () => string } }', 'window as typeof window & { __testQuill?: Quill }')
    assert block.count('__testQuill?: Quill') == 3
    assert block.count('await waitForVisibleSuggestionTexts(page)') == 1
    block = block.replace('await waitForVisibleSuggestionTexts(page)', 'await getVisibleSuggestionTexts(page)')
    e2e.write_text(text[:start] + block + text[end:])

    registry_path = Path('tests/e2e/coverage-matrix.json')
    registry = json.loads(registry_path.read_text())
    casing = [b for b in registry['behaviors'] if any(c['file'] == 'tests/CodePredictionCapitalization.test.ts' for c in b['coverage'])]
    assert len(casing) == 1
    casing[0]['coverage'].append({
        'layer': 'unit', 'file': 'tests/background.routing.test.ts',
        'test': 'onMessage combines code casing suppression with site suggestion-count overrides',
    })
    selection = next(b for b in registry['behaviors'] if b['id'] == 'grammar_code_context_selection_safety')
    for name in ['code-context fixtures restore inherited properties after exceptions', 'code-context fixtures restore nested overrides and exact accessor descriptors']:
        selection['coverage'].append({'layer': 'unit', 'file': 'tests/CodeContextShadow.test.ts', 'test': name})
    registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n')
    # No behavior IDs were added or removed, so the baseline IDs stay unchanged.

    Path('docs/automatic-code-context.md').write_text('''# Automatic rich-text code protection

FluentTyper resolves the current caret's code context for each grammar operation
and prediction request. Moving between code and prose, or changing formatting
without changing text, does not change saved settings or restart the runtime.

## Detection

`CodeContextResolver.ts` recognizes semantic `code`, `pre`, `kbd`, and `samp`
ancestors; Quill's `.ql-code-block` and `.ql-code-block-container`; and the existing
Monaco, CodeMirror, and Ace editor markers. Empty blocks and syntax-highlighting
descendants are covered. Preformatted/literal content receives the same protection.
Code elsewhere in the composer does not disable the active prose paragraph.

Monospace fonts, `spellcheck=false`, `data-gramm=false`, generic `.code` or
`language-*` classes, and program-looking text are not standalone code signals.

Selection is read from the editor's owning document. Shadow editors use
`getComposedRanges()` when available, with scoped or ordinary range fallbacks.
Every resolved range must be collapsed and belong to the target. Missing,
foreign, expanded, or unavailable selections remain unknown. A parent-offset
caret next to code also remains unknown rather than guessing insertion affinity.
A failed composed-selection call never falls back to a different caret.

## Grammar and prediction behavior

`MeasurementEditingContext.ts` preserves existing field eligibility exclusions
and maps every non-prose result to the grammar engine's `protected` hint.
Only code-safe grammar rules run there; an explicitly enabled `autoBracketClose`
still runs. This is not a policy that blocks every extension action.

Prediction requests carry optional `suppressAutoCapitalize: true` for non-prose
DOM contexts. The background applies it per request, never to shared predictor
configuration. Thus `what . wa` can offer and insert `was` in code and `Was` in
prose. Authored `Wa`/`WA`, original candidate casing, and snippet text/metadata
retain their existing behavior; results are not blindly lowercased. Virtual
Google Docs prediction sessions without a DOM element retain their prior behavior.

No dependencies, settings migrations, permissions, external requests, typed-text
logging, or keyboard interception are added. Explicit autocomplete and snippet
acceptance remain available. Markdown parsing is unchanged.

## Limits

Caret-local detection does not validate every replacement range across inline
code, clip grammar context to prose-only spans, or track stale predictions by
region identity. Those are separate transaction safeguards. Custom model-only
code styles and Google Docs canvas formatting need dedicated adapters.

## Tests

`CodeContextResolver.test.ts`, `CodeContextGrammar.test.ts`, and
`CodeContextShadow.test.ts` cover detection, selection boundaries/failures,
formatting changes, real grammar hints, and optional code-safe rules.
`codeContextTestUtils.ts` shares editor/caret fixtures and synchronous property
overrides; exact descriptor restoration is tested even for nested exceptions.

`CodePredictionCapitalization.test.ts` covers casing, request isolation, and
message forwarding. `background.routing.test.ts` covers independent casing and
site suggestion-count overrides. `SuggestionManager.test.ts` checks popup text
and Tab acceptance. The full Chrome/Firefox suite tests the built extension in
real Quill code and prose in the same composer. Automated fixtures are not a
claim of independent live Slack or Google Docs validation.

Run the focused tests:

```sh
bun test tests/CodeContextResolver.test.ts tests/CodeContextGrammar.test.ts tests/CodeContextShadow.test.ts tests/CodePredictionCapitalization.test.ts
```

Run `bun run check`, `bun run test`, `bun run check:e2e:coverage`, and both
browsers' smoke/full suites as specified in `docs/agents/testing.md`. Coverage
entries use the existing stable behavior IDs; no baseline behavior is removed.
''')


def production():
    resolver = 'src/adapters/chrome/content-script/suggestions/CodeContextResolver.ts'
    replace(resolver, '''type ComposedSelection = Selection & {
  getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => SelectionRange[];
};
''', '')
    replace(resolver, '  const docSelection: ComposedSelection | null = element.ownerDocument.getSelection();', '  const docSelection = element.ownerDocument.getSelection();')
    replace('src/adapters/chrome/content-script/suggestions/MeasurementEditingContext.ts', '  if (element.getAttribute("aria-readonly") === "true") return "protected";\n', '')
    router = 'src/adapters/chrome/background/router/MessageRouter.ts'
    replace(router, 'import type { BackgroundServiceWorker } from "../BackgroundServiceWorker";', 'import type { BackgroundServiceWorker } from "../BackgroundServiceWorker";\nimport type { PredictionConfigOverride } from "../PredictionTypes";')
    replace(router, '''    await rethrowAs(
      () =>
        worker.runPrediction(
          predictRequestMessage,
          domainSettings.hasNumSuggestionsOverride ||
            request.context.suppressAutoCapitalize === true
            ? {
                ...(domainSettings.hasNumSuggestionsOverride
                  ? { numSuggestions: domainSettings.numSuggestions }
                  : {}),
                ...(request.context.suppressAutoCapitalize === true
                  ? { suppressAutoCapitalize: true }
                  : {}),
              }
            : undefined,
        ),''', '''    let configOverride: PredictionConfigOverride | undefined;
    if (domainSettings.hasNumSuggestionsOverride) {
      configOverride = { numSuggestions: domainSettings.numSuggestions };
    }
    if (request.context.suppressAutoCapitalize === true) {
      configOverride = { ...configOverride, suppressAutoCapitalize: true };
    }

    await rethrowAs(
      () => worker.runPrediction(predictRequestMessage, configOverride),''')


if sys.argv[1] == 'tests':
    tests()
elif sys.argv[1] == 'production':
    production()
else:
    raise SystemExit('Expected tests or production')
