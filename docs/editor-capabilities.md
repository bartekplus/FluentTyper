# Editor capability detection

FluentTyper separates activation, current keyboard ownership, and Review transactions.
A fingerprint restricts a writer. It does not prove that an editor supports that writer.

## Safeguards and modules

- `SuggestionElementDiscovery.ts` discovers fields and open shadow roots. Each injected frame has its own runtime.
- `FieldEligibility.ts` excludes credentials, payment fields, locked controls, and hidden fields before Review reads text.
- `CodeContextResolver.ts` identifies semantic code and protected selection ranges. Weak CSS names do not exclude a document.
- `NativeAutocompleteConflictDetector.ts` distinguishes structured fields and browser datalists from prose. It checks linked popup visibility and actionable options.
- `SuggestionManagerRuntime.ts` manages activation, saved field choices, active sessions, and teardown.
- `DomObserver.ts`, `MutationPipeline.ts`, and the mutation scheduler process relevant changes. Typing-only mutations do not cause discovery scans.
- `SuggestionEntrySession.ts` cancels stale requests and timers. `SuggestionTextEditService.ts` uses the adapter transactions.
- `ReviewTargets.ts` separates reading from verified writes. `ReviewController.ts` and `ReviewUi.ts` show restrictions outside editor content.

These files are under `src/adapters/chrome/content-script/`. Suggestion modules are in `suggestions/`; Review modules are in `review/`.
Review detection stays in the extension background. Typing handlers do no inference work.

## Capability record

An ordinary input with only `role="combobox"` activates automatically.
ARIA roles, popup hints, and stale expanded flags do not prevent automatic activation.
Structured purpose attributes and usable browser datalists keep manual activation.

`EditorCapabilities.ts` returns a fixed, text-free record. It has these fields: `inspectProse`, `displaySuggestions`, `renderReview`, `reviewApply`, `consumeAcceptanceKey`, `conflict`, `context` (`prose`, `code`, `protected`, or `unknown`), and `reason`.
It does no model reads, stores no history, and creates no observers.
The runtime checks this record before interaction. Review uses the same metadata gate before its text safety checks.
`reviewApply` requires the target's separate `ReviewCapabilities` evidence. Typing permission never grants Review write permission.

The typing adapters write as follows:

- ProseMirror and Slate: a host transaction through the MAIN-world bridge. Tiptap renders a ProseMirror view, so it uses the ProseMirror path.
- CKEditor 5: one `model.change` batch through the MAIN-world bridge. The batch replaces the text of the model block at the DOM selection and keeps the attributes of the text at the caret.
  An inline object without DOM text, for example an inline image, has one model offset and no text, as a `softBreak`. The bridge refuses an edit that contains an inline object, or that has one between the edit and the caret. The inserted text never takes the attributes of an object. An element that shows text, for example a mention, gives no block context. Then CKEditor 5 takes the write as `beforeinput` into its typing batch, and Undo also removes the typed text.
- Draft.js and Trix (`MODEL_TYPING_SELECTOR`): one model transaction through their Review writer, with the caret after the accepted word. Draft.js gets one `insert-fragment` push. Trix gets one recorded undo entry.
- TinyMCE, CKEditor 4, Froala and Summernote: a native edit in one host undo step.
- Lexical: no bridge path. FluentTyper sends a synthetic `insertReplacementText` `beforeinput` event on the replaced range. Lexical applies the event to its own model. If no handler takes the event, the write is refused.
- Quill, also a bundled Quill such as Slack's composer: native input that Quill applies to its own model. Quill 2 takes the synthetic `insertReplacementText` `beforeinput` event. Quill 1 ignores that event, so FluentTyper uses the browser's `insertText` command, and Quill reads the DOM change into its model. Quill's history puts the changes of the last second into one undo step.
  Thus, before and after the write, the bridge records the pending DOM changes (`quill.update`) and starts a new undo step (`history.cutoff()`). Then Undo removes only the accepted word, not the typed text before it.
  The bridge must find the Quill instance: through `window.Quill` (Quill 1 or Quill 2), or through the instance that a bundled Quill 1 keeps on its `.ql-container`. A bundled Quill 2 keeps its instances in a private module map. There, FluentTyper cannot set the boundary, and Undo also removes the text typed in the last second.
