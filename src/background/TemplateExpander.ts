// TemplateExpander.ts
// Utility for template and variable expansion
import { DATE_TIME_VARIABLES } from "../shared/variables";

export interface TemplateVariables {
  [key: string]: string;
}

export class TemplateExpander {
  /**
   * Expands a string template using the provided variables.
   * @param str The template string (e.g., 'Hello ${name}!')
   * @param obj The variables object (e.g., { name: 'World' })
   * @returns The expanded string
   */
  static parseStringTemplate(str: string, obj: TemplateVariables): string {
    const parts = str.split(/\$\{(?!\d)[\wæøåÆØÅ]*\}/);
    const args = str.match(/[^{}]+(?=})/g) || [];
    const parameters = args.map(
      (argument) =>
        obj[argument] ||
        (obj[argument] === undefined ? "${" + argument + "}" : obj[argument]),
    );
    return String.raw({ raw: parts }, ...parameters);
  }

  /**
   * Expands template variables for date/time, if enabled.
   * @param lang The language code
   * @param variableExpansion Whether variable expansion is enabled
   * @param timeFormat Custom time format
   * @param dateFormat Custom date format
   * @returns Expanded variables object
   */
  static getExpandedVariables(
    lang: string,
    variableExpansion: boolean,
    timeFormat: string,
    dateFormat: string,
  ): TemplateVariables {
    const expandedTemplateVariables: TemplateVariables = {};
    if (!variableExpansion) return expandedTemplateVariables;
    expandedTemplateVariables["time"] = DATE_TIME_VARIABLES.time(
      lang,
      timeFormat,
    );
    expandedTemplateVariables["date"] = DATE_TIME_VARIABLES.date(
      lang,
      dateFormat,
    );
    return expandedTemplateVariables;
  }
}
