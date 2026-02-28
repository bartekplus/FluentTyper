export type HostChangeWatcherDependencies = {
  watchDogRunner: () => void;
  getObservedNode: () => Node;
  setObservedNode: (node: Node) => void;
  isRuntimeEnabled: () => boolean;
  restartRuntime: () => void;
  requestConfig: () => void;
};

export class HostChangeWatcher {
  private static readonly LOG_PREFIX = "ContentScript";

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
      console.info(
        "[%s:%s:%s] Host name changed, re-fetching config",
        HostChangeWatcher.LOG_PREFIX,
        this.constructor.name,
        this.checkHostName.name,
      );
      this.hostName = window.location.hostname;
      this.dependencies.requestConfig();
      return true;
    }
    return false;
  }

  watchDog(): void {
    const currentNode = document.body || document.documentElement;
    if (this.checkHostName()) {
      console.debug(
        "[%s:%s:%s] Host name changed in watchDog, returning",
        HostChangeWatcher.LOG_PREFIX,
        this.constructor.name,
        this.watchDog.name,
      );
      return;
    }
    if (this.dependencies.getObservedNode() !== currentNode) {
      console.warn(
        "[%s:%s:%s] DOM node changed, restarting",
        HostChangeWatcher.LOG_PREFIX,
        this.constructor.name,
        this.watchDog.name,
      );
      if (this.dependencies.isRuntimeEnabled()) {
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
