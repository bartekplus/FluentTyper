import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AboutWorkspacePanel } from "../src/ui/options/AboutWorkspacePanel.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";

describe("AboutWorkspacePanel", () => {
  beforeEach(() => {
    i18n.lang = "en";
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  test("renders safe html links in the product copy and icon-led support actions", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    new AboutWorkspacePanel(root);

    const productLink = Array.from(root.querySelectorAll("a")).find((entry) =>
      entry.href.includes("github.com/bartekplus/FluentTyper"),
    );
    expect(productLink).not.toBeUndefined();
    expect(productLink?.textContent).toBe("GitHub");

    const supportActions = root.querySelectorAll(".support-action-link");
    expect(supportActions).toHaveLength(4);
    expect(root.textContent).toContain(i18n.get("popup_report_issue"));
    expect(root.querySelector(".support-action-icon")?.textContent).toBe("!");
  });
});
