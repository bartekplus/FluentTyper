import { formatTranslation, i18n } from "./fluenttyperI18n.js";

const EXTENSION_VERSION =
  typeof chrome !== "undefined" && typeof chrome.runtime?.getManifest === "function"
    ? chrome.runtime.getManifest().version
    : "dev";

function createLink(href: string, label: string, description: string): HTMLElement {
  const row = document.createElement("p");
  row.className = "settings-inline-help";

  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = label;
  row.appendChild(anchor);
  row.append(` - ${description}`);
  return row;
}

export class AboutWorkspacePanel {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.render();
  }

  render(): void {
    const shell = document.createElement("div");
    shell.className = "workspace-panel-stack";

    const productCard = document.createElement("section");
    productCard.className = "settings-inline-card workspace-overview-card";
    const productTitle = document.createElement("h4");
    productTitle.textContent = i18n.get("about_fluent_typer_group");
    const productCopy = document.createElement("p");
    productCopy.className = "settings-inline-help";
    productCopy.textContent = i18n.get("x-FluentTyper");
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
    productCard.append(productTitle, productCopy, version, highlightRow);

    const supportCard = document.createElement("section");
    supportCard.className = "settings-inline-card workspace-overview-card";
    const supportTitle = document.createElement("h4");
    supportTitle.textContent = i18n.get("support_development_group");
    supportCard.appendChild(supportTitle);
    supportCard.appendChild(
      createLink(
        "https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml",
        i18n.get("popup_report_issue"),
        i18n.get("support_report_bug_desc"),
      ),
    );
    supportCard.appendChild(
      createLink(
        "https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml",
        i18n.get("support_request_feature_label"),
        i18n.get("support_request_feature_desc"),
      ),
    );
    supportCard.appendChild(
      createLink(
        "https://github.com/bartekplus/FluentTyper#readme",
        i18n.get("support_read_docs_label"),
        i18n.get("support_read_docs_desc"),
      ),
    );
    supportCard.appendChild(
      createLink(
        "https://github.com/bartekplus/FluentTyper/blob/main/SECURITY.md",
        i18n.get("support_security_policy_label"),
        i18n.get("support_security_policy_desc"),
      ),
    );

    const donateCard = document.createElement("section");
    donateCard.className = "settings-inline-card workspace-overview-card";
    const donateTitle = document.createElement("h4");
    donateTitle.textContent = i18n.get("support_donate_link");
    const donateCopy = document.createElement("p");
    donateCopy.className = "settings-inline-help";
    donateCopy.textContent = i18n.get("support_donate_note");
    const donateLink = document.createElement("a");
    donateLink.className = "support-donate-link";
    donateLink.href = "https://www.buymeacoffee.com/FluentTyper";
    donateLink.target = "_blank";
    donateLink.rel = "noopener noreferrer";
    donateLink.textContent = i18n.get("support_donate_link");
    donateCard.append(donateTitle, donateCopy, donateLink);

    const secondaryGrid = document.createElement("div");
    secondaryGrid.className = "workspace-card-grid";
    secondaryGrid.append(supportCard, donateCard);

    shell.append(productCard, secondaryGrid);
    this.root.replaceChildren(shell);
  }
}
