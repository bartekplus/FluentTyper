import { createLogger } from "@core/application/logging/Logger";
import { HostChangeStateMachine } from "./HostChangeStateMachine";

export type HostChangeWatcherDependencies = {
  watchDogRunner: () => void;
  getObservedNode: () => Node;
  setObservedNode: (node: Node) => void;
  isRuntimeEnabled: () => boolean;
  restartRuntime: () => void;
  requestConfig: () => void;
};

const logger = createLogger("HostChangeWatcher");

export class HostChangeWatcher {
  private watchDogTimeoutId: number | null = null;
  private rootNodeObserver: MutationObserver | null = null;
  private readonly stateMachine: HostChangeStateMachine;
  private readonly scheduleWatchDogCheckBound: () => void;

  constructor(
    private readonly dependencies: HostChangeWatcherDependencies,
    private readonly debounceMs = 250,
  ) {
    this.stateMachine = new HostChangeStateMachine(window.location.hostname);
    this.scheduleWatchDogCheckBound = this.scheduleWatchDogCheck.bind(this);
  }

  start(): void {
    this.attachRootNodeObserver();
    this.attachWatchDogEventListeners();
    this.scheduleWatchDogCheck();
  }

  getHostName(): string {
    return this.stateMachine.getHostName();
  }

  setHostName(hostName: string): void {
    this.stateMachine.setHostName(hostName);
  }

  checkHostName(): boolean {
    const decision = this.stateMachine.evaluateHost(window.location.hostname);
    if (decision.type === "host-changed") {
      logger.info("Host changed; refetching config", {
        previousHost: decision.previousHostName,
        nextHost: decision.nextHostName,
      });
      this.dependencies.requestConfig();
      return true;
    }
    return false;
  }

  watchDog(): void {
    const currentNode = document.body || document.documentElement;
    const decision = this.stateMachine.evaluateWatchDog({
      currentHostName: window.location.hostname,
      observedNode: this.dependencies.getObservedNode(),
      currentNode,
      runtimeEnabled: this.dependencies.isRuntimeEnabled(),
    });

    if (decision.type === "host-changed") {
      logger.info("Host changed; refetching config", {
        previousHost: decision.previousHostName,
        nextHost: decision.nextHostName,
      });
      this.dependencies.requestConfig();
      logger.debug("Host changed during watchdog cycle; skipping DOM restart");
      return;
    }

    if (decision.type === "node-changed") {
      logger.warn("Observed root node changed; restarting runtime", {
        runtimeEnabled: decision.runtimeEnabled,
      });
      if (decision.runtimeEnabled) {
        this.dependencies.restartRuntime();
      }
      this.dependencies.setObservedNode(decision.nextObservedNode);
    }
  }

  scheduleWatchDogCheck(): void {
    if (this.watchDogTimeoutId !== null) {
      window.clearTimeout(this.watchDogTimeoutId);
    }
    this.watchDogTimeoutId = window.setTimeout(() => {
      this.watchDogTimeoutId = null;
      this.dependencies.watchDogRunner();
    }, this.debounceMs);
  }

  private attachRootNodeObserver(): void {
    if (this.rootNodeObserver) {
      return;
    }
    this.rootNodeObserver = new MutationObserver(() => {
      this.scheduleWatchDogCheck();
    });
    this.rootNodeObserver.observe(document.documentElement, {
      childList: true,
    });
  }

  private attachWatchDogEventListeners(): void {
    window.navigation?.addEventListener("navigate", this.scheduleWatchDogCheckBound);
    window.addEventListener("pageshow", this.scheduleWatchDogCheckBound);
    window.addEventListener("popstate", this.scheduleWatchDogCheckBound);
    window.addEventListener("hashchange", this.scheduleWatchDogCheckBound);
    window.addEventListener("focus", this.scheduleWatchDogCheckBound, true);
    document.addEventListener("visibilitychange", this.scheduleWatchDogCheckBound);
    document.addEventListener("readystatechange", this.scheduleWatchDogCheckBound);
  }
}
