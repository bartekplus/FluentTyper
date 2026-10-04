import { beforeEach, describe, expect, test } from "bun:test";
import {
  renderAboutWorkspacePanel,
  renderSupportWorkspacePanel,
} from "../src/ui/options/AboutWorkspacePanel.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";

describe("AboutWorkspacePanel", () => {
  beforeEach(() => {
    i18n.lang = "en";
  });

  test("renders a dedicated support card with a clearly labeled external link", () => {
    const root = document.createElement("div");
    renderSupportWorkspacePanel(root);
    const supportCard = root.firstElementChild;
    expect(supportCard?.classList.contains("support-card")).toBe(true);
    expect(supportCard?.textContent).toContain("open source");
    const donate = supportCard?.querySelector("a");
    expect(donate?.textContent).toBe("Support FluentTyper");
    expect(donate?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(donate?.href).toBe("https://www.buymeacoffee.com/FluentTyper");
  });

  test("renders safe html links in the product copy and plain support links", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    renderAboutWorkspacePanel(root);

    const productLink = Array.from(root.querySelectorAll("a")).find((entry) =>
      entry.href.includes("github.com/bartekplus/FluentTyper"),
    );
    expect(productLink).not.toBeUndefined();
    expect(productLink?.textContent).toBe("GitHub");

    const supportActions = root.querySelectorAll(".support-action-link");
    expect(supportActions).toHaveLength(4);
    expect(root.textContent).toContain(i18n.get("popup_report_issue"));
    expect(root.querySelector(".support-action-icon")).toBeNull();
  });
});
