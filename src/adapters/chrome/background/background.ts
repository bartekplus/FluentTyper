import { BackgroundBootstrap } from "./bootstrap/BackgroundBootstrap";
import type { EngineLike } from "./localAi/LocalAiHost";

export { BackgroundServiceWorker } from "./BackgroundServiceWorker";

/** `localAiEngine` is null where the build ships no Local AI runtime (Firefox, tests). */
export function startBackground(localAiEngine: EngineLike | null = null): void {
  new BackgroundBootstrap(localAiEngine).register();
}
