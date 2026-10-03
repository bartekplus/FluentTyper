import { i18n } from "@ui/options/fluenttyperI18n";
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
  document.documentElement.lang = language === "pr" ? "pt" : language;

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
  void (async () => {
    const browserAPI = window.browser || window.chrome;
    const testWindow = window as Window & {
      __FT_TEST_PERMISSION_CONTAINS__?: (
        options: chrome.permissions.Permissions,
      ) => Promise<boolean> | boolean;
      __FT_TEST_PERMISSION_REQUEST__?: (
        options: chrome.permissions.Permissions,
      ) => Promise<boolean> | boolean;
    };
    const root = document.getElementById("permissions-container");
    const badge = document.getElementById("permissions-badge");
    const title = document.getElementById("permissions-title");
    const body = document.getElementById("permissions-copy");
    const action = document.getElementById("grant-permissions-btn");
    const practiceTextarea = document.getElementById("try-me-textarea");

    if (
      !(root instanceof HTMLElement) ||
      !(badge instanceof HTMLElement) ||
      !(title instanceof HTMLElement) ||
      !(body instanceof HTMLElement) ||
      !(action instanceof HTMLButtonElement)
    ) {
      return;
    }

    const controller = new WebsiteAccessPermissionController({
      elements: {
        root,
        badge,
        title,
        body,
        action,
      },
      service: new WebsiteAccessPermissionService(browserAPI, {
        contains: (options) => testWindow.__FT_TEST_PERMISSION_CONTAINS__?.(options),
        request: (options) => testWindow.__FT_TEST_PERMISSION_REQUEST__?.(options),
      }),
      onGranted: () => {
        if (practiceTextarea instanceof HTMLTextAreaElement) {
          practiceTextarea.focus();
        }
      },
    });

    await controller.initialize();
  })();
});
