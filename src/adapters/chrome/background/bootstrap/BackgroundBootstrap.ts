import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import { CommandRouter } from "../router/CommandRouter";
import { MessageRouter } from "../router/MessageRouter";
import type { EngineLike } from "../localAi/LocalAiHost";
import { registerRuntimeTestHooks } from "@adapters/chrome/background/testing/RuntimeTestHooks";
import { logError } from "@core/domain/error";

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
    const version = new Promise<string | undefined>((resolve, reject) => {
      chrome.storage.local.get("lastVersion", ({ lastVersion }) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(typeof lastVersion === "string" ? lastVersion : undefined);
      });
    });
    // Register startup in the queue before the stored version arrives.
    void this.worker.initialize(version).catch((error) => logError("background startup", error));
  }
}
