import { createWorkspaceCard, createWorkspaceShell } from "./workspacePanelUtils.js";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";
import { setSafeHtmlContent } from "@ui/settings-engine/dom/safeHtml.js";

const EXTENSION_VERSION =
  typeof chrome !== "undefined" && typeof chrome.runtime?.getManifest === "function"
    ? chrome.runtime.getManifest().version
    : "dev";

function createActionLink(
  href: string,
  label: string,
  description: string,
  iconText: string,
): HTMLElement {
  const anchor = document.createElement("a");
  anchor.className = "support-action-link";
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";

  const icon = document.createElement("span");
  icon.className = "support-action-icon";
  icon.textContent = iconText;

  const copy = document.createElement("span");
  copy.className = "support-action-copy";

  const title = document.createElement("span");
  title.className = "support-action-title";
  title.textContent = label;

  const body = document.createElement("span");
  body.className = "support-action-description";
  body.textContent = description;

  copy.append(title, body);
  anchor.append(icon, copy);
  return anchor;
}

function appendSupportActions(container: HTMLElement): void {
  [
    [
      "https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml",
      i18n.get("popup_report_issue"),
      i18n.get("support_report_bug_desc"),
      "!",
    ],
    [
      "https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml",
      i18n.get("support_request_feature_label"),
      i18n.get("support_request_feature_desc"),
      "+",
    ],
    [
      "https://github.com/bartekplus/FluentTyper#readme",
      i18n.get("support_read_docs_label"),
      i18n.get("support_read_docs_desc"),
      "DOC",
    ],
    [
      "https://github.com/bartekplus/FluentTyper/blob/main/SECURITY.md",
      i18n.get("support_security_policy_label"),
      i18n.get("support_security_policy_desc"),
      "SEC",
    ],
  ].forEach(([href, label, description, iconText]) => {
    container.appendChild(createActionLink(href, label, description, iconText));
  });
}

export class AboutWorkspacePanel {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.render();
  }

  render(): void {
    const shell = createWorkspaceShell();

    const productCard = createWorkspaceCard(i18n.get("about_fluent_typer_group"));
    const productCopy = document.createElement("p");
    productCopy.className = "settings-inline-help";
    setSafeHtmlContent(productCopy, i18n.get("x-FluentTyper"));
    const version = document.createElement("span");
    version.className = "version-chip";
    version.textContent = formatTranslation("options_version_chip", {
      version: EXTENSION_VERSION,
    });
    const highlightRow = document.createElement("div");
    highlightRow.className = "about-highlights";
    [
      "about_highlight_autocomplete",
      "about_highlight_text_expander",
      "about_highlight_multilingual",
      "about_highlight_site_profiles",
    ].forEach((key) => {
      const pill = document.createElement("span");
      pill.className = "about-pill";
      pill.textContent = i18n.get(key);
      highlightRow.appendChild(pill);
    });
    productCard.body.append(productCopy, version, highlightRow);

    const supportCard = createWorkspaceCard(i18n.get("support_development_group"));
    appendSupportActions(supportCard.body);

    const donateCard = createWorkspaceCard(
      i18n.get("support_donate_link"),
      i18n.get("support_donate_note"),
    );
    const donateLink = document.createElement("a");
    donateLink.className = "support-donate-link";
    donateLink.href = "https://www.buymeacoffee.com/FluentTyper";
    donateLink.target = "_blank";
    donateLink.rel = "noopener noreferrer";
    donateLink.textContent = i18n.get("support_donate_link");
    donateCard.body.append(donateLink);

    const secondaryGrid = createWorkspaceShell("workspace-card-grid");
    secondaryGrid.append(supportCard.card, donateCard.card);

    shell.append(productCard.card, secondaryGrid);
    this.root.replaceChildren(shell);
  }
}
