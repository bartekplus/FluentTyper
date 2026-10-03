import { expect, test } from "bun:test";
import { frameHostname } from "../src/adapters/chrome/content-script/frameHostname";

function view(
  hostname: string,
  protocol = "https:",
  origin = "https://example.com",
  parent?: Window,
): Window {
  const value = { location: { hostname, protocol, origin }, parent } as unknown as Window;
  if (!parent) Object.assign(value, { parent: value });
  return value;
}
test("inherited canvases use the creator hostname for site settings", () => {
  const owner = view("example.com");
  expect(frameHostname(view("", "blob:", "https://example.com"))).toBe("example.com");
  expect(frameHostname(view("", "blob:", "null", owner))).toBe("example.com");
  expect(frameHostname(view("", "about:", "null", view("", "about:", "null", owner)))).toBe(
    "example.com",
  );
});
test("hostname lookup stops at an inaccessible parent", () => {
  const inaccessible = new Proxy({} as Window, {
    get() {
      throw new Error("Cross-origin access is unavailable.");
    },
  });
  expect(frameHostname(view("", "about:", "null", inaccessible))).toBe("");
});
