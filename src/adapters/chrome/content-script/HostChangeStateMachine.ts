export type HostCheckDecision =
  | {
      type: "unchanged";
    }
  | {
      type: "host-changed";
      previousHostName: string;
      nextHostName: string;
    };

export type WatchDogDecision =
  | {
      type: "host-changed";
      previousHostName: string;
      nextHostName: string;
    }
  | {
      type: "node-changed";
      runtimeEnabled: boolean;
      nextObservedNode: Node;
    }
  | {
      type: "noop";
    };

export class HostChangeStateMachine {
  private hostName: string;

  constructor(initialHostName: string) {
    this.hostName = initialHostName;
  }

  getHostName(): string {
    return this.hostName;
  }

  setHostName(hostName: string): void {
    this.hostName = hostName;
  }

  evaluateHost(currentHostName: string): HostCheckDecision {
    if (this.hostName === currentHostName) {
      return { type: "unchanged" };
    }

    const previousHostName = this.hostName;
    this.hostName = currentHostName;
    return {
      type: "host-changed",
      previousHostName,
      nextHostName: currentHostName,
    };
  }

  evaluateWatchDog(context: {
    currentHostName: string;
    observedNode: Node;
    currentNode: Node;
    runtimeEnabled: boolean;
  }): WatchDogDecision {
    const hostDecision = this.evaluateHost(context.currentHostName);
    if (hostDecision.type === "host-changed") {
      return hostDecision;
    }

    if (context.observedNode !== context.currentNode) {
      return {
        type: "node-changed",
        runtimeEnabled: context.runtimeEnabled,
        nextObservedNode: context.currentNode,
      };
    }

    return { type: "noop" };
  }
}
