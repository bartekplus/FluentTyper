import { jest, mock } from "bun:test";

type DomObserverLike = {
  attach: (...args: unknown[]) => void;
  disconnect: (...args: unknown[]) => void;
  setNode: (...args: unknown[]) => void;
  getNode: (...args: unknown[]) => unknown;
};

const mockChrome = {
  runtime: {
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(),
  },
};

const watchdogHarness = {
  domObserverInstances: [] as DomObserverLike[],
};
let importNonce = 0;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_content_watchdog=${importNonce}`;
}

async function loadContentScriptModule() {
  watchdogHarness.domObserverInstances.length = 0;

  await import(
    freshModulePath("../src/adapters/chrome/content-script/content_script")
  );
}

jest.unstable_mockModule("../src/adapters/chrome/content-script/TributeManager", () => ({
  TributeManager: jest.fn().mockImplementation(() => ({
    queryAndAttachHelper: jest.fn(),
    detachAllHelpers: jest.fn(),
    removeHelpersNotInDocument: jest.fn(),
    updateLangConfig: jest.fn(),
    triggerActiveTribute: jest.fn(),
    fulfillPrediction: jest.fn(),
  })),
}));

jest.unstable_mockModule("../src/adapters/chrome/content-script/DomObserver", () => ({
  DomObserver: jest.fn().mockImplementation((initialNode: unknown) => {
    const firstNode = initialNode as Node;
    let currentNode: Node = firstNode;
    const instance: DomObserverLike = {
      attach: jest.fn(),
      disconnect: jest.fn(),
      setNode: jest.fn((nextNode: unknown) => {
        currentNode = nextNode as Node;
      }),
      getNode: jest.fn(() => currentNode),
    };
    watchdogHarness.domObserverInstances.push(instance);
    return instance;
  }),
}));

describe("content_script watchdog scheduling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (global as unknown as { chrome: unknown }).chrome = mockChrome;
    (window as Window & { FluentTyper?: unknown }).FluentTyper = undefined;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    mock.restore();
  });

  test("does not start a 1-second polling interval", async () => {
    const setIntervalSpy = jest.spyOn(global, "setInterval");

    await loadContentScriptModule();

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  test("debounces watchdog checks when multiple lifecycle events fire", async () => {
    await loadContentScriptModule();
    const instance = (
      window as Window & { FluentTyper?: { watchDog: () => void } }
    ).FluentTyper;
    expect(instance).toBeDefined();

    const watchDogSpy = jest.spyOn(instance!, "watchDog");
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    // Consume initial startup scheduling.
    jest.advanceTimersByTime(250);
    watchDogSpy.mockClear();

    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("popstate"));
    window.dispatchEvent(new Event("hashchange"));

    expect(clearTimeoutSpy).toHaveBeenCalled();
    jest.advanceTimersByTime(249);
    expect(watchDogSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(watchDogSpy).toHaveBeenCalledTimes(1);
  });

  test("runs watchdog after document visibility change", async () => {
    await loadContentScriptModule();
    const instance = (
      window as Window & { FluentTyper?: { watchDog: () => void } }
    ).FluentTyper;
    expect(instance).toBeDefined();

    const watchDogSpy = jest.spyOn(instance!, "watchDog");

    // Consume initial startup scheduling.
    jest.advanceTimersByTime(250);
    watchDogSpy.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));
    jest.advanceTimersByTime(250);

    expect(watchDogSpy).toHaveBeenCalledTimes(1);
  });
});
