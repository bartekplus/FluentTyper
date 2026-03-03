/* global document, window, console */
document.addEventListener("DOMContentLoaded", async () => {
  const browserAPI = window.browser || window.chrome;
  if (!browserAPI || !browserAPI.permissions) {
    return;
  }

  const permissionsBtn = document.getElementById("grant-permissions-btn");
  const permissionsContainer = document.getElementById("permissions-container");
  const permissionsSuccess = document.getElementById("permissions-success");
  if (!permissionsBtn || !permissionsContainer || !permissionsSuccess) {
    return;
  }

  const checkPermissions = async () => {
    try {
      const contains = await browserAPI.permissions.contains({
        origins: ["<all_urls>"],
      });
      if (contains) {
        permissionsContainer.style.display = "none";
        permissionsSuccess.style.display = "block";
      } else {
        permissionsContainer.style.display = "block";
        permissionsSuccess.style.display = "none";
      }
    } catch (e) {
      console.error("Error checking permissions:", e);
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
        permissionsContainer.style.display = "none";
        permissionsSuccess.style.display = "block";
      }
    } catch (e) {
      console.error("Error requesting permissions:", e);
    }
  });
});
