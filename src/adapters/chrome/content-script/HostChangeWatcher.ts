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
// Keep watchdog responsive while coalescing bursts of SPA/navigation lifecycle events.
const HOST_CHANGE_WATCHDOG_DEBOUNCE_MS = 250;

export class HostChangeWatcher {
  private watchDogTimeoutId: number | null = null;
  private rootNodeObserver: MutationObserver | null = null;
  private hostName = window.location.hostname;
  private readonly scheduleWatchDogCheckBound = this.scheduleWatchDogCheck.bind(this);

  constructor(
    private readonly dependencies: HostChangeWatcherDependencies,
    private readonly debounceMs = HOST_CHANGE_WATCHDOG_DEBOUNCE_MS,
  ) {}

  start(): void {
    this.attachRootNodeObserver();
    this.attachWatchDogEventListeners();
    this.scheduleWatchDogCheck();
  }

  stop(): void {
    if (this.watchDogTimeoutId !== null) {
      window.clearTimeout(this.watchDogTimeoutId);
      this.watchDogTimeoutId = null;
    }
    if (this.rootNodeObserver) {
      this.rootNodeObserver.disconnect();
      this.rootNodeObserver = null;
    }
    this.detachWatchDogEventListeners();
  }

  getHostName(): string {
    return this.hostName;
  }

  setHostName(hostName: string): void {
    this.hostName = hostName;
  }

  checkHostName(): boolean {
    const currentHostName = window.location.hostname;
    if (this.hostName === currentHostName) {
      return false;
    }
    const previousHostName = this.hostName;
    this.hostName = currentHostName;
    logger.info("Host changed; refetching config", {
      previousHost: previousHostName,
      nextHost: currentHostName,
    });
    this.dependencies.requestConfig();
    return true;
  }

  watchDog(): void {
    // A host change already triggers a config refetch; restarting the DOM runtime on
    // top of it would race the incoming config.
    if (this.checkHostName()) {
      logger.debug("Host changed during watchdog cycle; skipping DOM restart");
      return;
    }

    const currentNode = document.body || document.documentElement;
    if (this.dependencies.getObservedNode() === currentNode) {
      return;
    }

    const runtimeEnabled = this.dependencies.isRuntimeEnabled();
    logger.warn("Observed root node changed; restarting runtime", { runtimeEnabled });
    if (runtimeEnabled) {
      this.dependencies.restartRuntime();
    }
    this.dependencies.setObservedNode(currentNode);
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

  private detachWatchDogEventListeners(): void {
    window.navigation?.removeEventListener("navigate", this.scheduleWatchDogCheckBound);
    window.removeEventListener("pageshow", this.scheduleWatchDogCheckBound);
    window.removeEventListener("popstate", this.scheduleWatchDogCheckBound);
    window.removeEventListener("hashchange", this.scheduleWatchDogCheckBound);
    window.removeEventListener("focus", this.scheduleWatchDogCheckBound, true);
    document.removeEventListener("visibilitychange", this.scheduleWatchDogCheckBound);
    document.removeEventListener("readystatechange", this.scheduleWatchDogCheckBound);
  }
}
