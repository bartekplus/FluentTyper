# Large editor surfaces: Gmail, Outlook and Notion

[FluentTyper](../README.md) / [Editor capability detection](editor-capabilities.md) / Large editor surfaces

This report covers three high-traffic editors that had no verified writer: Gmail compose, Outlook on the web (RoosterJS) and Notion.
The evidence comes from public sources, open-source code, synthetic fixtures and one live probe in a test session (October 2026).
The live probe used only a new, empty Outlook draft and one new Notion test block. It read no mail and no other page text.
**[V]** marks a verified fact. **[I]** marks an inference.

## Summary

| Surface             | Editor model                                       | Generic path safe?                          | Writer now                                         | Status                        |
| ------------------- | -------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ----------------------------- |
| Gmail compose       | DOM is the model [I]                               | Yes, with limits [I]                        | Generic contenteditable path                       | No change                     |
| Outlook (RoosterJS) | DOM plus a cached Content Model, snapshot Undo [V] | **No**: Undo and Redo can lose the edit [V] | RoosterJS snapshot transaction                     | Supported; live check pending |
| Notion              | Block tree with server sync, own Undo [V]          | Only when the caret is in the block [V]     | Native edit in one block leaf, with a revert watch | Supported; live check pending |

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

**Risks.**

- Verification reads the DOM, not Notion's model. A revert later than one second is not seen.
- The 100 ms and one-second limits come from one live probe.
- Each block gets its own session and a hidden popup host.

## Live checks that are still open

1. Outlook: Tab acceptance and Fix all, each undone and redone in one step; refusal during a real IME composition; the "To" field keeps the generic path.
2. Notion: Escape with the popup open; acceptance in block 1 and block N survives a reload; one Review fix survives a reload and undoes in one step; a fix with the caret in another block is refused.
3. Firefox: all three surfaces.

---

[Editor capability detection](editor-capabilities.md) · [Review reference](review-reference.md)
