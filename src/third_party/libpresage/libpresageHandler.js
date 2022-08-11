import { PresageHandler } from "./presageHandler.js";

(async function () {
  const { default: modP } = await import("./libpresage.js");
  const Module = await modP();

  new PresageHandler(Module);
})();
