import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { MutationScheduler } from "../src/adapters/chrome/content-script/MutationScheduler";

type TimerCallback = () => void;

function createMutation(target: Node): MutationRecord {
  return {
    type: "childList",
    addedNodes: [] as unknown as NodeList,
    target,
  } as unknown as MutationRecord;
}

describe("MutationScheduler", () => {
  const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );

  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, "visibilityState", originalVisibilityStateDescriptor);
      return;
    }
    Reflect.deleteProperty(document, "visibilityState");
  });

  test("coalesces multiple enqueue calls into a single animation frame flush", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const onReady = jest.fn();
    let frameIdCounter = 0;

    const rafSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        frameIdCounter += 1;
        return frameIdCounter;
      });

    const scheduler = new MutationScheduler(16, onReady);
    const firstTarget = document.createElement("div");
    const secondTarget = document.createElement("span");
    const firstMutation = createMutation(firstTarget);
    const secondMutation = createMutation(secondTarget);

    scheduler.enqueue([firstMutation]);
    scheduler.enqueue([secondMutation]);

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    frameCallbacks[0]?.(performance.now());

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith([firstMutation, secondMutation]);
  });

  test("clear cancels a pending animation frame and drops queued mutations", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const onReady = jest.fn();
    let frameIdCounter = 0;

    const rafSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        frameIdCounter += 1;
        return frameIdCounter;
      });
    const cancelSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((_id: number) => undefined);

    const scheduler = new MutationScheduler(16, onReady);
    const firstMutation = createMutation(document.createElement("div"));
    const secondMutation = createMutation(document.createElement("p"));

    scheduler.enqueue([firstMutation]);
    scheduler.clear();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith(1);

    frameCallbacks[0]?.(performance.now());
    expect(onReady).not.toHaveBeenCalled();

    scheduler.enqueue([secondMutation]);
    expect(rafSpy).toHaveBeenCalledTimes(2);
    frameCallbacks[1]?.(performance.now());

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith([secondMutation]);
  });

  test("uses timeout fallback coalescing when document is not visible", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    const timeoutCallbacks = new Map<number, TimerCallback>();
    const onReady = jest.fn();
    let timerIdCounter = 10;

    const rafSpy = jest.spyOn(window, "requestAnimationFrame");
    const setTimeoutSpy = jest
      .spyOn(window, "setTimeout")
      .mockImplementation((handler: TimerHandler): number => {
        timerIdCounter += 1;
        if (typeof handler === "function") {
          timeoutCallbacks.set(timerIdCounter, handler as TimerCallback);
        }
        return timerIdCounter;
      });

    const scheduler = new MutationScheduler(16, onReady);
    const firstMutation = createMutation(document.createElement("div"));
    const secondMutation = createMutation(document.createElement("section"));

    scheduler.enqueue([firstMutation]);
    scheduler.enqueue([secondMutation]);

    expect(rafSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    timeoutCallbacks.get(11)?.();

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith([firstMutation, secondMutation]);
  });
});
