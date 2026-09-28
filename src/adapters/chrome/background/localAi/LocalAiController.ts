import {
  CMD_LOCAL_AI_CANCEL_INSTALL,
  CMD_LOCAL_AI_DELETE_MODEL,
  CMD_LOCAL_AI_DISMISS_SETUP_OFFER,
  CMD_LOCAL_AI_ENSURE_HOST,
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_INSTALL,
  CMD_LOCAL_AI_OPEN_SETUP,
  CMD_LOCAL_AI_STATUS_CHANGED,
  KEY_LOCAL_AI_REVIEW_CONSENT,
  KEY_LOCAL_AI_REVIEW_ENABLED,
  KEY_LOCAL_AI_REVIEW_TIER,
  KEY_LOCAL_AI_SETUP_OFFER_DISMISSED,
} from "@core/domain/constants";
import {
  LOCAL_AI_HOST_PORT,
  LOCAL_AI_OFFSCREEN_PATH,
  type HostPortDownMessage,
  type HostPortUpMessage,
  type LocalAiStatus,
} from "@core/domain/contracts/localAi";
import { localAiModelById, localAiModelForTier } from "@core/domain/localAi/modelRegistry";
import type {
  LocalAiCommandResponse,
  LocalAiStatusChangedMessage,
  Message,
} from "@core/domain/messageTypes";
import type { LocalAiSettingsRepository } from "@core/application/repositories/LocalAiSettingsRepository";
import { createLogger } from "@core/application/logging/Logger";
import { isObjectRecord } from "@core/domain/guards";

/** Background owner of consent and the optional offscreen host. */

export type LocalAiSettings = Pick<
  LocalAiSettingsRepository,
  | "getLocalAiReviewEnabled"
  | "getLocalAiReviewTier"
  | "getLocalAiReviewConsent"
  | "setLocalAiReviewConsent"
  | "getLocalAiSetupOfferDismissed"
  | "setLocalAiSetupOfferDismissed"
>;

export type LocalAiRequest = Extract<Message, { command: `CMD_LOCAL_AI_${string}` }>;

type HostState = Omit<Extract<HostPortUpMessage, { type: "state" }>, "type">;

const SETTINGS_KEYS = [
  KEY_LOCAL_AI_REVIEW_ENABLED,
  KEY_LOCAL_AI_REVIEW_TIER,
  KEY_LOCAL_AI_REVIEW_CONSENT,
  KEY_LOCAL_AI_SETUP_OFFER_DISMISSED,
];
const RUNTIME_STATES = new Set<string>([
  "unconfigured",
  "checking-support",
  "download-required",
  "downloading",
  "loading",
  "ready",
  "generating",
  "unloading",
  "unavailable",
  "error",
]);
const INSTALL_STATES = new Set<string>(["unknown", "none", "partial", "complete"]);
const OFFSCREEN_JUSTIFICATION =
  "Runs FluentTyper's optional on-device Local AI Review model in a dedicated worker.";

const logger = createLogger("LocalAiController");

function optionalString<T extends string>(value: unknown): T | undefined {
  return typeof value === "string" ? (value as T) : undefined;
}

export class LocalAiController {
  private hostPort: chrome.runtime.Port | null = null;
  /** An explicit install was sent and has not reported back: the document must stay. */
  private installInFlight = false;
  private hostState: HostState | null = null;
  private hostFailed = false;
  private documentPromise: Promise<void> | null = null;
  private closingPromise: Promise<void> | null = null;
  /** ENSURE_HOST requests in flight: a Review is opening, so `idle` must not close the host. */
  private ensuring = 0;
  /** Explicit actions waiting for the host port (sent right after `configure`). */
  private pendingDown: HostPortDownMessage[] = [];
  private hostConfigured = false;
  private lastConfigure = "";

  constructor(
    private readonly settings: LocalAiSettings,
    private readonly api: typeof chrome = chrome,
  ) {}

  get hostSupported(): boolean {
    return typeof this.api.offscreen?.createDocument === "function";
  }

