import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import { CommandRouter } from "../router/CommandRouter";
import { MessageRouter } from "../router/MessageRouter";
import type { EngineLike } from "../localAi/LocalAiHost";
import { registerRuntimeTestHooks } from "@adapters/chrome/background/testing/RuntimeTestHooks";

export class BackgroundBootstrap {
  private readonly worker: BackgroundServiceWorker;
  private readonly commandRouter = new CommandRouter(() => this.worker);
  private readonly messageRouter = new MessageRouter(() => this.worker);

  constructor(localAiEngine: EngineLike | null = null) {
    this.worker = new BackgroundServiceWorker(localAiEngine);
  }

  register(): void {
    chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
    chrome.commands.onCommand.addListener((command) => {
      void this.commandRouter.handle(command);
    });
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) =>
      this.messageRouter.handle(request, sender, sendResponse),
    );
    this.worker.localAiController.register();

    registerRuntimeTestHooks(this.commandRouter);
    this.loadLastVersionAndInitialize();
  }

  private onInstalled(details: chrome.runtime.InstalledDetails): void {
    if (details.reason === "install") {
      void chrome.tabs.create({
        url: "new_installation/index.html",
      });
      return;
    }

    // No migration here: worker.initialize already migrates from the stored version.
    if (details.reason === "update") {
      const thisVersion = chrome.runtime.getManifest().version;
      console.log(`Updated from ${details.previousVersion} to ${thisVersion}!`);
    }
  }

  private loadLastVersionAndInitialize(): void {
    const initializeFromLastVersion = async ({
      lastVersion,
    }: {
      lastVersion?: unknown;
    }): Promise<void> => {
      await this.worker.initialize(typeof lastVersion === "string" ? lastVersion : undefined);
    };

    // Keep listener registration synchronous, but still await startup work once the
    // persisted version is available so migration/config initialization stays ordered.
    chrome.storage.local.get(
      "lastVersion",
      initializeFromLastVersion as unknown as (items: { [key: string]: unknown }) => void,
    );
  }
}
