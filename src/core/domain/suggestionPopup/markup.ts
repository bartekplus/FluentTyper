import type { SuggestionKeyHint } from "./keyHints";

/**
 * The suggestion popup's markup, shared by the popup on web pages and the
 * Appearance preview in the options page so the two cannot drift apart.
 * Every value is escaped; the result is safe to assign to innerHTML.
 */

export const SUGGESTION_POPUP_CLASS = {
  panel: "ft-suggestion-panel",
  container: "ft-suggestion-container",
  list: "ft-suggestion-list",
  footer: "ft-suggestion-footer",
} as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The number key that picks the suggestion at `index` ("0" for the tenth). */
export function formatShortcutDigit(index: number): string {
  return index === 9 ? "0" : String(index + 1);
}

/** `suggestion` with the typed text (`mentionText`) wrapped for highlighting. */
function highlightMatch(mentionText: string, suggestion: string): string {
  const mention = (mentionText || "").trim();
  const matchIndex = mention ? suggestion.toLowerCase().indexOf(mention.toLowerCase()) : -1;
  if (matchIndex < 0) {
    return escapeHtml(suggestion);
  }
  const before = escapeHtml(suggestion.slice(0, matchIndex));
  const match = escapeHtml(suggestion.slice(matchIndex, matchIndex + mention.length));
  const after = escapeHtml(suggestion.slice(matchIndex + mention.length));
  return `${before}<span class="ft-suggestion-match">${match}</span>${after}`;
}

/**
 * A row's content: [number] label [snippet shortcut]. A snippet shows its
 * expansion, and on the right the shortcut it expands with the typed text
 * highlighted, so fuzzy matches explain themselves.
 */
export function buildSuggestionRowHtml(args: {
  mentionText: string;
  suggestion: string;
  snippetShortcut: string | null;
  shortcutDigit: string | null;
}): string {
  const shortcut = args.shortcutDigit
    ? `<span class="ft-suggestion-shortcut" aria-hidden="true">${escapeHtml(args.shortcutDigit)}</span>`
    : "";
  const label = args.snippetShortcut
    ? escapeHtml(args.suggestion)
    : highlightMatch(args.mentionText, args.suggestion);
  const detail = args.snippetShortcut
    ? `<span class="ft-suggestion-detail">${highlightMatch(args.mentionText, args.snippetShortcut)}</span>`
    : "";
  return `${shortcut}<span class="ft-suggestion-label">${label}</span>${detail}`;
}

/** A grammar proposal row: "original → replacement", then why. */
export function buildProposalRowHtml(args: {
  original: string;
  replacement: string;
  explanation: string;
}): string {
  return `<span class="ft-suggestion-label">${escapeHtml(args.original)} → ${escapeHtml(
    args.replacement,
  )}</span><span class="ft-suggestion-detail">${escapeHtml(args.explanation)}</span>`;
}

/** The prediction language, as the popup's footer names it. */
export function suggestionLanguageLabel(languageName: string): string {
  return `Lang: ${languageName}`;
}

/** Id of the prediction language in the footer; the listbox is described by it. */
export const SUGGESTION_POPUP_LANGUAGE_ID = "ft-suggestion-lang";

/**
 * Key hints, and the prediction language at the end of the same line. The hints
 * only repeat keys, so assistive technology skips them; the language is read.
 */
export function buildSuggestionFooterHtml(
  hints: SuggestionKeyHint[],
  language: string | null,
): string {
  const items = hints.map(
    ({ keys, label }) =>
      `<span class="ft-suggestion-hint" aria-hidden="true"><kbd>${escapeHtml(keys)}</kbd> ${escapeHtml(label)}</span>`,
  );
  if (language) {
    items.push(
      `<span class="ft-suggestion-lang" id="${SUGGESTION_POPUP_LANGUAGE_ID}">${escapeHtml(language)}</span>`,
    );
  }
  return items.join("");
}

/** A whole, static popup panel: what the Appearance preview shows. */
export function buildSuggestionPanelHtml(args: {
  suggestions: string[];
  snippetShortcuts?: Array<string | null>;
  selectedIndex: number;
  showShortcutDigits: boolean;
  mentionText: string;
  hints: SuggestionKeyHint[];
  language: string | null;
}): string {
  const rows = args.suggestions.map((suggestion, index) => {
    const selected = index === args.selectedIndex;
    const classes = [
      args.showShortcutDigits ? "has-shortcut" : "",
      selected ? "highlight" : "",
    ].filter(Boolean);
    return `<li role="option" dir="auto" aria-selected="${selected}"${
      classes.length ? ` class="${classes.join(" ")}"` : ""
    }>${buildSuggestionRowHtml({
      mentionText: args.mentionText,
      suggestion,
      snippetShortcut: args.snippetShortcuts?.[index] ?? null,
      shortcutDigit: args.showShortcutDigits ? formatShortcutDigit(index) : null,
    })}</li>`;
  });
  const footer = buildSuggestionFooterHtml(args.hints, args.language);
  const describedBy = args.language ? ` aria-describedby="${SUGGESTION_POPUP_LANGUAGE_ID}"` : "";
  return `<div class="${SUGGESTION_POPUP_CLASS.panel} ${SUGGESTION_POPUP_CLASS.container}" part="panel" role="listbox"${describedBy}><ul class="${SUGGESTION_POPUP_CLASS.list}" part="list">${rows.join(
    "",
  )}</ul><div class="${SUGGESTION_POPUP_CLASS.footer}" part="footer"${
    footer ? "" : " hidden"
  }>${footer}</div></div>`;
}
