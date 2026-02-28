import { createLogger } from "@core/application/logging/Logger";

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
  private hostName = window.location.hostname;
  private watchDogTimeoutId: number | null = null;
  private rootNodeObserver: MutationObserver | null = null;
  private readonly scheduleWatchDogCheckBound: () => void;

  constructor(
    private readonly dependencies: HostChangeWatcherDependencies,
    private readonly debounceMs = 250,
  ) {
    this.scheduleWatchDogCheckBound = this.scheduleWatchDogCheck.bind(this);
  }

  start(): void {
    this.attachRootNodeObserver();
    this.attachWatchDogEventListeners();
    this.scheduleWatchDogCheck();
  }

  getHostName(): string {
    return this.hostName;
  }

  setHostName(hostName: string): void {
    this.hostName = hostName;
  }

  checkHostName(): boolean {
    if (this.hostName !== window.location.hostname) {
      logger.info("Host changed; refetching config", {
        previousHost: this.hostName,
        nextHost: window.location.hostname,
      });
      this.hostName = window.location.hostname;
      this.dependencies.requestConfig();
      return true;
    }
    return false;
  }

  watchDog(): void {
    const currentNode = document.body || document.documentElement;
    if (this.checkHostName()) {
      logger.debug("Host changed during watchdog cycle; skipping DOM restart");
      return;
    }
    if (this.dependencies.getObservedNode() !== currentNode) {
      const runtimeEnabled = this.dependencies.isRuntimeEnabled();
      logger.warn("Observed root node changed; restarting runtime", {
        runtimeEnabled,
      });
      if (runtimeEnabled) {
        this.dependencies.restartRuntime();
      }
      this.dependencies.setObservedNode(currentNode);
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
    window.navigation?.addEventListener(
      "navigate",
      this.scheduleWatchDogCheckBound,
    );
    window.addEventListener("pageshow", this.scheduleWatchDogCheckBound);
    window.addEventListener("popstate", this.scheduleWatchDogCheckBound);
    window.addEventListener("hashchange", this.scheduleWatchDogCheckBound);
    window.addEventListener("focus", this.scheduleWatchDogCheckBound, true);
    document.addEventListener(
      "visibilitychange",
      this.scheduleWatchDogCheckBound,
    );
    document.addEventListener(
      "readystatechange",
      this.scheduleWatchDogCheckBound,
    );
  }
}
