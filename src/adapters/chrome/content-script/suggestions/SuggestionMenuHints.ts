/** Words for the popup's key-hint footer: navigate, accept, pick, dismiss. */
type HintLabels = readonly [string, string, string, string];

// The options page's UI languages ("pr" is Portuguese, "pt" in navigator.language).
const LABELS: Record<string, HintLabels> = {
  en: ["navigate", "accept", "pick", "dismiss"],
  fr: ["naviguer", "accepter", "choisir", "fermer"],
  hr: ["kretanje", "prihvati", "odaberi", "zatvori"],
  es: ["navegar", "aceptar", "elegir", "cerrar"],
  el: ["πλοήγηση", "αποδοχή", "επιλογή", "κλείσιμο"],
  sv: ["navigera", "acceptera", "välj", "stäng"],
  de: ["navigieren", "übernehmen", "wählen", "schließen"],
  pl: ["nawigacja", "akceptuj", "wybierz", "zamknij"],
  pt: ["navegar", "aceitar", "escolher", "fechar"],
};

/** Key caps for the enabled "accept with" settings. */
export function acceptKeyLabels(options: {
  autocompleteOnTab: boolean;
  autocompleteOnEnter: boolean;
  autocomplete: boolean;
}): string[] {
  const keys: string[] = [];
  if (options.autocompleteOnTab) keys.push("Tab");
  if (options.autocompleteOnEnter) keys.push("⏎");
  if (options.autocomplete) keys.push("Space");
  return keys;
}

export interface SuggestionKeyHint {
  keys: string;
  label: string;
}

/**
 * The keys that work on the open menu, as the user has configured them.
 * `acceptKeys` are the keys that insert the selected suggestion.
 */
export function buildSuggestionKeyHints(args: {
  acceptKeys: string[];
  digitCount: number;
  language?: string;
}): SuggestionKeyHint[] {
  const lang = (args.language ?? navigator.language ?? "en").split(/[-_]/)[0].toLowerCase();
  const [navigate, accept, pick, dismiss] = LABELS[lang] ?? LABELS.en;
  const hints: SuggestionKeyHint[] = [{ keys: "↑↓", label: navigate }];
  if (args.acceptKeys.length > 0) {
    hints.push({ keys: args.acceptKeys.join(" "), label: accept });
  }
  if (args.digitCount > 0) {
    hints.push({ keys: args.digitCount === 1 ? "1" : `1–${args.digitCount}`, label: pick });
  }
  hints.push({ keys: "Esc", label: dismiss });
  return hints;
}
