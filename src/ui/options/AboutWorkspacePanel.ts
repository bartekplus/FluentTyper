import { createElement } from "@ui/settings-engine/dom/createElement.js";
import { createExternalLink, createWorkspaceCard } from "./workspacePanelUtils.js";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";
import { setSafeHtmlContent } from "@ui/settings-engine/dom/safeHtml.js";

const EXTENSION_VERSION =
  typeof chrome !== "undefined" && typeof chrome.runtime?.getManifest === "function"
    ? chrome.runtime.getManifest().version
    : "dev";

function createActionLink(href: string, label: string, description: string): HTMLElement {
  const anchor = createExternalLink(href, "support-action-link");

  const copy = createElement("span", { className: "support-action-copy" });

  const title = createElement("span", { className: "support-action-title", textContent: label });

  const body = createElement("span", {
    className: "support-action-description",
    textContent: description,
  });

  copy.append(title, body);
  anchor.append(copy);
  return anchor;
}

export function renderAboutWorkspacePanel(root: HTMLElement): void {
  const { card, body } = createWorkspaceCard(i18n.get("about_fluent_typer_group"));
  const productCopy = createElement("p", { className: "settings-inline-help" });
  setSafeHtmlContent(productCopy, i18n.get("x-FluentTyper"));
  const version = createElement("p", {
    className: "settings-inline-help",
    textContent: formatTranslation("options_version_chip", { version: EXTENSION_VERSION }),
  });

  const links = createElement("div", { className: "support-action-list" });
  links.append(
    ...[
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
    ].map(([href, label, description]) => createActionLink(href, label, description)),
  );

  body.append(productCopy, version, links);
  root.replaceChildren(card);
}

export function renderSupportWorkspacePanel(root: HTMLElement): void {
  const support = createWorkspaceCard(i18n.get("support_title"));
  support.card.classList.add("support-card");
  const donateNote = createElement("p", {
    className: "settings-inline-help",
    textContent: i18n.get("support_donate_note"),
  });
  const donateLink = createExternalLink(
    "https://www.buymeacoffee.com/FluentTyper",
    "button is-primary",
    i18n.get("support_cta"),
  );
  const donate = createElement("div", { className: "support-donate" });
  const paymentNote = createElement("p", {
    className: "settings-inline-help",
    textContent: i18n.get("support_payment_note"),
  });
  donate.append(donateLink, paymentNote);
  support.body.append(donateNote, donate);

  root.replaceChildren(support.card);
}
