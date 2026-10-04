import { htmlLang, i18n } from "@ui/options/fluenttyperI18n";
import { localizeDocument } from "@ui/shared/localizeDocument";
import { onboardingTranslations } from "./translations";
import {
  WebsiteAccessPermissionController,
  WebsiteAccessPermissionService,
} from "@ui/shared/websiteAccessPermission";

i18n.extend(onboardingTranslations);

export function translateOnboarding(): void {
  // The shared catalog uses "pr" for Portuguese; HTML language tags use "pt".
  if (i18n.lang === "pt") i18n.lang = "pr";
  const language = Object.hasOwn(onboardingTranslations.onboarding_title, i18n.lang)
    ? (i18n.lang as keyof typeof onboardingTranslations.onboarding_title)
    : "en";
  document.documentElement.lang = htmlLang(language);

  localizeDocument(["aria-label", "placeholder", "value"]);
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    const key = element.getAttribute("data-i18n-html")!;
    // i18n.get returns unknown keys verbatim; only bundled copy may be parsed as HTML.
    if (Object.hasOwn(onboardingTranslations, key)) {
      element.innerHTML =
        onboardingTranslations[key as keyof typeof onboardingTranslations][language];
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  translateOnboarding();
  const testWindow = window as Window & {
    __FT_TEST_PERMISSION_CONTAINS__?: (
      options: chrome.permissions.Permissions,
    ) => Promise<boolean> | boolean;
    __FT_TEST_PERMISSION_REQUEST__?: (
      options: chrome.permissions.Permissions,
    ) => Promise<boolean> | boolean;
  };
  const practiceTextarea = document.getElementById("try-me-textarea") as HTMLTextAreaElement;
  const controller = new WebsiteAccessPermissionController({
    elements: {
      root: document.getElementById("permissions-container") as HTMLElement,
      badge: document.getElementById("permissions-badge") as HTMLElement,
      title: document.getElementById("permissions-title") as HTMLElement,
      body: document.getElementById("permissions-copy") as HTMLElement,
      action: document.getElementById("grant-permissions-btn") as HTMLButtonElement,
    },
    service: new WebsiteAccessPermissionService(window.browser || window.chrome, {
      contains: (options) => testWindow.__FT_TEST_PERMISSION_CONTAINS__?.(options),
      request: (options) => testWindow.__FT_TEST_PERMISSION_REQUEST__?.(options),
    }),
    onGranted: () => practiceTextarea.focus(),
  });
  void controller.initialize();
});
