import { afterEach, beforeEach, expect, test } from "bun:test";
import { mountPreferredTerminology } from "../src/ui/options/PreferredTerminologyPanel";
import { KEY_PREFERRED_TERMINOLOGY } from "../src/core/domain/constants";
import type { SettingsRegistry } from "../src/ui/settings-engine/SettingsEngine";
import {
  emptyTerminology,
  type PreferredTerminology,
} from "../src/core/domain/grammar/review/preferredTerminology";
import { i18n } from "../src/ui/options/fluenttyperI18n";

let root: HTMLElement;
let value: PreferredTerminology;
let writes: number;
let originalLang: string;
beforeEach(() => {
  originalLang = i18n.lang;
  i18n.lang = "en";
  value = emptyTerminology();
  writes = 0;
  root = document.createElement("div");
  document.body.append(root);
  const handlers: Array<() => void> = [];
  const control = {
    get: () => value,
    set: (next: PreferredTerminology) => {
      value = next;
      writes++;
      handlers.forEach((h) => h());
    },
    addEvent: (_: string, handler: () => void) => handlers.push(handler),
  };
  mountPreferredTerminology(root, {
    [KEY_PREFERRED_TERMINOLOGY]: control,
  } as unknown as SettingsRegistry);
});
afterEach(() => {
  root.remove();
  i18n.lang = originalLang;
});
const input = (name: string) => root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const click = (action: string) =>
  root.querySelector<HTMLButtonElement>(`[data-terms-action="${action}"]`)!.click();
const submit = () =>
  root
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
function fill(
  source = "Acme Suite",
  replacement = "Acme Workspace",
  explanation = "Our preferred name.",
) {
  input("source").value = source;
  input("replacement").value = replacement;
  input("explanation").value = explanation;
}

test("entry CRUD keeps stable IDs, defaults off and leaves explicit enablement to the user", () => {
  fill();
  submit();
  expect(value.entries).toHaveLength(1);
  expect(value.enabled).toBe(false);
  const id = value.entries[0].id;
  expect(value.entries[0]).toMatchObject({
    source: "Acme Suite",
    replacement: "Acme Workspace",
    enabled: true,
    casePolicy: "exact",
    scope: "all-prose",
    language: "en_US",
  });
  click("edit");
  input("replacement").value = "Acme Tools";
  submit();
  expect(value.entries[0].id).toBe(id);
  expect(value.entries[0].replacement).toBe("Acme Tools");
  click("enabled");
  expect(value.enabled).toBe(true);
  click("remove");
  expect(value.entries).toEqual([]);
  expect(writes).toBe(4);
});

test("invalid, duplicate and cyclic entries never reach storage", () => {
  submit();
  expect(writes).toBe(0);
  expect(root.querySelector('[role="status"]')!.textContent).toContain("Check all fields");
  fill("A", "B");
  submit();
  fill("A", "C");
  submit();
  expect(writes).toBe(1);
  expect(root.querySelector('[role="status"]')!.textContent).toContain("conflicting source");
  fill("B", "A");
  submit();
  expect(writes).toBe(1);
  expect(root.querySelector('[role="status"]')!.textContent).toContain("correct one another");
});

test("HTML-like authored text is shown as text, and cancel does not save a draft", () => {
  fill("Acme (old)", "<img src=x>", '<script>alert("x")</script>');
  submit();
  expect(root.querySelector("img,script")).toBeNull();
  expect(root.textContent).toContain("<img src=x>");
  click("edit");
  input("replacement").value = "Draft";
  click("cancel");
  expect(value.entries[0].replacement).toBe("<img src=x>");
  expect(input("source").value).toBe("");
});

async function importFile(file: { size: number; text: () => Promise<string> }) {
  const field = root.querySelector<HTMLInputElement>('[data-terms-action="import-file"]')!;
  Object.defineProperty(field, "files", { configurable: true, value: [file] });
  field.dispatchEvent(new Event("change", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
}

test("imports are bounded before reading, validated as a whole, and retain authored IDs", async () => {
  let reads = 0;
  await importFile({
    size: 65537,
    text: async () => {
      reads++;
      return "{}";
    },
  });
  expect(reads).toBe(0);
  expect(writes).toBe(0);
  await importFile({ size: 5, text: async () => "bad" });
  expect(writes).toBe(0);
  fill();
  submit();
  const exported = JSON.stringify(value);
  click("remove");
  await importFile({ size: exported.length, text: async () => exported });
  expect(JSON.stringify(value)).toBe(exported);
  expect(writes).toBe(3);
});

test("an asynchronous import cannot overwrite a newer saved edit", async () => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => {
    resolve = done;
  });
  const importing = importFile({ size: 100, text: () => pending });
  fill();
  submit();
  resolve(JSON.stringify(emptyTerminology()));
  await importing;
  await Promise.resolve();
  await Promise.resolve();
  expect(value.entries).toHaveLength(1);
  expect(root.querySelector('[role="status"]')!.textContent).toContain("Settings changed");
});

test("export downloads only the validated authored configuration as JSON", async () => {
  fill();
  submit();
  const blobs: Blob[] = [];
  let filename = "";
  const proto = Object.getPrototypeOf(document.createElement("a")) as HTMLAnchorElement;
  const create = window.URL.createObjectURL;
  const revoke = window.URL.revokeObjectURL;
  const timeout = window.setTimeout;
  const anchorClick = proto.click;
  try {
    window.URL.createObjectURL = (blob) => {
      blobs.push(blob as Blob);
      return "blob:terms-test";
    };
    window.URL.revokeObjectURL = () => undefined;
    window.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") handler();
      return 1;
    }) as typeof window.setTimeout;
    proto.click = function () {
      filename = this.download;
    };
    click("export");
    expect(blobs).toHaveLength(1);
    expect(filename).toBe("fluenttyper-terminology.json");
    expect(JSON.parse(await blobs[0].text())).toEqual(value);
  } finally {
    window.URL.createObjectURL = create;
    window.URL.revokeObjectURL = revoke;
    window.setTimeout = timeout;
    proto.click = anchorClick;
  }
});

test("terminology controls and validation errors are localized in all nine UI languages", () => {
  for (const lang of ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"]) {
    i18n.lang = lang;
    const localized = document.createElement("div");
    root.append(localized);
    mountPreferredTerminology(localized, {
      [KEY_PREFERRED_TERMINOLOGY]: {
        get: () => emptyTerminology(),
        set: () => {
          throw Error("invalid form must not save");
        },
        addEvent: () => undefined,
      },
    } as unknown as SettingsRegistry);
    const title = localized.querySelector("h4")!.textContent;
    expect(title).toBeTruthy();
    if (lang !== "en") expect(title).not.toBe("Preferred terminology");
    localized.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(localized.querySelector('[role="status"]')!.textContent).toBeTruthy();
    expect(localized.querySelectorAll("label")).toHaveLength(9);
  }
});
