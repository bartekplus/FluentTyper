import { i18n } from "@ui/options/fluenttyperI18n";
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
    ? i18n.lang
    : "en";
  document.documentElement.lang = language === "pr" ? "pt" : language;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = i18n.get(element.getAttribute("data-i18n")!);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    // Rich copy is authored in the bundled catalog, never supplied by a website or user.
    element.innerHTML = i18n.get(element.getAttribute("data-i18n-html")!);
  });
  for (const attribute of ["aria-label", "placeholder", "value"]) {
    document.querySelectorAll(`[data-i18n-${attribute}]`).forEach((element) => {
      element.setAttribute(attribute, i18n.get(element.getAttribute(`data-i18n-${attribute}`)!));
    });
  }
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
          practiceTextarea.focus({ preventScroll: true });
        }
      },
    });

    await controller.initialize();
  })();
});
