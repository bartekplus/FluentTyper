# Google Docs: Firefox acceptance fix candidate

Tracks #384. Investigated against `238ea1c7be9983802088892fcec8bd56f4f8b28f`.

**Status: targeted regressions pass locally; real Firefox/Google Docs validation is
still required. This is not a declaration of complete Firefox support.**

## Failure mechanisms

1. Firefox can ignore `ClipboardEventInit.clipboardData` and create its own empty
   data store. The previous implementation populated only the constructor argument,
   so the dispatched event could contain no suggestion text. See
   [Mozilla bug 2027025](https://bugzilla.mozilla.org/show_bug.cgi?id=2027025).
2. Firefox does not inject `document_start` content scripts into empty iframes, even
   with `match_about_blank`. The Docs early-key bridge therefore cannot depend only
   on the blank input iframe receiving that content script. See
   [Mozilla content script documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts#match_about_blank).

These mechanisms reproduce the reported symptoms in controlled fixtures. They are
not a substitute for tracing the reporter's real document in Firefox.

## Changes

The MAIN-world bridge constructs the paste event in the editor's realm, then fills
and reads back **that event's actual clipboard data**. It checks both the MIME type
and the exact payload before dispatch, including empty deletion payloads. Existing
edge-space normalization is retained. A missing or unwritable store produces no
paste dispatch; the transaction conservatively remains unverified until a fresh
user interaction, rather than retrying an uncertain write.

When the parent bridge discovers or rebinds the input document, it also installs
the existing frame-window key handler there. A synchronously acknowledged key is
stopped before reaching the editor's document listeners. The original early-frame
path is retained, and acknowledged keys are not handled twice. Parent-owned
listeners are removed when the document changes or the bridge is disposed.

No new permissions, clipboard API calls, telemetry, dependencies, or remote
services are added. This is still one synthetic paste, not trusted/native paste.
Only an independently observed logical-model change counts as successful insertion.
No retry, text-rewrite fallback, synthetic undo, or direct contenteditable mutation
is added to production. Caret geometry and generic title/comment helpers are unchanged.

## Automated coverage and recorded evidence

`tests/GoogleDocsMainWorld.test.ts` exercises the actual MAIN bridge and transaction
through JSON request/reply events, with a small simulated editor and event realms.
It includes constructor-discarded clipboard data, Chromium behavior, payload
validation, Unicode/multiline/edge-space text, single-use tokens, ignored writes,
focus restoration, stale selections, model-history observation, blank-frame Tab
fallback, duplicate-listener avoidance, modifier/composition guards and cleanup.
Its keyboard trust is simulated; its undo/redo case observes model changes, not
native browser undo units. It does not certify the real Docs UI or generic helpers.

Run with the repository toolchain:

```sh
bun test tests/GoogleDocsMainWorld.test.ts
bun run check
bun run test
bun run check:e2e:coverage
bun run test:e2e:docs
bun run test:e2e
bun run test:e2e:full
bun run test:e2e:full --platform=firefox
bun run build --platform=firefox
```

Investigation environment results (2026-09-15):

- A local Node compatibility runner transpiled the new Bun test file and ran its
  assertions against the real source modules: **4 passed / 9 failed before**,
  **13 passed / 0 failed after**. Bun and repository dependencies were unavailable;
  these are not results from `bun run test` or the full repository check.
- A separate Chromium component fixture used actual MAIN/isolated worlds, trusted
  mouse/Tab input, and both native Chromium clipboard events and an emulation of
  Firefox's discarded constructor payload. All four patched acceptance cases
  passed with exactly one paste. Original code reproduced empty-payload and
  missing-frame-handler failures. This fixture used an in-memory editor and small
  client, not the packaged extension or real Firefox. It stayed on `about:blank`
  with a test-only URL-recognition stub; production URL checks were unchanged.
- A focused strict TypeScript check passed using local declarations for the small
  Bun test API surface. Full repository lint, formatting, builds, and browser suites
  were not run in this environment.
- Live Google Docs navigation failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR`.
  Firefox was unavailable. No live smoke test is claimed.

## Required live Firefox check before closing #384

Use a dedicated Firefox profile, the Firefox extension build, and a new disposable
Google document. Enable FluentTyper on Docs and reload so the annotation bootstrap
runs. Do not use valuable document content for initial validation.

Verify popup positioning and actual mouse acceptance, then Tab acceptance. Confirm
one intended insertion, retained focus, normal subsequent typing and new suggestions.
Repeat after moving the caret, changing selection, and switching between editor and
ordinary title/comment fields. Test inline mode at the local caret, zoom/scroll,
multiline suggestions, non-prefix corrections, Unicode and trailing spaces.

Confirm native undo and redo produce the expected document content without duplicate
insertions; verify ordinary title/comment completion separately. Record Firefox and
extension versions, any console errors, and the exact failing action. Complete the
repository regression suites and the live acceptance criteria in #384 before marking
this candidate ready or closing the issue.