  /** Listeners; registered only where a runtime host can exist. */
  register(): void {
    if (!this.hostSupported) {
      return;
    }
    this.api.runtime.onConnect.addListener((port) => this.onConnect(port));
    this.api.storage.onChanged.addListener((changes, area) => {
      const keys = Object.keys(changes);
      if (
        area === "local" &&
        keys.some((key) => SETTINGS_KEYS.some((name) => key === name || key.endsWith(`.${name}`)))
      ) {
        void this.onSettingsChanged();
      }
    });
  }

  async handleMessage(
    request: LocalAiRequest,
    sender: chrome.runtime.MessageSender,
  ): Promise<LocalAiCommandResponse> {
    try {
      return await this.dispatch(request, sender);
    } catch {
      logger.warn("Local AI command failed", { command: request.command });
      return { ok: false, error: "unavailable" };
    }
  }

  private async dispatch(
    request: LocalAiRequest,
    sender: chrome.runtime.MessageSender,
  ): Promise<LocalAiCommandResponse> {
    const fromOptions = this.isOptionsPage(sender);
    switch (request.command) {
      case CMD_LOCAL_AI_GET_STATUS:
        if (request.context?.probe === true && fromOptions && this.hostSupported) {
          await this.sendToHost({ type: "probe" });
        }
        return this.ok();
      case CMD_LOCAL_AI_ENSURE_HOST: {
        this.ensuring += 1;
        try {
          const status = await this.getStatus();
          if (status.enabled && status.consented && this.hostSupported) {
            // Resolves once the document has loaded, i.e. its review-port listener exists.
            await this.ensureDocument();
            if (this.hostFailed) {
              return { ok: false, error: "unavailable" };
            }
            if (!this.hostPort) {
              this.nudgeHost();
            }
          }
          return await this.ok();
        } finally {
          this.ensuring -= 1;
        }
      }
      case CMD_LOCAL_AI_INSTALL:
      case CMD_LOCAL_AI_CANCEL_INSTALL:
      case CMD_LOCAL_AI_DELETE_MODEL:
        if (!fromOptions) {
          return { ok: false, error: "forbidden" };
        }
        if (!this.hostSupported) {
          return { ok: false, error: "unavailable" };
        }
        return this.handleModelAction(request);
      case CMD_LOCAL_AI_OPEN_SETUP:
        await this.api.tabs.create({
          url: this.api.runtime.getURL("options/options.html#local-ai"),
        });
        return this.ok();
      case CMD_LOCAL_AI_DISMISS_SETUP_OFFER:
        await this.settings.setLocalAiSetupOfferDismissed(true);
        return this.ok();
      default:
        return { ok: false, error: "invalid" };
    }
  }

  private async handleModelAction(
    request: Extract<
      LocalAiRequest,
      {
        command:
          | typeof CMD_LOCAL_AI_INSTALL
          | typeof CMD_LOCAL_AI_CANCEL_INSTALL
          | typeof CMD_LOCAL_AI_DELETE_MODEL;
      }
    >,
  ): Promise<LocalAiCommandResponse> {
    switch (request.command) {
      case CMD_LOCAL_AI_INSTALL: {
        const tier = request.context?.tier;
        if (tier !== "standard" && tier !== "compact") {
          return { ok: false, error: "invalid" };
        }
        const record = localAiModelForTier(tier);
        // Consent is recorded at the moment of the explicit action, then acted on.
        await this.settings.setLocalAiReviewConsent({
          modelId: record.modelId,
          tier: record.tier,
          at: Date.now(),
        });
        this.installInFlight = true;
        await this.sendToHost({ type: "install", tier: record.tier });
        return this.ok();
      }
      case CMD_LOCAL_AI_CANCEL_INSTALL:
        if (this.hostPort || (await this.documentExists())) {
          await this.sendToHost({ type: "cancel-install" });
        }
        return this.ok();
      case CMD_LOCAL_AI_DELETE_MODEL: {
        const record = localAiModelById(request.context?.modelId);
        if (!record) {
          return { ok: false, error: "invalid" };
        }
        // Consent and preference stay; nothing re-downloads until Install is pressed again.
        await this.sendToHost({ type: "delete-model", modelId: record.modelId });
        return this.ok();
      }
    }
  }