- CodeMirror 5: the bridge finds the CodeMirror instance by its methods (`replaceRange`, `getLine`, `getCursor`) on the field or an ancestor. It replaces the caret line range with `replaceRange` and the `+input` origin in one `operation`. This path needs a contenteditable field, so it needs CodeMirror's `contenteditable` input style.

Their typing paths validate each write. Their fingerprints alone do not grant Review writes.
Review writes need the MAIN-world bridge to find the editor itself: Lexical, Draft.js, CKEditor 5 and Trix get a model transaction, and TinyMCE, CKEditor 4, Froala and Summernote get a native edit inside one host undo step.
A fingerprint without a working bridge gives Review only. It cannot select a generic Review DOM writer.

Acceptance handlers consume keys only after a synchronous action succeeds. Tab does not queue acceptance of an unseen inline suggestion.
Code/prose transitions invalidate predictions, also when the text stays the same. The early Tab bridge checks the context recorded when the menu rendered.
Temporary unknown selection states keep the host reconciliation path.
ARIA-disabled and ARIA-readonly ancestors block interaction across shadow boundaries.
Review-only finding cards offer Copy. Clipboard writes require a trusted click and do not edit the field.

## Capability and reason matrix

| Context                                                    | Prose inspection               | Typing suggestions / acceptance                                             | Review / Apply                               | Reason or limit                                    |
| ---------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Ordinary input or textarea, including stale ARIA hints     | Yes                            | Yes, when a valid action is visible                                         | Yes / native transaction required            | `available`                                        |
| Associated visible native popup                            | Yes                            | Temporarily paused with the preference enabled                              | Yes / target transaction required            | `native-popup`                                     |
| Unrelated visible popup                                    | Yes                            | Unchanged                                                                   | Unchanged                                    | No field association                               |
| Structured purpose                                         | According to the privacy rules | Manual activation                                                           | Conservative Review exclusions               | `manual-activation`                                |
| Usable browser datalist                                    | Yes for prose                  | Manual activation; acceptance keys yield while native preference is enabled | Yes / target transaction required            | `manual-activation` (conflict `browser-unknown`)   |
| Model-editor fingerprint without a typing path             | Yes                            | Disabled                                                                    | Review and Copy / no Apply                   | `unverified-writer`                                |
| Typing-path fingerprint without its editor                 | Yes                            | Shown; each write is refused                                                | Review and Copy / no Apply                   | `available`; the record permits only an attempt    |
| Verified ProseMirror (also Tiptap) or Slate Review bridge  | Yes                            | Host transaction through the bridge                                         | Yes / verified model transaction             | Each edit revalidates model and ranges             |
| Quill, also a bundled Quill                                | Yes                            | Native input that Quill applies to its own model                            | Yes / Delta transaction or Quill beforeinput | Own undo step except for a bundled Quill 2         |
| Verified Draft.js or Trix bridge                           | Yes                            | One model transaction through the Review writer                             | Yes / verified model transaction             | Each edit revalidates model and ranges             |
| Verified CKEditor 5 bridge                                 | Yes                            | One `model.change` batch through the bridge                                 | Yes / verified model transaction             | Each edit revalidates model and ranges             |
| Verified Lexical bridge                                    | Yes                            | `beforeinput` that Lexical applies to its own model                         | Yes / verified model transaction             | Each edit revalidates ranges and result text       |
| CodeMirror 5 with the `contenteditable` input style        | No                             | Code predictions; `replaceRange` in one `operation`                         | No                                           | `code`                                             |
| Verified TinyMCE, CKEditor 4, Froala or Summernote bridge  | Yes                            | Native edit in one host undo step                                           | Yes / native edit in one host undo step      | Each edit revalidates DOM, ranges and formatting   |
| Mixed prose and code                                       | Prose with protected ranges    | Fresh code predictions keep capitalization suppression                      | Prose only / protected ranges cannot change  | Current context is separate from host eligibility  |
| Credential, disabled, read-only, hidden, or detached field | No                             | No                                                                          | No                                           | `sensitive`, `restricted`, `hidden`, or `detached` |

