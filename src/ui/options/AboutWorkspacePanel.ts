import { createWorkspaceCard } from "./workspacePanelUtils.js";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";
import { setSafeHtmlContent } from "@ui/settings-engine/dom/safeHtml.js";

const EXTENSION_VERSION =
  typeof chrome !== "undefined" && typeof chrome.runtime?.getManifest === "function"
    ? chrome.runtime.getManifest().version
    : "dev";

function createActionLink(href: string, label: string, description: string): HTMLElement {
  const anchor = document.createElement("a");
  anchor.className = "support-action-link";
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";

  const copy = document.createElement("span");
  copy.className = "support-action-copy";

  const title = document.createElement("span");
  title.className = "support-action-title";
  title.textContent = label;

  const body = document.createElement("span");
  body.className = "support-action-description";
  body.textContent = description;

  copy.append(title, body);
  anchor.append(copy);
  return anchor;
}

function appendSupportActions(container: HTMLElement): void {
  [
    [
      "https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml",
      i18n.get("popup_report_issue"),
      i18n.get("support_report_bug_desc"),
    ],
    [
      "https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml",
      i18n.get("support_request_feature_label"),
      i18n.get("support_request_feature_desc"),
    ],
    [
      "https://github.com/bartekplus/FluentTyper#readme",
      i18n.get("support_read_docs_label"),
      i18n.get("support_read_docs_desc"),
    ],
    [
      "https://github.com/bartekplus/FluentTyper/blob/main/SECURITY.md",
      i18n.get("support_security_policy_label"),
      i18n.get("support_security_policy_desc"),
    ],
  ].forEach(([href, label, description]) => {
    container.appendChild(createActionLink(href, label, description));
  });
}

export function renderAboutWorkspacePanel(root: HTMLElement): void {
  const { card, body } = createWorkspaceCard(i18n.get("about_fluent_typer_group"));
  const productCopy = document.createElement("p");
  productCopy.className = "settings-inline-help";
  setSafeHtmlContent(productCopy, i18n.get("x-FluentTyper"));
  const version = document.createElement("p");
  version.className = "settings-inline-help";
  version.textContent = formatTranslation("options_version_chip", {
    version: EXTENSION_VERSION,
  });

  const links = document.createElement("div");
  links.className = "support-action-list";
  appendSupportActions(links);

  body.append(productCopy, version, links);
  root.replaceChildren(card);
}

export function renderSupportWorkspacePanel(root: HTMLElement): void {
  const support = createWorkspaceCard(i18n.get("support_title"));
  support.card.classList.add("support-card");
  const donateNote = document.createElement("p");
  donateNote.className = "settings-inline-help";
  donateNote.textContent = i18n.get("support_donate_note");
  const donateLink = document.createElement("a");
  donateLink.className = "button is-primary";
  donateLink.href = "https://www.buymeacoffee.com/FluentTyper";
  donateLink.target = "_blank";
  donateLink.rel = "noopener noreferrer";
  donateLink.textContent = i18n.get("support_cta");
  const donate = document.createElement("div");
  donate.className = "support-donate";
  const paymentNote = document.createElement("p");
  paymentNote.className = "settings-inline-help";
  paymentNote.textContent = i18n.get("support_payment_note");
  donate.append(donateLink, paymentNote);
  support.body.append(donateNote, donate);

  root.replaceChildren(support.card);
}