  private async ok(): Promise<LocalAiCommandResponse> {
    return { ok: true, status: await this.getStatus() };
  }

  /** Extension options page only; content scripts carry the web page's URL. */
  private isOptionsPage(sender: chrome.runtime.MessageSender): boolean {
    return (
      sender.id === this.api.runtime.id &&
      typeof sender.url === "string" &&
      sender.url.startsWith(this.api.runtime.getURL("options/"))
    );
  }

  async getStatus(): Promise<LocalAiStatus> {
    const [enabled, tier, consent, dismissed] = await Promise.all([
      this.settings.getLocalAiReviewEnabled(),
      this.settings.getLocalAiReviewTier(),
      this.settings.getLocalAiReviewConsent(),
      this.settings.getLocalAiSetupOfferDismissed(),
    ]);
    const record = localAiModelForTier(tier);
    const consented = consent?.tier === record.tier && consent.modelId === record.modelId;
    const host = this.hostState;
    const hostDescribes =
      host !== null && (host.modelId === null || host.modelId === record.modelId);
    const unavailable = !this.hostSupported ? "host-unsupported" : (host?.unavailable ?? undefined);
    const error = this.hostFailed ? "host-failed" : hostDescribes ? host.error : undefined;
    // From the Install click until the host reports `installed`, the host's own
    // intermediate states (unconfigured, checking, not yet downloaded) are not news.
    const installing =
      this.installInFlight &&
      !this.hostFailed &&
      !unavailable &&
      host?.runtime !== "downloading" &&
      host?.runtime !== "loading";
    const runtime = unavailable ? "unavailable" : hostDescribes ? host.runtime : "unconfigured";
    return {
      enabled,
      consented,
      tier: record.tier,
      modelId: record.modelId,
      displayName: record.displayName,
      downloadBytes: record.downloadBytes,
      install: host?.modelId === record.modelId ? host.install : "unknown",
      runtime: installing ? "downloading" : runtime,
      unavailable,
      error,
      progress: hostDescribes ? host.progress : undefined,
      offerSetup: enabled && !consented && !dismissed && this.hostSupported && !unavailable,
    };
  }

  // ------------------------------------------------------------ offscreen document