A typing-path fingerprint is on the field itself. It is one of `.ProseMirror`, `[data-slate-editor]`, `[data-lexical-editor]`, `.ck-editor__editable`, `trix-editor`, `.public-DraftEditor-content`, `.mce-content-body`, `.cke_editable`, `.fr-element` and `.note-editable`, or a Gutenberg field.
The other fingerprints of `MODEL_EDITOR_SELECTOR` have no typing path, for example `.DraftEditor-root` or `[data-contents]` on the field. A field that is only inside a fingerprint, and has no typing-path fingerprint itself, also has no typing path.
A typing-path fingerprint without its editor never gets a generic DOM write. `ContentEditableAdapter.ts` refuses ProseMirror, Slate and Gutenberg before it sends an event.
It refuses the other model fingerprints when no handler takes the synthetic `beforeinput` event. It refuses the DOM-model editors when the bridge finds no host undo integration.

No field in the record proves that a write will succeed. `displaySuggestions` and `reviewApply` permit only an attempt.
Each write goes through a transaction. The transaction must validate its target, range, selection, result, and Undo behavior.
The diagnostic record contains no text, identifiers, URLs, or accumulated event history. It is not uploaded or persisted.

## Settings and lifecycle precedence

1. Global and site enablement determine whether the runtime starts.
2. Credential and structural exclusions remain mandatory. Site choices and manual activation cannot bypass them.
3. Saved field choices can enable structured fields. Disabling the native preference preserves the user's explicit interaction choice.
4. With native preference enabled, a current linked popup overrides field activation. Review remains independent.
5. A writer must still pass its own transaction checks. Review-only capability never authorizes a Review mutation.

Popup closure, focus, relevant mutations, and new input re-evaluate the current element.
The session remains attached during a temporary native popup. Requests issued before a capability change cannot restore old suggestions.
Closure restores eligibility without a reload. Fresh suggestions use the next input or explicit request, so native choices are not replayed as corrections.
Removed fields lose their sessions, listeners, timers, and UI. Replacement fields receive new sessions.
If a model mounts on the same host during Review, Apply becomes unavailable. Reopen Review to resolve the new model adapter.
A Lexical, Draft.js, CKEditor 5 or Trix field whose DOM text differs from its model when Review opens is review-only until the model reads. The open Review reads the model again on each read and once a second.
A difference that stays keeps the field review-only. A partial read is not safe: a model write renders the changed block again from the model and can remove text that only the DOM has.
There is no negative cache. FluentTyper UI stays outside serialized editor content.

## Limits and manual smoke procedure

DOM inspection cannot reliably identify browser chrome popup state, closed-shadow popups, canvas pickers, or unlinked custom keyboard handlers.
Usable datalists therefore keep an explicit limitation and yield acceptance keys with native preference enabled.
Other invisible or unassociated native handlers remain a limitation. FluentTyper does not infer conflicts from a site's domain or historical editor family.
The MAIN-world early Tab bridge still sends an asynchronous request. An intervening host change can make that request fail after key capture.
The receiving session revalidates the edit. The context check reduces this race but does not eliminate all asynchronous host changes.

The automated tests use synthetic pages and editor fixtures. They do not establish current live-site compatibility.
For a live smoke check:

1. Open a non-sensitive composer with the production extension.
2. Record the actual editor and adapter evidence. Do not infer it from the site's name.
3. Open and close native suggestions. Check Tab, Enter, arrows, and focus movement.
4. Start Review while native suggestions are open. Check that it reads without automatic edits.
5. Test a single replacement and Undo only where the target offers Apply.
6. Replace the field or navigate. Check that the old UI and listeners are removed.
7. Disable FluentTyper for the site. Check that the page receives normal keys.
