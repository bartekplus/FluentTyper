import { BackgroundBootstrap } from "./bootstrap/BackgroundBootstrap";

export { BackgroundServiceWorker } from "./BackgroundServiceWorker";

new BackgroundBootstrap().register();
