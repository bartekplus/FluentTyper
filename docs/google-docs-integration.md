# Write in Google Docs

[FluentTyper](../README.md) / Google Docs

FluentTyper includes Google Docs integration for word suggestions and Review. Available actions depend on the browser and the document.

**Browser coverage:** The project records live Chrome checks for basic suggestions and acceptance. It does not establish complete live coverage for Edge or Firefox.
The [engineering record](google-docs-reference.md) gives the dated test evidence and the remaining limits.
Google Docs can change independently of FluentTyper. If an action is unavailable, use the document's own editing controls.

## Start writing

1. Install FluentTyper from the browser links in the [README](../README.md).
2. Open a Google document that you can edit.
3. Enable FluentTyper for `docs.google.com` in the extension popup.
4. Reload the document.
5. Place the cursor in the document body.
6. Start typing.

Use **Tab** to accept a selected suggestion when that shortcut is enabled.
You can use the document's **Undo** command after an accepted change.

Site access and FluentTyper's global enable switch must both permit it to run. See [site settings](site-settings.md).

## Check a draft

Place the cursor in the document. Select **Review text** in the extension popup, or press **Alt+Shift+R**.
Google Docs does not use the Review button shown beside ordinary text boxes.

Select an issue in the panel to inspect its correction. Apply corrections individually. **Fix all safe** is not available in Google Docs.

Review checks the whole document up to 50,000 characters.
For longer documents, it checks up to 50,000 characters around the cursor and shows the scope in the panel.

Highlights appear where Google Docs shows the corresponding text. Findings elsewhere can appear only in the panel.
Scroll to the text to inspect it. Headers, tables, or repeated text can also have findings without an inline highlight.

## If a suggestion does not apply

1. Check whether the document allows editing.
2. Check FluentTyper's [site settings](site-settings.md).
3. Reload the document after enabling FluentTyper.
4. Place the cursor in the document body again.

If another writing extension also shows suggestions, test with only one enabled.
If the issue continues, [report the browser, extension version, and failing action](https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml).
Use a short example that contains no private document content.

FluentTyper checks the resulting text after an edit. If it cannot verify a change, it does not automatically repeat the insertion.
Check your document before trying again.

---

[Review text](review-mode.md) · [Site settings](site-settings.md) · [Google Docs engineering reference](google-docs-reference.md)
