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
import { LOCAL_AI_REVIEW_PORT, type LocalAiStatus } from "@core/domain/contracts/localAi";
import { localAiModelById, localAiModelForTier } from "@core/domain/localAi/modelRegistry";
import type {
  LocalAiCommandResponse,
  LocalAiStatusChangedMessage,
  Message,
} from "@core/domain/messageTypes";
import type { LocalAiSettingsRepository } from "@core/application/repositories/LocalAiSettingsRepository";
import { createLogger } from "@core/application/logging/Logger";
import { LocalAiHost, type EngineLike } from "./LocalAiHost";

/** Background owner of consent and of the optional in-process Local AI host. */

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

const SETTINGS_KEYS = [
  KEY_LOCAL_AI_REVIEW_ENABLED,
  KEY_LOCAL_AI_REVIEW_TIER,
  KEY_LOCAL_AI_REVIEW_CONSENT,
  KEY_LOCAL_AI_SETUP_OFFER_DISMISSED,
];

const logger = createLogger("LocalAiController");

export class LocalAiController {
  /** Null where the build ships no engine (Firefox). */
  private readonly host: LocalAiHost | null;
  private broadcasts: Promise<void> = Promise.resolve();
  private configuring: Promise<void> = Promise.resolve();

  constructor(
    private readonly settings: LocalAiSettings,
    engine: EngineLike | null,
    private readonly api: typeof chrome = chrome,
  ) {
    this.host = engine
      ? new LocalAiHost({
          engine,
          onChange: () => void this.broadcastStatus(),
          keepAlive: () => void api.runtime.getPlatformInfo(),
        })
      : null;
  }

  /** Listeners; registered only where the engine exists. */
  register(): void {
    if (!this.host) {
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
        if (request.context?.probe === true && fromOptions && this.host) {
          await this.configureHost();
          void this.host.refresh();
        }
        return this.ok();
      case CMD_LOCAL_AI_ENSURE_HOST:
        // The host runs in this service worker; configured before the review port connects.
        if (this.host) await this.configureHost();
        return this.ok();
      case CMD_LOCAL_AI_INSTALL:
      case CMD_LOCAL_AI_CANCEL_INSTALL:
      case CMD_LOCAL_AI_DELETE_MODEL:
        if (!fromOptions) {
          return { ok: false, error: "forbidden" };
        }
        if (!this.host) {
          return { ok: false, error: "unavailable" };
        }
        if (request.command === CMD_LOCAL_AI_INSTALL) {
          const tier = request.context?.tier;
          if (tier !== "standard" && tier !== "compact") {
            return { ok: false, error: "invalid" };
          }
          if (this.host.installing) {
            // Another options page's install runs: its consent and download stay as they are.
            return this.ok();
          }
          const record = localAiModelForTier(tier);
          // Consent is recorded at the moment of the explicit action; the host claims the
          // install at once and downloads nothing until the record is written.
          const consent = this.settings.setLocalAiReviewConsent({
            modelId: record.modelId,
            tier: record.tier,
            at: Date.now(),
          });
          void this.host.installModel(record.tier, consent);
          await consent;
          await this.configureHost();
        } else if (request.command === CMD_LOCAL_AI_DELETE_MODEL) {
          const record = localAiModelById(request.context?.modelId);
          if (!record) {
            return { ok: false, error: "invalid" };
          }
          // Consent and preference stay; nothing re-downloads until Install is pressed again.
          await this.configureHost();
          void this.host.deleteModel(record.modelId);
        } else {
          this.host.cancelInstall();
        }
        return this.ok();
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
    // Read before the settings: a broadcast reports the change that triggered it.
    const host = this.host?.state() ?? null;
    const [enabled, tier, consent, dismissed] = await Promise.all([
      this.settings.getLocalAiReviewEnabled(),
      this.settings.getLocalAiReviewTier(),
      this.settings.getLocalAiReviewConsent(),
      this.settings.getLocalAiSetupOfferDismissed(),
    ]);
    const record = localAiModelForTier(tier);
    const consented = consent?.tier === record.tier && consent.modelId === record.modelId;
    const hostDescribes =
      host !== null && (host.modelId === null || host.modelId === record.modelId);
    const unavailable = !this.host ? "host-unsupported" : (host?.unavailable ?? undefined);
    return {
      enabled,
      consented,
      tier: record.tier,
      modelId: record.modelId,
      displayName: record.displayName,
      downloadBytes: record.downloadBytes,
      install: host?.modelId === record.modelId ? host.install : "unknown",
      runtime: unavailable ? "unavailable" : hostDescribes ? host.runtime : "unconfigured",
      unavailable,
      error: hostDescribes ? host.error : undefined,
      progress: hostDescribes ? host.progress : undefined,
      offerSetup: enabled && !consented && !dismissed && this.host !== null && !unavailable,
    };
  }

  /** Tells the host the consented model (null without consent) and whether it may run it. */
  /** One at a time, each reading the settings on its turn, so the newest settings win. */
  private configureHost(): Promise<void> {
    this.configuring = this.configuring.then(async () => {
      const status = await this.getStatus();
      this.host?.configure(status.consented ? { modelId: status.modelId } : null, status.enabled);
    });
    return this.configuring;
  }

  /** Review ports come only from this extension's content scripts, in web pages. */
  private onConnect(port: chrome.runtime.Port): void {
    if (port.name !== LOCAL_AI_REVIEW_PORT || !this.host) {
      return;
    }
    const sender = port.sender;
    // An extension page open in a tab (the options page) is not a content script.
    const fromExtensionPage = sender?.url?.startsWith(this.api.runtime.getURL("")) === true;
    if (sender?.id !== this.api.runtime.id || !sender.tab || fromExtensionPage) {
      port.disconnect();
      return;
    }
    this.host.acceptReviewPort(port);
    void this.configureHost();
  }

  private async onSettingsChanged(): Promise<void> {
    // Configure only a host already in use: a settings change alone probes nothing.
    if (this.host?.configured) {
      await this.configureHost();
    }
    await this.broadcastStatus();
  }

  /**
   * Each broadcast snapshots the host when it is triggered and is sent in trigger
   * order, so a slower, older snapshot never lands after a newer one.
   */
  private broadcastStatus(): Promise<void> {
    const status = this.getStatus();
    this.broadcasts = this.broadcasts.then(async () => {
      try {
        const message: LocalAiStatusChangedMessage = {
          command: CMD_LOCAL_AI_STATUS_CHANGED,
          context: { status: await status },
        };
        await this.api.runtime.sendMessage(message);
      } catch {
        // No extension page is listening.
      }
    });
    return this.broadcasts;
  }
}
