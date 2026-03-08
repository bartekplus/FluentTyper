import { i18n } from "./fluenttyperI18n.js";

function createCard(titleText: string, bodyText: string): HTMLElement {
  const card = document.createElement("section");
  card.className = "workspace-overview-card";

  const title = document.createElement("h4");
  title.textContent = titleText;
  card.appendChild(title);

  const body = document.createElement("p");
  body.className = "settings-inline-help";
  body.textContent = bodyText;
  card.appendChild(body);

  return card;
}

export class DataDiagnosticsPanel {
  private readonly root: HTMLElement;
  private readonly isDevBuild: boolean;

  constructor(root: HTMLElement, isDevBuild: boolean) {
    this.root = root;
    this.isDevBuild = isDevBuild;
    this.render();
  }

  render(): void {
    const shell = document.createElement("div");
    shell.className = "workspace-overview-grid";

    shell.appendChild(createCard(i18n.get("options_tab_data"), i18n.get("options_tab_data_desc")));
    shell.appendChild(
      createCard(
        i18n.get("productivity_dashboard_group"),
        i18n.get("productivity_insights_subtitle"),
      ),
    );
    shell.appendChild(
      createCard(
        i18n.get("config_data"),
        `${i18n.get("import_settings_desc")} ${i18n.get("export_settings_desc")}`,
      ),
    );

    if (this.isDevBuild) {
      shell.appendChild(
        createCard(i18n.get("predictor_debug_group"), i18n.get("predictor_debug_desc")),
      );
    }

    this.root.replaceChildren(shell);
  }
}
