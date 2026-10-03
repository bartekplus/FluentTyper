# Check your draft

[FluentTyper](../README.md) / Review text

Find spelling, grammar, and punctuation issues without leaving your text box. Opening Review does not change your words.

![Review shows a correction with Apply and Ignore once controls.](images/readme/review.png)

## Start a review

1. Place the cursor in the text you want to check.
2. Open the FluentTyper extension popup.
3. Select **Review text**.

You can also press **Alt+Shift+R** or select the **Review** button beside a supported text box.
In Google Docs and Word for the web, use the popup or keyboard shortcut.
You can change the shortcut in your browser's extension shortcut settings.

Review checks the active text field. If you select a passage, supported editors let you check that passage instead.
The panel shows when it checks only part of your text.

## Choose what to change

Select a highlighted word or an issue in the panel. The correction card explains the issue and shows the proposed change.

| Action           | What happens                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **Apply**        | Applies this correction.                                                                           |
| **Ignore once**  | Leaves this occurrence unchanged for the current review.                                           |
| **Fix all safe** | Applies eligible corrections under the current filters. Other issues remain for individual review. |
| **More**         | Offers additional actions, such as disabling a check or adding a spelling to your dictionary.      |

**Fix all safe** does not include every suggestion. It excludes conflicting fixes, spelling choices that need your judgment, and Local AI proposals.
Read the note below the button to see what it covers.

To reverse an applied change, focus the editor and use its **Undo** command.
The number of Undo steps depends on the editor and the changes you applied.

## Keep the words you chose

A name or specialist term can be correct even when the dictionary does not recognize it.
Use **More → Add to dictionary** when that action is available.

Use **Ignore matching occurrences in this review** to ignore repeated findings with the same correction and context.
This does not disable every check for that word. **Restore ignored findings** shows ignored results again.

To change which checks run, open **Settings → Grammar**. Typing and Review have separate controls.
For detailed options, see [preferred terminology](review-reference.md#your-preferred-terminology) and [style advice](review-reference.md#optional-style-and-readability-advice).

## Know what was checked

Review skips code, web addresses, email addresses, and other protected content. It does not review password or other sensitive fields.
It leaves formatting and protected text outside an accepted correction unchanged.

Available checks depend on the [writing language](review-language-matrix.md) and the editor.
“No issues found” means the available checks found no issues. It does not guarantee that the text has no errors.

| Where you write             | What to expect                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Ordinary text boxes         | Corrections and eligible batches, with editor Undo.                                                            |
| Supported rich text editors | Controls depend on the editor. Some allow corrections, while others only show findings.                        |
| Google Docs                 | Individual corrections. Review covers up to 50,000 characters, with the checked scope shown in the panel.      |
| Word for the web            | Corrections when the active text and editor state can be checked. Review refuses writes with Track Changes on. |

See [Google Docs help](google-docs-integration.md) for browser limits.

## If something does not work

- **No Review button:** Use the extension popup or shortcut. The button appears only beside supported multiline fields.
- **No Apply button:** The editor may support findings only. Make the correction in the editor yourself.
- **A change does not apply:** Read the panel message. Check the text before trying again.
- **Unexpected spelling results:** Select the correct [writing language](review-language-matrix.md#choose-your-writing-language).
- **Review failed:** Close Review. Try again from the active text field.

Your reviewed text stays inside the browser. FluentTyper does not upload, log, or save reviewed text.
Adding a word to your dictionary is a separate, deliberate settings change.

## Local AI (optional)

Chrome and Edge builds include optional Local AI for Review. Firefox builds do not.
Standard Review works without it. See [Local AI availability and privacy](local-ai-review.md).

---

[Choose popup or inline suggestions](typing.md) · [Site settings](site-settings.md) · [Technical Review reference](review-reference.md)
