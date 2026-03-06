import {
  WebsiteAccessPermissionController,
  WebsiteAccessPermissionService,
} from "@ui/shared/websiteAccessPermission";

document.addEventListener("DOMContentLoaded", async () => {
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
});
