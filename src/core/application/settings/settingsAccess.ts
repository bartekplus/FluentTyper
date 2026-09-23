import { KEY_ENABLED_GRAMMAR_RULES } from "@core/domain/constants";
import { getSettingStorageAliases, type SettingField } from "@core/domain/contracts/settings";
import type { SettingsManager } from "../settingsManager";

export async function readFirstDefinedSetting(
  settings: SettingsManager,
  keys: string[],
): Promise<unknown> {
  for (const key of keys) {
    const value = await settings.getRaw(key);
    if (typeof value !== "undefined") {
      return value;
    }
  }
  return undefined;
}

export async function readSettingWithAliases(
  settings: SettingsManager,
  field: SettingField,
): Promise<unknown> {
  return readFirstDefinedSetting(settings, getSettingStorageAliases(field));
}

function readStringArraySnapshot(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * One-shot grammar-rule selection migration: backs up the current selection,
 * replaces it with `nextRules` when `shouldReplace` matches, then sets the marker.
 */
export async function migrateGrammarRuleSelection(
  settings: SettingsManager,
  options: {
    label: string;
    migratedKey: string;
    backupKey: string;
    shouldReplace: (snapshot: string[]) => boolean;
    nextRules: string[];
  },
): Promise<void> {
  try {
    if ((await settings.getRaw(options.migratedKey)) === true) {
      return;
    }

    const rawSnapshot = readStringArraySnapshot(await settings.getRaw(KEY_ENABLED_GRAMMAR_RULES));

    if (!Array.isArray(await settings.getRaw(options.backupKey))) {
      await settings.setRaw(options.backupKey, rawSnapshot);
    }

    if (options.shouldReplace(rawSnapshot)) {
      await settings.setRaw(KEY_ENABLED_GRAMMAR_RULES, options.nextRules);
    }
    await settings.setRaw(options.migratedKey, true);
  } catch (error) {
    console.warn(`[${options.label}] Failed to migrate settings:`, error);
  }
}
