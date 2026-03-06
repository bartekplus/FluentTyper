/* global document, window, console */
document.addEventListener("DOMContentLoaded", async () => {
  const browserAPI = window.browser || window.chrome;
  const permissionsBtn = document.getElementById("grant-permissions-btn");
  const permissionsContainer = document.getElementById("permissions-container");
  const permissionsSuccess = document.getElementById("permissions-success");
  const practiceTextarea = document.getElementById("try-me-textarea");

  if (!permissionsBtn || !permissionsContainer || !permissionsSuccess) {
    return;
  }

  const setPermissionState = (granted) => {
    permissionsContainer.hidden = granted;
    permissionsSuccess.hidden = !granted;

    if (granted && practiceTextarea instanceof HTMLTextAreaElement) {
      practiceTextarea.focus();
    }
  };

  if (!browserAPI || !browserAPI.permissions) {
    setPermissionState(false);
    return;
  }

  const checkPermissions = async () => {
    try {
      const contains = await browserAPI.permissions.contains({
        origins: ["<all_urls>"],
      });
      setPermissionState(Boolean(contains));
    } catch (error) {
      console.error("Error checking permissions:", error);
      setPermissionState(false);
    }
  };

  await checkPermissions();

  permissionsBtn.addEventListener("click", async () => {
    try {
      const requestOptions = { origins: ["<all_urls>"] };
      // Resolve hook at click-time so tests can set it after DOMContentLoaded.
      const testPermissionRequest =
        typeof window.__FT_TEST_PERMISSION_REQUEST__ === "function"
          ? window.__FT_TEST_PERMISSION_REQUEST__
          : null;
      const granted = testPermissionRequest
        ? await testPermissionRequest(requestOptions)
        : await browserAPI.permissions.request(requestOptions);

      if (granted) {
        setPermissionState(true);
      }
    } catch (error) {
      console.error("Error requesting permissions:", error);
    }
  });
});
