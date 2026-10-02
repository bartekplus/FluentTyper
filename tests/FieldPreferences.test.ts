import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sanitizeFieldPreferences } from "../src/core/domain/fieldPreferences";
import {
  fieldSignatureSource,
  hashFieldSignature,
} from "../src/adapters/chrome/content-script/suggestions/FieldSignature";
import { FieldPreferenceService } from "../src/adapters/chrome/background/FieldPreferenceService";
import { FieldPreferenceRepository } from "../src/core/application/repositories/FieldPreferenceRepository";
import type { SettingsManager } from "../src/core/application/settingsManager";

const signature = "a".repeat(64);
const record = {
  version: 1,
  enabled: true,
  topOrigin: "https://example.com",
  frameOrigin: "https://frame.example.com",
  signature,
  label: "Writing field",
};
const sender = {
  tab: { id: 1, url: "https://example.com/private?secret=yes" },
  origin: "https://frame.example.com",
  url: "https://frame.example.com/edit?token=secret",
} as chrome.runtime.MessageSender;
const options = {
  url: "chrome-extension://test/options.html",
  tab: { id: 2 },
} as chrome.runtime.MessageSender;

let previousChrome: unknown;
afterEach(() => {
  Object.assign(globalThis, { chrome: previousChrome });
});
beforeEach(() => {
  previousChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
  document.body.innerHTML = "";
  Object.assign(globalThis, {
    chrome: { runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } },
  });
});

test("signatures reject unstable and duplicate anchors and never include typed text", async () => {
  document.body.innerHTML = '<form id="compose"><input id="subject" value="private text"></form>';
  const input = document.querySelector("input")!;
  const source = fieldSignatureSource(input)!;
  expect(source).not.toContain("private text");
  expect(await hashFieldSignature(source)).toMatch(/^[a-f0-9]{64}$/);
  input.value = "changed";
  expect(fieldSignatureSource(input)).toBe(source);
  input.setAttribute("autocomplete", "section-account-123 on");
  expect(fieldSignatureSource(input)).toBe(source);
  const duplicate = input.cloneNode() as HTMLElement;
  document.body.append(duplicate);
  expect(fieldSignatureSource(input)).toBeNull();
  duplicate.remove();
  input.id = "subject-123";
  expect(fieldSignatureSource(input)).toBeNull();
});

test("shadow hosts and form anchors are required and distinguish fields", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<input id="subject">';
  const input = root.querySelector("input")!;
  expect(fieldSignatureSource(input)).toBeNull();
  host.id = "composer";
  expect(fieldSignatureSource(input)).toContain("composer");
  const source = fieldSignatureSource(input);
  host.id = "reply";
  expect(fieldSignatureSource(input)).not.toBe(source);
});

test("invalid stored records are discarded and extra data is stripped", () => {
  expect(
    sanitizeFieldPreferences([
      record,
      record,
      { ...record, version: 2 },
      { ...record, signature: "bad" },
      { ...record, topOrigin: "https://example.com/path" },
    ]),
  ).toEqual([record]);
  expect(sanitizeFieldPreferences([{ ...record, text: "private" }])).toEqual([record]);
});

describe("background field preferences", () => {
  function setup(initial: unknown = []) {
    let stored = initial;
    const settings = {
      get: async () => stored,
      getRaw: async () => stored,
      set: async (_: string, value: unknown) => {
        stored = value;
      },
    } as unknown as SettingsManager;
    const repository = new FieldPreferenceRepository(settings);
    const service = new FieldPreferenceService();
    const call = (request: unknown, from = sender) =>
      service.handle(request, from, repository, async () => {});
    return { call, stored: () => stored };
  }
  test("HTTP hashing uses the secure background without persisting raw anchors", async () => {
    const { call, stored } = setup();
    const source = JSON.stringify(["1", "INPUT", "text", "", "email", "id:recipient"]);
    const response = await call({ action: "hash", source });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    expect(response.signature).toBe(await hashFieldSignature(source));
    expect(stored()).toEqual([]);
    expect((await call({ action: "hash", source: "bad" })).ok).toBe(false);
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
    const send = chrome.runtime.sendMessage;
    try {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
      chrome.runtime.sendMessage = (async () => response) as typeof chrome.runtime.sendMessage;
      expect(await hashFieldSignature(source)).toBe(response.signature);
    } finally {
      Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      chrome.runtime.sendMessage = send;
    }
  });

  test("trusted origin scope, serialization, no raw URLs and settings-only management", async () => {
    const { call, stored } = setup();
    const results = await Promise.all([
      call({ action: "enable", signature, label: "Subject", topOrigin: "https://evil.example" }),
      call({ action: "enable", signature: "b".repeat(64), label: "Reply" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(stored()).toHaveLength(2);
    expect(JSON.stringify(stored())).not.toContain("secret");
    expect(JSON.stringify(stored())).not.toContain("evil");
    expect(await call({ action: "list" }, { ...sender, origin: "https://other.example" })).toEqual({
      ok: true,
      records: [],
    });
    expect((await call({ action: "clear", topOrigin: record.topOrigin })).ok).toBe(false);
    expect((await call({ action: "rename", ...record, label: "My subject" }, options)).ok).toBe(
      true,
    );
    expect((stored() as (typeof record)[])[0].label).toBe("My subject");
    expect((await call({ action: "clear", topOrigin: record.topOrigin }, options)).ok).toBe(true);
    expect(stored()).toEqual([]);
  });
  test("opaque senders, malformed requests, storage limits and errors fail safely", async () => {
    const { call } = setup(
      Array.from({ length: 100 }, (_, i) => ({
        ...record,
        signature: i.toString(16).padStart(64, "0"),
      })),
    );
    expect((await call({ action: "enable", signature, label: "Field" })).ok).toBe(false);
    expect((await call({ action: "list" }, { ...sender, origin: "null" })).ok).toBe(false);
    expect((await call({ action: "enable", signature: "x", label: "Field" })).ok).toBe(false);
    const service = new FieldPreferenceService();
    const failing = {
      read: async () => {
        throw new Error("storage");
      },
    } as unknown as FieldPreferenceRepository;
    expect((await service.handle({ action: "list" }, sender, failing, async () => {})).ok).toBe(
      false,
    );
  });
});