  private async documentExists(): Promise<boolean> {
    if (typeof this.api.runtime.getContexts !== "function") {
      return this.hostPort !== null;
    }
    const contexts = await this.api.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [this.api.runtime.getURL(LOCAL_AI_OFFSCREEN_PATH)],
    });
    return contexts.length > 0;
  }

  /** Single-flight create (after any close in progress); a no-op when the document exists. */
  private ensureDocument(): Promise<void> {
    this.documentPromise ??= (async () => {
      await this.closingPromise;
      try {
        if (!(await this.documentExists())) {
          await this.api.offscreen.createDocument({
            url: LOCAL_AI_OFFSCREEN_PATH,
            reasons: ["WORKERS"],
            justification: OFFSCREEN_JUSTIFICATION,
          });
        }
        this.hostFailed = false;
      } catch {
        this.hostFailed = true;
        this.pendingDown = [];
        logger.warn("Local AI host could not be created");
      }
    })().finally(() => {
      this.documentPromise = null;
    });
    return this.documentPromise;
  }

  private async closeDocument(): Promise<void> {
    this.hostPort?.disconnect();
    this.hostPort = null;
    if (this.hostState) {
      // A closed host keeps nothing warm; cached artifacts stay as last seen.
      const install = this.hostState.install;
      this.hostState = {
        ...this.hostState,
        runtime:
          this.hostState.runtime === "unavailable"
            ? "unavailable"
            : install === "complete"
              ? "ready"
              : install === "none" || install === "partial"
                ? "download-required"
                : "unconfigured",
        progress: undefined,
      };
    }
    try {
      if (await this.documentExists()) {
        await this.api.offscreen.closeDocument();
      }
    } catch {
      // Already closed.
    }
  }

  /** After a service-worker restart the host is alive but unconnected: ask it to reconnect. */
  private nudgeHost(): void {
    void Promise.resolve(this.api.runtime.sendMessage({ type: LOCAL_AI_HOST_PORT })).catch(
      () => undefined,
    );
  }

  private async sendToHost(message: HostPortDownMessage): Promise<void> {
    if (this.hostPort && this.hostConfigured) {
      this.hostPort.postMessage(message);
      return;
    }
    this.pendingDown.push(message);
    if (this.hostPort) {
      return;
    }
    await this.ensureDocument();
    if (!this.hostPort) {
      this.nudgeHost();
    }
  }

  // ------------------------------------------------------------ host port

  private onConnect(port: chrome.runtime.Port): void {
    if (port.name !== LOCAL_AI_HOST_PORT) {
      // Review ports belong to the offscreen host; other ports to other owners.
      return;
    }
    if (port.sender?.tab || port.sender?.url !== this.api.runtime.getURL(LOCAL_AI_OFFSCREEN_PATH)) {
      port.disconnect();
      return;
    }
    this.hostPort?.disconnect();
    this.hostPort = port;
    this.hostConfigured = false;
    this.lastConfigure = "";
    port.onMessage.addListener((message: unknown) => this.onHostMessage(port, message));
    port.onDisconnect.addListener(() => {
      if (this.hostPort === port) {
        this.hostPort = null;
        this.installInFlight = false;
      }
    });
    // `configure` always goes first; explicit actions queued meanwhile follow it.
    void this.pushConfigure().then(() => {
      if (this.hostPort !== port) {
        return;
      }
      this.hostConfigured = true;
      const pending = this.pendingDown;
      this.pendingDown = [];
      pending.forEach((message) => port.postMessage(message));
    });
  }

  private onHostMessage(port: chrome.runtime.Port, value: unknown): void {
    if (port !== this.hostPort) {
      return;
    }
    const message = isObjectRecord(value) ? value : null;
    switch (message?.type) {
      case "state":
        if (
          typeof message.runtime === "string" &&
          RUNTIME_STATES.has(message.runtime) &&
          typeof message.install === "string" &&
          INSTALL_STATES.has(message.install)
        ) {
          const record = localAiModelById(message.modelId);
          this.hostState = {
            runtime: message.runtime as HostState["runtime"],
            install: message.install as HostState["install"],
            modelId: record?.modelId ?? null,
            unavailable: optionalString(message.unavailable),
            error: optionalString(message.error),
            progress: typeof message.progress === "number" ? message.progress : undefined,
          };
          void this.broadcastStatus();
        }
        return;
      case "installed":
        this.installInFlight = false;
        void this.broadcastStatus();
        return;
      case "deleted":
        void this.broadcastStatus();
        return;
      case "idle":
        // The host released the GPU and no Review is open. Keep the document if a
        // Review is being opened on it right now, an explicit action is queued, or
        // an install is under way (an idle sent before the host saw it can cross it).
        if (
          this.pendingDown.length === 0 &&
          this.ensuring === 0 &&
          !this.installInFlight &&
          !this.closingPromise
        ) {
          this.closingPromise = this.closeDocument().finally(() => {
            this.closingPromise = null;
          });
          void this.closingPromise.then(() => this.broadcastStatus());
        }
        return;
      default:
        return;
    }
  }

  /** Tells the host which model it may run: null without consent or with the preference off. */
  private async pushConfigure(): Promise<void> {
    const status = await this.getStatus();
    const message: HostPortDownMessage = {
      type: "configure",
      model: status.consented && status.enabled ? { modelId: status.modelId } : null,
      enabled: status.enabled,
    };
    const key = JSON.stringify(message);
    if (this.hostPort && key !== this.lastConfigure) {
      this.lastConfigure = key;
      this.hostPort.postMessage(message);
    }
  }

  private async onSettingsChanged(): Promise<void> {
    if (this.hostPort) {
      await this.pushConfigure();
    } else if (await this.documentExists()) {
      this.nudgeHost();
    }
    await this.broadcastStatus();
  }

  private async broadcastStatus(): Promise<void> {
    const message: LocalAiStatusChangedMessage = {
      command: CMD_LOCAL_AI_STATUS_CHANGED,
      context: { status: await this.getStatus() },
    };
    try {
      await this.api.runtime.sendMessage(message);
    } catch {
      // No extension page is listening.
    }
  }
}
