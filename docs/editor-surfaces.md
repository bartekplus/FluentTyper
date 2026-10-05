# Large editor surfaces: Gmail, Outlook and Notion

[FluentTyper](../README.md) / [Editor capability detection](editor-capabilities.md) / Large editor surfaces

This report covers three high-traffic editors that had no verified writer: Gmail compose, Outlook on the web (RoosterJS) and Notion.
The evidence comes from public sources, open-source code, synthetic fixtures and one live probe in a test session (October 2026).
The live probe used only a new, empty Outlook draft and one new Notion test block. It read no mail and no other page text.
A live check of the writers followed in the same way, in Chrome with a development build (see [Live check results](#live-check-results)).
**[V]** marks a verified fact. **[I]** marks an inference.

## Summary

| Surface             | Editor model                                       | Generic path safe?                          | Writer now                                         | Status                                |
| ------------------- | -------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| Gmail compose       | DOM is the model [I]                               | Yes, with limits [I]                        | Generic contenteditable path                       | No change                             |
| Outlook (RoosterJS) | DOM plus a cached Content Model, snapshot Undo [V] | **No**: Undo and Redo can lose the edit [V] | RoosterJS snapshot transaction                     | Supported; live check passed (Chrome) |
| Notion              | Block tree with server sync, own Undo [V]          | Only when the caret is in the block [V]     | Native edit in one block leaf, with a revert watch | Supported; live check passed (Chrome) |

## Gmail compose

**Editor model.** The body is one `contenteditable` element. No public source shows a separate document model [I].
InboxSDK, an open-source Gmail SDK, edits the body with plain DOM ranges, and Gmail keeps these edits [V, source].
Undo is the browser's native Undo for text edits [I].

**Generic path.** It is safe for text edits. `execCommand("insertText")` sends `beforeinput` and `input` and goes into the native Undo stack [I].
A DOM edit without a key press can start the draft save late. Gmail reads the DOM when it sends, so the edit is not lost [I].

**Verified writer.** Not necessary. Gmail has no public editor API. A writer would depend on minified internals.

**Risks.**

- Smart Compose also accepts its ghost text with Tab. The native popup detector does not see that ghost text [I].
- Quoted text (`.gmail_quote`) and signatures are in the same editable root. Review treats them as normal text [I].
- Mail is private data. A live check must use a test account and a new, empty draft.

**Decision.** The maintainer chose to keep the generic path.

## Outlook on the web (RoosterJS)

**Editor model.** RoosterJS keeps the DOM live and caches a Content Model. Undo uses HTML snapshots. Rooster takes Cmd+Z and Ctrl+Z itself, and the browser's Undo stack is not used [V].
The compose body is a `div` with `role="textbox"`, `contenteditable="true"` and `data-ms-editor="true"`. It is in the top document [V].

**Generic path: not safe.** A native `insertText` edit does not tell Rooster that the content changed. After a click, one Undo removed two steps, and Redo could not restore the edit [V, live and with roosterjs 9.60.0].

**Verified writer.** A `Transaction` in `ReviewDomEditors.ts` uses the pattern of Rooster's own find and replace: `takeSnapshot()`, the validated native edit, then `takeSnapshot()` and `triggerEvent("contentChanged")` [V, live].
The MAIN-world bridge finds the editor in `window.__ROOSTERJS_DEVTOOLS_EDITORS__` (roosterjs 9.59 and later). It refuses during IME, during shadow edit, without focus and without a range selection.
An editor that is identified without that list gets Review and Copy only. Typing acceptance and Review Apply are each one Rooster Undo step.
The e2e fixture uses the real `roosterjs` package as a dev dependency.

**Bug found.** After Undo of an accepted word, the typed prefix stayed selected, and the next key replaced it [V, live].
The first snapshot recorded the replaced range, and Rooster's Undo restores the selection of that snapshot.
Now the bridge puts the user's caret back before the first snapshot and selects the range again for the edit. TinyMCE, CKEditor 4, Froala and Summernote had the same problem and get the same fix. TinyMCE also records the caret with `beforeChange()`.

**Risks.**

- The devtools list is marked internal. If Microsoft removes it, Outlook falls back to Review only.
- Outlook runs extra plugins (legacy bridge, autocorrect, autoformat). They can change text near an edit. The write is then reported as unverified.
- Text in an empty editor has no Rooster mark yet. Without the list, such a field is not identified.

## Notion

**Editor model.** One root `contenteditable` holds the page. Each block has its own leaf `[data-content-editable-leaf="true"]` [V].
Notion keeps a block tree, sends changes to its server, and has its own Undo. It reads the leaf DOM back into its model on `input` [V].
There is no in-page editor API. Notion ignores synthetic `beforeinput` events [V].

**Generic path.** A native `insertText` edit persists, with one Undo step, when the caret is already in the leaf [V].
Directly after a click, Notion reverted the same edit within one second, with no signal [V]. FluentTyper attached to the whole page root, not to the block.

**Verified writer.** Each block leaf is a field, as each Gutenberg block is. A write needs the caret already in that leaf, no composition, and a range inside the leaf's text.
After the write, FluentTyper reads the leaf back and watches it for one second. A revert makes a Review fix "unverified". Each Review fix is its own Notion Undo step, so Fix all is not offered.
The e2e fixture is a synthetic page with Notion's DOM shape. It contains no Notion code.

**Bug found.** Escape closed the FluentTyper popup but also reached the page. In Notion, Escape selects the block, and the next keys typed nothing. Now Escape is consumed only when it closes a visible FluentTyper popup or inline suggestion.

**Bug found (live check).** Notion's DOM lock removes each foreign attribute of a block leaf at once, also each FluentTyper `data-ft-*` attribute. It logs a "Reverting mutation of attribute" warning for each [V].
Thus the MAIN-world early Tab bridge did not see FluentTyper's state, and Tab used the slower path. FluentTyper does not write again when an attribute is removed: it writes only on its own events (attach, menu render). This is not a loop.
Now the state of a leaf is on the page root, which Notion does not lock [V]. The root names the entry of the leaf that shows the menu.

**Risks.**

- Verification reads the DOM, not Notion's model. A revert later than one second is not seen.
- The 100 ms and one-second limits come from one live probe.
- Each block gets its own session and a hidden popup host.

## Live check results

Chrome, development build, October 2026. All text was synthetic. The test blocks were removed after the check. The test draft was cleared and closed, and it was not sent.

| #   | Check                                                                          | Result |
| --- | ------------------------------------------------------------------------------ | ------ |
| 1   | Outlook: the developer tools list holds the compose editor                     | Pass   |
| 2   | Outlook: Tab acceptance, then one Undo and one Redo                            | Pass   |
| 3   | Outlook: the same after a click at the line end and after a space              | Pass   |
| 4   | Outlook: Review has no "Review only" note; one fix and Fix all, each one Undo  | Pass   |
| 5   | Outlook: the "To" field keeps the generic path                                 | Pass   |
| 6   | Outlook: Outlook's autocorrect does not change the accepted word               | Pass   |
| 7   | Notion: Tab acceptance in a block, one Undo, the word stays after a reload     | Pass   |
| 8   | Notion: acceptance in a second block stays after a reload                      | Pass   |
| 9   | Notion: Escape with the popup open closes only the popup                       | Pass   |
| 10  | Notion: Review note, no Fix all, one fix, one Undo, the fix stays after reload | Pass   |
| 11  | Notion: a fix with the caret in another block is refused                       | Pass   |

The check found two bugs. Both have a fix and a regression test:

- Outlook: after Undo of an accepted word, the typed prefix stayed selected (see [Outlook](#outlook-on-the-web-roosterjs)).
- Notion: the DOM lock removed FluentTyper's attributes from the leaves (see [Notion](#notion)).

Limits that stay:

- Notion: a one-line block shows no Review button. The launcher needs a field of at least 36 px height (`ReviewLauncher.ts`), and a one-line leaf is 28 px high. Open Review with the shortcut or the popup.
- Notion: one Undo can remove the user's typing and a FluentTyper autocorrect together. Notion puts them into one undo step.
- Outlook: the "To" field gets the capitalization of the first word ("hello" becomes "Hello"), as a prose field does.

## Live checks that are still open

1. A real IME composition in Outlook and Notion: the writers must refuse.
2. Firefox: all three surfaces.

---

[Editor capability detection](editor-capabilities.md) · [Review reference](review-reference.md)
