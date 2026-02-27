import { logError } from "@core/domain/error";
import { checkLastError } from "@core/application/utils";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import { migrateToLocalStore } from "../Migration";
import { CommandRouter } from "../router/CommandRouter";
import { MessageRouter } from "../router/MessageRouter";
import { registerRuntimeTestHooks } from "../testing/RuntimeTestHooks";

export class BackgroundBootstrap {
  private readonly getWorker = (): BackgroundServiceWorker =>
    new BackgroundServiceWorker();
  private readonly commandRouter = new CommandRouter(this.getWorker);
  private readonly messageRouter = new MessageRouter(this.getWorker);

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
      chrome.tabs.create({
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
    chrome.storage.local.get("lastVersion", async (result) => {
      const lastVersion = result?.lastVersion as string | undefined;
      await this.getWorker().initialize(lastVersion);
    });
  }
}
