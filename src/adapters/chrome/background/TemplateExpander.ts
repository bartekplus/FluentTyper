// TemplateExpander.ts
// Utility for template and variable expansion
import { resolveDynamicVariable } from "@core/domain/variables";

export interface TemplateVariables {
  [key: string]: string;
}

export class TemplateExpander {
  /**
   * Expands a string template asynchronously using a resolver.
   */
  static async parseStringTemplateAsync(
    str: string,
    resolver: (fullVarName: string) => Promise<string | undefined>,
  ): Promise<string> {
    const regex = /\$\{(?!\d)[a-zA-Z0-9_æøåÆØÅ]+(?::[^}]+)?\}/g;
    const parts = str.split(regex);
    const argsMatches = str.match(regex) || [];

    const parameters = await Promise.all(
      argsMatches.map(async (match) => {
        const argument = match.slice(2, -1);
        const resolved = await resolver(argument);
        return resolved !== undefined ? resolved : match;
      }),
    );

    return String.raw({ raw: parts }, ...parameters);
  }

  /**
   * Evaluates templates synchronously if variables are pre-computed.
   */
  static parseStringTemplate(str: string, obj: TemplateVariables): string {
    const parts = str.split(/\$\{(?!\d)[a-zA-Z0-9_æøåÆØÅ]+(?::[^}]+)?\}/);
    const args = str.match(/[^{}]+(?=})/g) || [];
    const parameters = args.map(
      (argument) =>
        obj[argument] || (obj[argument] === undefined ? `\${${argument}}` : obj[argument]),
    );
    return String.raw({ raw: parts }, ...parameters);
  }

  /**
   * Generates a resolver function for the active context.
   */
  static createResolver(
    lang: string,
    timeFormat: string,
    dateFormat: string,
    tabId?: number,
  ): (fullVarName: string) => Promise<string | undefined> {
    return async (fullVarName: string) => {
      // split varName from arg
      const colonIdx = fullVarName.indexOf(":");
      let varName = fullVarName;
      let arg: string | undefined = undefined;

      if (colonIdx > -1) {
        varName = fullVarName.slice(0, colonIdx);
        arg = fullVarName.slice(colonIdx + 1);
      }

      // Check standard variables from variables.ts
      let stdVar: string | undefined = undefined;
      try {
        stdVar = resolveDynamicVariable(varName, arg, lang, timeFormat, dateFormat);
      } catch (e) {
        console.warn(`Failed to resolve variable ${varName}`, e);
      }
      if (stdVar !== undefined) {
        return stdVar;
      }

      // Check browser context variables
      if (
        ["page_url", "page_title", "page_domain"].includes(varName) &&
        typeof chrome !== "undefined" &&
        chrome.tabs &&
        tabId
      ) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (varName === "page_url") {
            return tab.url || "";
          }
          if (varName === "page_title") {
            return tab.title || "";
          }
          if (varName === "page_domain" && tab.url) {
            try {
              const urlObj = new URL(tab.url);
              return urlObj.hostname;
            } catch {
              return "";
            }
          }
        } catch (error) {
          console.warn(`Failed to fetch tab data for ${varName}`, error);
        }
      }

      return undefined;
    };
  }

  /**
   * @deprecated Used by older synchronous paths, will evaluate a fixed subset of variables.
   */
  static getExpandedVariables(
    lang: string,
    timeFormat: string,
    dateFormat: string,
  ): TemplateVariables {
    const expandedTemplateVariables: TemplateVariables = {};

    const timeVal = resolveDynamicVariable("time", undefined, lang, timeFormat, dateFormat);
    const dateVal = resolveDynamicVariable("date", undefined, lang, timeFormat, dateFormat);
    if (timeVal) {
      expandedTemplateVariables["time"] = timeVal;
    }
    if (dateVal) {
      expandedTemplateVariables["date"] = dateVal;
    }
    return expandedTemplateVariables;
  }
}
