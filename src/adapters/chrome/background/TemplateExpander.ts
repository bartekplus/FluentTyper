import { resolveDynamicVariable } from "@core/domain/variables";

export interface TemplateVariables {
  [key: string]: string;
}

const TEMPLATE_REGEX = /\$\{(?!\d)[a-zA-Z0-9_æøåÆØÅ]+(?::[^}]+)?\}/g;
const TEMPLATE_SPLIT_REGEX = /\$\{(?!\d)[a-zA-Z0-9_æøåÆØÅ]+(?::[^}]+)?\}/;
const TEMPLATE_ARG_REGEX = /[^{}]+(?=})/g;

export class TemplateExpander {
  static async parseStringTemplateAsync(
    str: string,
    resolver: (fullVarName: string) => Promise<string | undefined>,
  ): Promise<string> {
    const parts = str.split(TEMPLATE_REGEX);
    const argsMatches = str.match(TEMPLATE_REGEX) || [];

    const parameters = await Promise.all(
      argsMatches.map(async (match) => {
        const argument = match.slice(2, -1);
        const resolved = await resolver(argument);
        return resolved !== undefined ? resolved : match;
      }),
    );

    return String.raw({ raw: parts }, ...parameters);
  }

  static parseStringTemplate(str: string, obj: TemplateVariables): string {
    const parts = str.split(TEMPLATE_SPLIT_REGEX);
    const args = str.match(TEMPLATE_ARG_REGEX) || [];
    const parameters = args.map(
      (argument) =>
        obj[argument] || (obj[argument] === undefined ? `\${${argument}}` : obj[argument]),
    );
    return String.raw({ raw: parts }, ...parameters);
  }

  static createResolver(
    lang: string,
    timeFormat: string,
    dateFormat: string,
    tabId?: number,
  ): (fullVarName: string) => Promise<string | undefined> {
    return async (fullVarName: string) => {
      const colonIdx = fullVarName.indexOf(":");
      let varName = fullVarName;
      let arg: string | undefined = undefined;

      if (colonIdx > -1) {
        varName = fullVarName.slice(0, colonIdx);
        arg = fullVarName.slice(colonIdx + 1);
      }

      try {
        const stdVar = resolveDynamicVariable(varName, arg, lang, timeFormat, dateFormat);
        if (stdVar !== undefined) {
          return stdVar;
        }
      } catch (e) {
        console.warn(`Failed to resolve variable ${varName}`, e);
      }

      const pageVariable = await TemplateExpander.resolvePageVariable(varName, tabId);
      if (pageVariable !== undefined) {
        return pageVariable;
      }

      return undefined;
    };
  }

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

  private static async resolvePageVariable(
    varName: string,
    tabId?: number,
  ): Promise<string | undefined> {
    if (
      !["page_url", "page_title", "page_domain"].includes(varName) ||
      typeof chrome === "undefined" ||
      !chrome.tabs ||
      !tabId
    ) {
      return undefined;
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      if (varName === "page_url") {
        return tab.url || "";
      }
      if (varName === "page_title") {
        return tab.title || "";
      }
      if (varName === "page_domain") {
        if (!tab.url) {
          return "";
        }
        try {
          return new URL(tab.url).hostname;
        } catch {
          return "";
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch tab data for ${varName}`, error);
    }
    return undefined;
  }
}
