import { afterEach, expect, jest, test } from "bun:test";
import { TabMessenger } from "../src/adapters/chrome/background/TabMessenger";

const globals = globalThis as { chrome?: unknown };
const baseChrome = globals.chrome;

afterEach(() => {
  globals.chrome = baseChrome;
});

test("each send to a tab catches the rejection of a tab with no receiver", async () => {
  const caught = jest.fn();
  globals.chrome = {
    tabs: {
      onActivated: { addListener: () => undefined },
      query: async () => [{ id: 7, url: "https://example.com/" }],
      sendMessage: () => ({ catch: caught }),
    },
  };
  const messenger = new TabMessenger();
  const message = { command: "x" } as never;

  messenger.sendToTab(7, 0, message);
  messenger.sendToActiveTab(message);
  messenger.sendToActiveTab(message, {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(caught).toHaveBeenCalledTimes(3);
});
