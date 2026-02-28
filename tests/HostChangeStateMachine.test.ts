import { HostChangeStateMachine } from "../src/adapters/chrome/content-script/HostChangeStateMachine";

describe("HostChangeStateMachine", () => {
  test("tracks host changes and updates internal state", () => {
    const machine = new HostChangeStateMachine("example.com");

    expect(machine.evaluateHost("example.com")).toEqual({ type: "unchanged" });
    expect(machine.evaluateHost("news.example.com")).toEqual({
      type: "host-changed",
      previousHostName: "example.com",
      nextHostName: "news.example.com",
    });
    expect(machine.getHostName()).toBe("news.example.com");
  });

  test("prioritizes host change over node change in watchdog decision", () => {
    const machine = new HostChangeStateMachine("example.com");
    const observedNode = document.createElement("div");
    const currentNode = document.createElement("main");

    expect(
      machine.evaluateWatchDog({
        currentHostName: "other.example.com",
        observedNode,
        currentNode,
        runtimeEnabled: true,
      }),
    ).toEqual({
      type: "host-changed",
      previousHostName: "example.com",
      nextHostName: "other.example.com",
    });
  });

  test("returns node-changed when host is stable and node differs", () => {
    const machine = new HostChangeStateMachine("example.com");
    const observedNode = document.createElement("div");
    const currentNode = document.createElement("main");

    expect(
      machine.evaluateWatchDog({
        currentHostName: "example.com",
        observedNode,
        currentNode,
        runtimeEnabled: false,
      }),
    ).toEqual({
      type: "node-changed",
      runtimeEnabled: false,
      nextObservedNode: currentNode,
    });
  });

  test("returns noop when host and observed node are unchanged", () => {
    const machine = new HostChangeStateMachine("example.com");
    const node = document.createElement("div");

    expect(
      machine.evaluateWatchDog({
        currentHostName: "example.com",
        observedNode: node,
        currentNode: node,
        runtimeEnabled: true,
      }),
    ).toEqual({ type: "noop" });
  });
});
