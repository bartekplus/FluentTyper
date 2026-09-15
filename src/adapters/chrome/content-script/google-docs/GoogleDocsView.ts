import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { SuggestionMenuView } from "../suggestions/SuggestionMenuView";
import { SuggestionMenuPresenter } from "../suggestions/SuggestionMenuPresenter";
import { SuggestionPositioningService } from "../suggestions/SuggestionPositioningService";
import { InlineSuggestionView } from "../suggestions/InlineSuggestionView";
import {
  DOCS_SESSION_ID,
  snapshotContext,
  type DocsSnapshot,
  type DocsStatus,
} from "./GoogleDocsModel";
import { getDocsCaret } from "./GoogleDocsEnvironment";

// Content runtime has no dependency on the options page's i18n engine.
const LABELS: Record<string, readonly [string, string, string, string]> = {
  en: [
    "FluentTyper suggestions",
    "Suggestion",
    "Google Docs integration is unavailable.",
    "The edit could not be verified. Check the document before reloading. It will not be retried.",
  ],
  pl: [
    "Podpowiedzi FluentTyper",
    "Podpowiedź",
    "Integracja z Dokumentami Google jest niedostępna.",
    "Nie można potwierdzić zmiany. Sprawdź dokument przed odświeżeniem. Zmiana nie zostanie ponowiona.",
  ],
  de: [
    "FluentTyper-Vorschläge",
    "Vorschlag",
    "Die Google-Docs-Integration ist nicht verfügbar.",
    "Die Änderung konnte nicht bestätigt werden. Prüfen Sie das Dokument vor dem Neuladen. Sie wird nicht wiederholt.",
  ],
  fr: [
    "Suggestions FluentTyper",
    "Suggestion",
    "L’intégration Google Docs est indisponible.",
    "La modification n’a pas pu être vérifiée. Vérifiez le document avant de recharger. Elle ne sera pas répétée.",
  ],
  es: [
    "Sugerencias de FluentTyper",
    "Sugerencia",
    "La integración con Google Docs no está disponible.",
    "No se pudo verificar el cambio. Revise el documento antes de recargar. No se repetirá.",
  ],
  pt: [
    "Sugestões do FluentTyper",
    "Sugestão",
    "A integração com o Google Docs está indisponível.",
    "Não foi possível verificar a alteração. Confira o documento antes de recarregar. Ela não será repetida.",
  ],
  hr: [
    "Prijedlozi FluentTypera",
    "Prijedlog",
    "Integracija s Google dokumentima nije dostupna.",
    "Izmjena nije potvrđena. Provjerite dokument prije ponovnog učitavanja. Izmjena se neće ponoviti.",
  ],
  el: [
    "Προτάσεις FluentTyper",
    "Πρόταση",
    "Η ενσωμάτωση στα Έγγραφα Google δεν είναι διαθέσιμη.",
    "Η αλλαγή δεν επαληθεύτηκε. Ελέγξτε το έγγραφο πριν από την επαναφόρτωση. Δεν θα επαναληφθεί.",
  ],
  sv: [
    "FluentTyper-förslag",
    "Förslag",
    "Integrationen med Google Dokument är inte tillgänglig.",
    "Ändringen kunde inte verifieras. Kontrollera dokumentet innan du laddar om. Ändringen upprepas inte.",
  ],
};
class DocsPositioning extends SuggestionPositioningService {
  override getCaretRect(): DOMRect | null {
    return getDocsCaret()?.rect ?? new DOMRect(16, Math.max(16, window.innerHeight - 80), 0, 20);
  }
}
export interface DocsView {
  render(suggestions: string[], index: number, snapshot: DocsSnapshot, language: string): boolean;
  clear(): void;
  status(status: DocsStatus): void;
  dispose(): void;
}
export class GoogleDocsView implements DocsView {
  private readonly elements = SuggestionMenuView.ensureMenu();
  private readonly presenter = new SuggestionMenuPresenter(new DocsPositioning());
  private readonly live = document.createElement("div");
  private readonly font = document.createElement("div");
  private readonly labels = LABELS[(navigator.language || "en").split(/[-_]/)[0]] ?? LABELS.en;
  private target: HTMLElement | null = null;
  constructor(
    private readonly options: {
      inline: boolean;
      digits: boolean;
      langHeader: boolean;
      findToken: (text: string) => { token: string };
      accept: (index: number) => void;
    },
  ) {
    this.elements.menu.id = SuggestionMenuView.resolveHostId(DOCS_SESSION_ID);
    this.live.setAttribute("role", "status");
    this.live.setAttribute("aria-live", "polite");
    this.live.setAttribute("aria-atomic", "true");
    this.live.setAttribute("data-ft-suggestion-owned", "true");
    this.live.style.cssText =
      "position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none";
    document.body.appendChild(this.live);
    this.font.setAttribute("data-ft-suggestion-owned", "true");
    this.font.setAttribute("aria-hidden", "true");
    this.font.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden";
    document.body.appendChild(this.font);
    // Preserve Docs focus. Shadow DOM composedPath is required for option hit-testing.
    this.elements.list.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const item = (event.target as Element).closest<HTMLElement>("li[data-index]");
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      options.accept(Number(item.dataset.index));
    });
    this.elements.list.addEventListener("mousedown", (event) => event.preventDefault());
  }
  render(suggestions: string[], index: number, snapshot: DocsSnapshot, language: string): boolean {
    this.clear(true);
    const measuredCaret = getDocsCaret();
    if (!suggestions.length) return false;
    // Ambiguous collaborator/bidi geometry uses a fixed palette instead of guessing a caret.
    const caret = measuredCaret ?? {
      element: document.body,
      rect: new DOMRect(16, Math.max(16, window.innerHeight - 80), 0, 20),
    };
    this.target = caret.element;
    const context = snapshotContext(snapshot);
    const token = this.options.findToken(context.beforeCursor).token;
    const candidate = suggestions[index];
    // Canvas cannot be DOM-mirrored. Never cover existing text with a guessed replacement.
    // Inline is used for actual suffix insertion; other edits retain the same menu/acceptance.
    const canGhost =
      measuredCaret !== null &&
      this.options.inline &&
      snapshot.anchor === snapshot.focus &&
      candidate.startsWith(token) &&
      candidate.length > token.length &&
      !/[^\n\r]/.test(context.afterCursor.split("\n")[0]) &&
      !candidate.includes("\n") &&
      getComputedStyle(caret.element).direction !== "rtl";
    let visible = false;
    if (canGhost) {
      this.syncFont(caret.rect);
      const ghost = InlineSuggestionView.render({
        target: this.font,
        text: candidate.slice(token.length),
        caretRect: caret.rect,
        entryId: DOCS_SESSION_ID,
      });
      if (ghost) {
        ghost.setAttribute("aria-hidden", "true");
        // The anchor is a thin caret, not the text area's right edge. The generic
        // presenter otherwise clamps this canvas ghost to the caret's 1px width.
        ghost.style.maxWidth = `${Math.max(0, window.innerWidth - caret.rect.left - 8)}px`;
        ghost.style.whiteSpace = "pre";
        ghost.style.overflow = "hidden";
        ghost.style.textOverflow = "ellipsis";
        visible = true;
      }
    }
    if (!visible)
      visible = this.presenter.render({
        menuId: DOCS_SESSION_ID,
        ...this.elements,
        target: caret.element,
        suggestions,
        selectedIndex: index,
        showShortcutDigits: this.options.digits,
        menuHeader: this.options.langHeader ? (SUPPORTED_LANGUAGES[language] ?? language) : null,
        mentionText: context.selectedText || token,
      });
    const panel = SuggestionMenuView.resolvePanel(this.elements.menu);
    panel.setAttribute("aria-label", this.labels[0]);
    panel.setAttribute("dir", "auto");
    const announcement = `${this.labels[1]} ${index + 1}/${suggestions.length}: ${candidate}`;
    if (this.live.textContent !== announcement) this.live.textContent = announcement;
    this.elements.list.querySelectorAll("li").forEach((item) => item.setAttribute("dir", "auto"));
    return visible;
  }
  /** Canvas text has no DOM style; mirror the toolbar's font, size and zoom onto a style host. */
  private syncFont(caretRect: DOMRect): void {
    const family = document
      .querySelector("#docs-font-family .goog-toolbar-menu-button-caption")
      ?.textContent?.trim();
    const points = parseFloat(
      document.querySelector<HTMLInputElement>("#fontSizeSelect input")?.value ?? "",
    );
    const zoom = parseFloat(
      document.querySelector<HTMLInputElement>("#zoomSelect input")?.value ?? "",
    );
    const px =
      points > 0 ? (points * 96 * (zoom > 0 ? zoom / 100 : 1)) / 72 : caretRect.height / 1.15;
    this.font.style.fontFamily = family ? `${family}, Arial, sans-serif` : "Arial, sans-serif";
    this.font.style.fontSize = `${px}px`;
    this.font.style.lineHeight = caretRect.height > 0 ? `${caretRect.height}px` : "normal";
    this.font.style.color = "rgb(0, 0, 0)";
  }
  clear(keepAnnouncement = false): void {
    this.presenter.hide(this.elements.menu, this.elements.list, this.target ?? undefined);
    InlineSuggestionView.removeForEntry(DOCS_SESSION_ID);
    if (!keepAnnouncement) this.live.textContent = "";
    this.live.style.cssText =
      "position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none";
  }
  status(status: DocsStatus): void {
    if (status !== "unverified" && status !== "unavailable") return;
    this.live.textContent = status === "unverified" ? this.labels[3] : this.labels[2];
    // Visible diagnostic without modifying Google's editable DOM or moving focus.
    this.live.style.cssText =
      "position:fixed;bottom:12px;right:12px;max-width:360px;padding:12px;z-index:2147483647;background:Canvas;color:CanvasText;border:1px solid GrayText;font:14px/1.4 system-ui;pointer-events:none";
  }
  dispose(): void {
    this.clear();
    this.elements.menu.remove();
    this.live.remove();
    this.font.remove();
  }
}
