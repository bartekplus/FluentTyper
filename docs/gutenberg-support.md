# Gutenberg support

The adapter uses native RichText, block actions, and entity actions through the existing MAIN-world bridge.
It binds fields by registry, block client ID, and attribute path. It does not match fields by text.
All extension processing remains local. Permission lists remain unchanged.

## Repeatable tests

Use `bun run test:e2e:wordpress --platform=chrome` or `--platform=firefox` for fast browser fixtures.
These tests use real Gutenberg packages and require no WordPress server or Docker.
The full E2E suite also includes them.

Use `--runtime=playground` for a temporary WordPress site with PHP/WASM and SQLite.
Use Node.js 22 or 24. Set `WORDPRESS_NODE_BIN` if necessary.
Use `--runtime=docker` for the optional `@wordpress/env` installation.
Both native runtimes use WordPress 7.1.2 from `.wp-env.json`.
Requested native tests fail when setup fails.

Pinned fixture packages include `@wordpress/block-editor` 18.0.0, `@wordpress/block-library` 11.1.0,
and `@wordpress/rich-text` 7.56.0. `bun.lock` records the complete dependency versions.

## Feature matrix

| Feature                                                                               | Implementation                                              | Evidence                                                                          | Open checks                                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Popup keyboard and mouse acceptance                                                   | Native block writer                                         | Chrome and Firefox fixtures                                                       | Native one-step history for each acceptance path     |
| Inline acceptance and continued typing                                                | Same native writer                                          | Chrome and Firefox fixtures                                                       | Native save/reload for this path                     |
| Text expansion                                                                        | Literal RichText insertion                                  | Browser fixture and multiline unit test                                           | Multiline and variable browser cases                 |
| Typing correction                                                                     | Same native writer                                          | Chrome and Firefox fixtures                                                       | Native history for individual corrections            |
| Live grammar proposals                                                                | Existing proposal checks and native writer                  | Chrome and Firefox fixtures                                                       | Native saved draft case                              |
| Whole-document Review                                                                 | Verified editable fields in the active canvas               | Normal and blob browser fixtures                                                  | Complete native tree coverage for unmounted fields   |
| Selected Review                                                                       | DOM and native block selection offsets                      | Cross-field browser fixtures and unit tests                                       | Native multi-block selection browser case            |
| Individual fixes and Fix all safe                                                     | RichText edits and native batches                           | Browser fixtures, native draft history and persistence                            | Firefox native history and persistence               |
| Paragraphs, headings, nested lists, quotes, citations, table cells, captions, buttons | RichText attribute bindings, including nested paths         | Core prose browser fixture                                                        | Navigation and all other core prose permutations     |
| Custom RichText blocks                                                                | Verified binding and native writer required                 | Real custom block fixture                                                         | Separate editor registry browser fixture             |
| Post titles, post-title blocks, site title, tagline                                   | Native post or entity actions                               | Entity ownership tests and Chrome native title history/save/reload                | Firefox native title history and save/reload         |
| Protected content and stale snapshots                                                 | Fail-closed preflight and post-write verification           | Composition, Unicode, formatting, movement, read-only, and API failure unit tests | Browser IME and canvas replacement                   |
| Review navigation, highlights, Ignore, dictionary and settings                        | Existing Review target interface                            | Native fixture highlights and shared Review coverage                              | Gutenberg-specific dictionary and live setting cases |
| Native autocomplete priority                                                          | Existing linked popup detection                             | Shared native-menu tests                                                          | Real Gutenberg slash and mention menus               |
| Local AI corrections and rewrites                                                     | Existing consent, proposal checks, and native Review writer | Shared proposal checks and native writer tests                                    | Gutenberg-specific proposal browser case             |

Chrome native WordPress tests also cover a batch across two loaded template parts.
They check one-step Undo/Redo, continued typing, a separate typing Undo step, and save/reload.

The current checkpoint passed 30 focused unit tests and eight fast E2E tests per browser.
The coverage mapping check passed. Full suite results from the earlier checkpoint require a final rerun.

This matrix records incomplete acceptance checks. It does not claim full Gutenberg acceptance.
Review reports unread or unsupported fields and preserves the existing size limits.
An ambiguous binding, protected field, stale snapshot, or incompatible history manager prevents a write.
An edit that fails verification after dispatch does not use a DOM fallback or retry.

## Public demo

The public demo at [WordPress Gutenberg](https://pl.wordpress.org/gutenberg/) is separate from CI evidence.
Its observed version was WordPress 7.2-alpha-64071 on 2026-10-03.
Successful extension writing tests on that demo are still pending.
Use only synthetic, unsaved text when checking the demo.
