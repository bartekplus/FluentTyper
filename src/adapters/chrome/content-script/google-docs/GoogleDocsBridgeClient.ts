import {
  DOCS_STATUSES,
  REQUEST_EVENT,
  RESPONSE_EVENT,
  parseObject,
  snapshotFrom,
  type DocsReply,
  type DocsEdit,
  type DocsStatus,
} from "./GoogleDocsModel";
const STATUSES = new Set<string>(DOCS_STATUSES);
export class GoogleDocsBridgeClient {
  private readonly pending = new Map<
    string,
    { resolve: (value: DocsReply) => void; timer: number }
  >();
  private disposed = false;
  private readonly listener = (event: Event) => {
    const value = parseObject((event as CustomEvent<unknown>).detail);
    if (!value || typeof value.id !== "string" || !STATUSES.has(value.status as string)) return;
    const request = this.pending.get(value.id);
    if (!request) return;
    const snapshot = snapshotFrom(value.snapshot);
    if (value.status === "ready" && !snapshot) return;
    window.clearTimeout(request.timer);
    this.pending.delete(value.id);
    request.resolve({
      status: value.status as DocsStatus,
      ...(snapshot ? { snapshot } : {}),
      ...(typeof value.operationId === "string" && value.operationId.length <= 100
        ? { operationId: value.operationId }
        : {}),
      ...(value.history === "applied" || value.history === "undone"
        ? { history: value.history }
        : {}),
    });
  };
  constructor() {
    document.addEventListener(RESPONSE_EVENT, this.listener);
  }
  read(): Promise<DocsReply> {
    return this.request("read");
  }
  apply(token: string, edit: DocsEdit): Promise<DocsReply> {
    return this.request("apply", { token, edit });
  }
  cancel(): void {
    if (!this.disposed)
      document.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, {
          detail: JSON.stringify({ kind: "cancel", id: crypto.randomUUID() }),
        }),
      );
  }
  dispose(): void {
    this.cancel();
    this.disposed = true;
    document.removeEventListener(RESPONSE_EVENT, this.listener);
    for (const value of this.pending.values()) {
      window.clearTimeout(value.timer);
      value.resolve({ status: "cancelled" });
    }
    this.pending.clear();
  }
  private request(kind: "read" | "apply", payload: object = {}): Promise<DocsReply> {
    if (this.disposed) return Promise.resolve({ status: "cancelled" });
    if (this.pending.size >= 2) return Promise.resolve({ status: "busy" });
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        resolve({ status: kind === "apply" ? "unverified" : "unavailable" });
      }, 3500);
      this.pending.set(id, { resolve, timer });
      document.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ id, kind, ...payload }) }),
      );
    });
  }
}
