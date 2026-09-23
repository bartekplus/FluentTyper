import { i18n } from "@ui/options/fluenttyperI18n.js";

export type WebsiteAccessPermissionState = "missing" | "granted" | "unavailable";

const WEBSITE_ACCESS_PERMISSION: chrome.permissions.Permissions = {
  origins: ["<all_urls>"],
};

type PermissionCopy = {
  actionLabel?: string;
  badge: string;
  body: string;
  title: string;
};

interface WebsiteAccessPermissionElements {
  action: HTMLButtonElement;
  badge: HTMLElement;
  body: HTMLElement;
  root: HTMLElement;
  title: HTMLElement;
}

type PermissionFunction = (
  options: chrome.permissions.Permissions,
) => Promise<boolean | undefined> | boolean | undefined;

interface PermissionFunctions {
  contains?: PermissionFunction;
  request?: PermissionFunction;
}

interface WebsiteAccessPermissionApi {
  permissions?: PermissionFunctions;
}

interface WebsiteAccessPermissionControllerOptions {
  elements: WebsiteAccessPermissionElements;
  onGranted?: () => void;
  onStateChange?: (state: WebsiteAccessPermissionState) => void | Promise<void>;
  service: WebsiteAccessPermissionService;
  visibleStates?: WebsiteAccessPermissionState[];
}

function getWebsiteAccessPermissionCopy(): Record<WebsiteAccessPermissionState, PermissionCopy> {
  return {
    missing: {
      badge: i18n.get("permission_status_missing_badge"),
      title: i18n.get("permission_status_missing_title"),
      body: i18n.get("permission_status_missing_body"),
      actionLabel: i18n.get("permission_status_action"),
    },
    granted: {
      badge: i18n.get("permission_status_granted_badge"),
      title: i18n.get("permission_status_granted_title"),
      body: i18n.get("permission_status_granted_body"),
    },
    unavailable: {
      badge: i18n.get("permission_status_unavailable_badge"),
      title: i18n.get("permission_status_unavailable_title"),
      body: i18n.get("permission_status_unavailable_body"),
    },
  };
}

export class WebsiteAccessPermissionService {
  constructor(
    private readonly api: WebsiteAccessPermissionApi | undefined,
    private readonly hooks: PermissionFunctions = {},
  ) {}

  async getState(): Promise<WebsiteAccessPermissionState> {
    return this.resolve("contains");
  }

  async requestAccess(): Promise<WebsiteAccessPermissionState> {
    return this.resolve("request");
  }

  private async resolve(kind: "contains" | "request"): Promise<WebsiteAccessPermissionState> {
    const permissions = this.api?.permissions;
    const hook = this.hooks[kind];
    const apiCall = permissions?.[kind];
    if (typeof hook !== "function" && typeof apiCall !== "function") {
      return "unavailable";
    }

    try {
      let granted: boolean | undefined;
      if (typeof hook === "function") {
        const hooked = await hook(WEBSITE_ACCESS_PERMISSION);
        if (typeof hooked === "boolean") {
          granted = hooked;
        }
      }
      if (granted === undefined && typeof apiCall === "function") {
        granted = Boolean(await apiCall.call(permissions, WEBSITE_ACCESS_PERMISSION));
      }
      if (granted === undefined) {
        return "unavailable";
      }
      return granted ? "granted" : "missing";
    } catch {
      return "unavailable";
    }
  }
}

export class WebsiteAccessPermissionController {
  private currentState: WebsiteAccessPermissionState | null = null;

  private readonly copy = getWebsiteAccessPermissionCopy();
  private readonly visibleStates: ReadonlySet<WebsiteAccessPermissionState>;

  constructor(private readonly options: WebsiteAccessPermissionControllerOptions) {
    this.visibleStates = new Set(options.visibleStates ?? ["missing", "granted", "unavailable"]);
    this.options.elements.action.addEventListener("click", () => {
      void this.handleRequest();
    });
  }

  async initialize(): Promise<void> {
    const state = await this.options.service.getState();
    await this.render(state);
  }

  private async handleRequest(): Promise<void> {
    const state = await this.options.service.requestAccess();
    await this.render(state);
  }

  private async render(state: WebsiteAccessPermissionState): Promise<void> {
    const { action, badge, body, root, title } = this.options.elements;
    const viewModel = this.copy[state];

    root.classList.toggle("is-hidden", !this.visibleStates.has(state));
    root.dataset.permissionState = state;
    root.classList.toggle("is-success", state === "granted");
    root.classList.toggle("is-unavailable", state === "unavailable");
    badge.textContent = viewModel.badge;
    title.textContent = viewModel.title;
    body.textContent = viewModel.body;

    action.hidden = !viewModel.actionLabel;
    action.disabled = !viewModel.actionLabel;
    if (viewModel.actionLabel) {
      action.textContent = viewModel.actionLabel;
    }

    if (state === "granted" && this.currentState !== "granted") {
      this.options.onGranted?.();
    }

    await this.options.onStateChange?.(state);
    this.currentState = state;
  }
}
