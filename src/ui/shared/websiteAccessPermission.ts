import { i18n } from "@third-party/fancier-settings/i18n.js";

export type WebsiteAccessPermissionState = "missing" | "granted" | "unavailable";

export const WEBSITE_ACCESS_PERMISSION: chrome.permissions.Permissions = {
  origins: ["<all_urls>"],
};

type PermissionCopy = {
  actionLabel?: string;
  badge: string;
  body: string;
  title: string;
};

export type WebsiteAccessPermissionCopy = Record<WebsiteAccessPermissionState, PermissionCopy>;

export interface WebsiteAccessPermissionElements {
  action: HTMLButtonElement | null;
  badge: HTMLElement;
  body: HTMLElement;
  root: HTMLElement;
  title: HTMLElement;
}

type PermissionFunction = (
  options: chrome.permissions.Permissions,
) => Promise<boolean | undefined> | boolean | undefined;

export interface WebsiteAccessPermissionApi {
  permissions?: {
    contains?: PermissionFunction;
    request?: PermissionFunction;
  };
}

export interface WebsiteAccessPermissionTestHooks {
  contains?: PermissionFunction;
  request?: PermissionFunction;
}

interface WebsiteAccessPermissionControllerOptions {
  elements: WebsiteAccessPermissionElements;
  onGranted?: () => void;
  service: WebsiteAccessPermissionService;
}

function translate(key: string, fallback: string): string {
  const translated = i18n.get(key);
  return typeof translated === "string" && translated.length > 0 && translated !== key
    ? translated
    : fallback;
}

export function getWebsiteAccessPermissionCopy(): WebsiteAccessPermissionCopy {
  return {
    missing: {
      badge: translate("permission_status_missing_badge", "Website access required"),
      title: translate("permission_status_missing_title", "Allow page access"),
      body: translate(
        "permission_status_missing_body",
        "FluentTyper needs website access to show suggestions in text fields, and everything stays local in your browser.",
      ),
      actionLabel: translate("permission_status_action", "Allow page access"),
    },
    granted: {
      badge: translate("permission_status_granted_badge", "Website access ready"),
      title: translate("permission_status_granted_title", "Access granted"),
      body: translate(
        "permission_status_granted_body",
        "FluentTyper can now show suggestions in text fields, and everything still stays local in your browser.",
      ),
    },
    unavailable: {
      badge: translate("permission_status_unavailable_badge", "Website access unavailable"),
      title: translate("permission_status_unavailable_title", "Check browser access"),
      body: translate(
        "permission_status_unavailable_body",
        "FluentTyper could not verify website access right now. Reopen this panel or reload the page, then try again. Your typing still stays local in your browser.",
      ),
    },
  };
}

export class WebsiteAccessPermissionService {
  constructor(
    private readonly api: WebsiteAccessPermissionApi | undefined,
    private readonly hooks: WebsiteAccessPermissionTestHooks = {},
    private readonly requestOptions: chrome.permissions.Permissions = WEBSITE_ACCESS_PERMISSION,
  ) {}

  async getState(): Promise<WebsiteAccessPermissionState> {
    if (!this.hasCheckHandler()) {
      return "unavailable";
    }

    try {
      const granted = await this.runCheck();
      if (typeof granted !== "boolean") {
        return "unavailable";
      }
      return granted ? "granted" : "missing";
    } catch {
      return "unavailable";
    }
  }

  async requestAccess(): Promise<WebsiteAccessPermissionState> {
    if (!this.hasRequestHandler()) {
      return "unavailable";
    }

    try {
      const granted = await this.runRequest();
      if (typeof granted !== "boolean") {
        return "unavailable";
      }
      return granted ? "granted" : "missing";
    } catch {
      return "unavailable";
    }
  }

  private hasCheckHandler(): boolean {
    return (
      typeof this.hooks.contains === "function" ||
      typeof this.api?.permissions?.contains === "function"
    );
  }

  private hasRequestHandler(): boolean {
    return (
      typeof this.hooks.request === "function" ||
      typeof this.api?.permissions?.request === "function"
    );
  }

  private async runCheck(): Promise<boolean | undefined> {
    if (typeof this.hooks.contains === "function") {
      const hookedResult = await this.hooks.contains(this.requestOptions);
      if (typeof hookedResult === "boolean") {
        return hookedResult;
      }
    }
    if (typeof this.api?.permissions?.contains === "function") {
      return Boolean(await this.api.permissions.contains(this.requestOptions));
    }
    return undefined;
  }

  private async runRequest(): Promise<boolean | undefined> {
    if (typeof this.hooks.request === "function") {
      const hookedResult = await this.hooks.request(this.requestOptions);
      if (typeof hookedResult === "boolean") {
        return hookedResult;
      }
    }
    if (typeof this.api?.permissions?.request === "function") {
      return Boolean(await this.api.permissions.request(this.requestOptions));
    }
    return undefined;
  }
}

export class WebsiteAccessPermissionController {
  private currentState: WebsiteAccessPermissionState | null = null;

  private readonly copy = getWebsiteAccessPermissionCopy();

  constructor(private readonly options: WebsiteAccessPermissionControllerOptions) {
    this.options.elements.action?.addEventListener("click", () => {
      void this.handleRequest();
    });
  }

  async initialize(): Promise<void> {
    const state = await this.options.service.getState();
    this.render(state);
  }

  private async handleRequest(): Promise<void> {
    const state = await this.options.service.requestAccess();
    this.render(state);
  }

  private render(state: WebsiteAccessPermissionState): void {
    const { action, badge, body, root, title } = this.options.elements;
    const viewModel = this.copy[state];

    root.classList.remove("is-hidden");
    root.dataset.permissionState = state;
    root.classList.toggle("is-success", state === "granted");
    root.classList.toggle("is-unavailable", state === "unavailable");
    badge.textContent = viewModel.badge;
    title.textContent = viewModel.title;
    body.textContent = viewModel.body;

    if (action) {
      if (viewModel.actionLabel) {
        action.hidden = false;
        action.disabled = false;
        action.textContent = viewModel.actionLabel;
      } else {
        action.hidden = true;
        action.disabled = true;
      }
    }

    if (state === "granted" && this.currentState !== "granted") {
      this.options.onGranted?.();
    }

    this.currentState = state;
  }
}
