import { logError } from "@core/domain/error";
import { checkLastError } from "@core/application/transport-utils";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import { migrateToLocalStore } from "../Migration";
import { CommandRouter } from "../router/CommandRouter";
import { MessageRouter } from "../router/MessageRouter";
import { registerRuntimeTestHooks } from "@adapters/chrome/background/testing/RuntimeTestHooks";

export class BackgroundBootstrap {
  private readonly worker = new BackgroundServiceWorker();
  private readonly commandRouter = new CommandRouter(() => this.worker);
  private readonly messageRouter = new MessageRouter(() => this.worker);

  register(): void {
    chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
    chrome.commands.onCommand.addListener((command) => {
      void this.commandRouter.handle(command);
    });
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) =>
      this.messageRouter.handle(request, sender, sendResponse),
    );

    registerRuntimeTestHooks(this.commandRouter);
    this.loadLastVersionAndInitialize();
  }

  private onInstalled(details: chrome.runtime.InstalledDetails): void {
    checkLastError();
    if (details.reason === "install") {
      void chrome.tabs.create({
        url: "new_installation/index.html",
      });
      return;
    }

    if (details.reason === "update") {
      const thisVersion = chrome.runtime.getManifest().version;
      console.log(`Updated from ${details.previousVersion} to ${thisVersion}!`);
      migrateToLocalStore(details.previousVersion).catch((error) => {
        logError("migrateToLocalStore", error);
      });
    }
  }

  private loadLastVersionAndInitialize(): void {
    const initializeFromLastVersion = async ({
      lastVersion,
    }: {
      lastVersion?: unknown;
    }): Promise<void> => {
      try {
        await this.worker.initialize(typeof lastVersion === "string" ? lastVersion : undefined);
      } catch (error) {
        logError("lastVersion handler", error);
      }
    };

    // Keep listener registration synchronous, but still await startup work once the
    // persisted version is available so migration/config initialization stays ordered.
    chrome.storage.local.get(
      "lastVersion",
      initializeFromLastVersion as unknown as (items: { [key: string]: unknown }) => void,
    );
  }
}
