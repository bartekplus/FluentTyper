import {
  CMD_REVIEW_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import type { CommandRouter } from "../router/CommandRouter";

declare const __FT_DEV_BUILD__: boolean | undefined;

type RuntimeTestGlobals = typeof globalThis & {
  triggerCommandForTesting?: (command: string) => Promise<void> | void;
};

const TEST_MSG_TRIGGER_COMMAND = "TEST_TRIGGER_COMMAND";
const ENABLE_RUNTIME_TEST_HOOKS =
  typeof __FT_DEV_BUILD__ !== "undefined" && Boolean(__FT_DEV_BUILD__);
const logger = createLogger("RuntimeTestHooks");
const TEST_TRIGGER_COMMAND_ALLOW_LIST = new Set<string>([
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_REVIEW_FT_ACTIVE_TAB,
]);

const testGlobals: RuntimeTestGlobals = globalThis;

export function registerRuntimeTestHooks(commandRouter: CommandRouter): void {
  if (!ENABLE_RUNTIME_TEST_HOOKS) {
    return;
  }
  logger.info("Registering runtime test hooks");
  testGlobals.triggerCommandForTesting = async (command: string) => {
    await commandRouter.handle(command);
  };

  const isTrustedInternalSender = (sender: chrome.runtime.MessageSender): boolean => {
    if (typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""))) {
      return true;
    }
    return sender.id === chrome.runtime.id && typeof sender.tab === "undefined";
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message !== "object" || !message) {
      return false;
    }
    const type = (message as { type?: unknown }).type;
    if (type !== TEST_MSG_TRIGGER_COMMAND) {
      return false;
    }
    if (!isTrustedInternalSender(sender)) {
      sendResponse({ ok: false });
      return true;
    }

    const command = (message as { command?: unknown }).command;
    if (typeof command !== "string" || !TEST_TRIGGER_COMMAND_ALLOW_LIST.has(command)) {
      sendResponse({ ok: false });
      return true;
    }
    void commandRouter.handle(command).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  });
}
