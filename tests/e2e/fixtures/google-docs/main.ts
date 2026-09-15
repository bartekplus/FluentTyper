if (!crypto.randomUUID)
  Object.defineProperty(crypto, "randomUUID", {
    value: () =>
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
  });
import { installGoogleDocsMainWorld } from "../../../../src/adapters/chrome/content-script/google-docs/GoogleDocsMainWorld";
// Test-only URL facade. No real Docs page, private API, accounts or network are used.
// The real document, iframe, events and execution realms remain Chromium's.
const realTop = window.top!;
const topFacade: Window = new Proxy(realTop, {
  get(target, key) {
    if (key === "top") return topFacade;
    if (key === "location")
      return { href: (realTop as unknown as { fixtureScope: string }).fixtureScope };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" && !String(key).match(/^[A-Z]/) ? value.bind(target) : value;
  },
});
const facade =
  window === realTop
    ? topFacade
    : new Proxy(window, {
        get(target, key) {
          if (key === "top") return topFacade;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" && !String(key).match(/^[A-Z]/)
            ? value.bind(target)
            : value;
        },
      });
installGoogleDocsMainWorld(facade);
