import {
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_GRAMMAR_RULES_V1_BACKUP,
  KEY_GRAMMAR_RULES_V1_MIGRATED,
} from "@core/domain/constants";
import { RECOMMENDED_V1_GRAMMAR_RULES } from "@core/domain/grammar/ruleCatalog";
import type { SettingsManager } from "../settingsManager";
import {
  areStringArraysEqual,
  readRawSetting,
  readStringArraySnapshot,
  writeRawSetting,
} from "./settingsAccess";

function shouldForceV1Defaults(rawSnapshot: string[]): boolean {
  if (rawSnapshot.length === 0) {
    return true;
  }
  return rawSnapshot.some(
    (ruleId) => ruleId === "spacingRule" || ruleId === "capitalizeFirstLetter",
  );
}

export async function migrateSettingsV4(settings: SettingsManager): Promise<void> {
  try {
    const migrated = await readRawSetting(settings, KEY_GRAMMAR_RULES_V1_MIGRATED);
    if (migrated === true) {
      return;
    }

    const existing = await readRawSetting(settings, KEY_ENABLED_GRAMMAR_RULES);
    const rawSnapshot = readStringArraySnapshot(existing);

    const backup = await readRawSetting(settings, KEY_GRAMMAR_RULES_V1_BACKUP);
    if (!Array.isArray(backup)) {
      await writeRawSetting(settings, KEY_GRAMMAR_RULES_V1_BACKUP, rawSnapshot);
    }

    const current = await readRawSetting(settings, KEY_ENABLED_GRAMMAR_RULES);
    const currentSnapshot = readStringArraySnapshot(current);
    if (areStringArraysEqual(currentSnapshot, rawSnapshot) && shouldForceV1Defaults(rawSnapshot)) {
      await writeRawSetting(settings, KEY_ENABLED_GRAMMAR_RULES, RECOMMENDED_V1_GRAMMAR_RULES);
    }
    await writeRawSetting(settings, KEY_GRAMMAR_RULES_V1_MIGRATED, true);
  } catch (error) {
    console.warn("[SettingsMigrationV4] Failed to migrate settings:", error);
  }
}
