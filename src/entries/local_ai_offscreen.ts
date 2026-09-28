import { LOCAL_AI_HOST_PORT } from "@core/domain/contracts/localAi";
import { LocalAiHost } from "@adapters/chrome/offscreen/LocalAiHost";
import { LOCAL_AI_WORKER_PATH } from "@adapters/chrome/offscreen/workerProtocol";

/** Local AI offscreen document (Chrome/Edge): hosts the engine worker and review ports. */
const host = new LocalAiHost({
  connectBackground: () => chrome.runtime.connect({ name: LOCAL_AI_HOST_PORT }),
  createWorker: () => new Worker(chrome.runtime.getURL(LOCAL_AI_WORKER_PATH)),
});

chrome.runtime.onConnect.addListener((port) => host.acceptReviewPort(port));
// After a service-worker restart the background nudges the host to reconnect its port.
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (
    !sender.tab &&
    sender.id === chrome.runtime.id &&
    (message as { type?: unknown } | null)?.type === LOCAL_AI_HOST_PORT
  ) {
    host.connect();
  }
  return false;
});
host.start();
