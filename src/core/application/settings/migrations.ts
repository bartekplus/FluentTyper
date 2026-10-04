import type { SettingsManager } from "../settingsManager";
import { migrateSettingsV3 } from "./SettingsMigrationV3";
import { migrateSettingsV4 } from "./SettingsMigrationV4";
import { migrateSettingsV5 } from "./SettingsMigrationV5";
import { migrateSettingsV6 } from "./SettingsMigrationV6";
import { migrateSettingsV7 } from "./SettingsMigrationV7";
import { migrateSettingsV8 } from "./SettingsMigrationV8";
import { migrateSettingsV9 } from "./SettingsMigrationV9";
import { migrateSettingsV10 } from "./SettingsMigrationV10";

const SETTINGS_MIGRATIONS: Array<[string, (settings: SettingsManager) => Promise<void>]> = [
  ["SettingsMigrationV3", migrateSettingsV3],
  ["SettingsMigrationV4", migrateSettingsV4],
  ["SettingsMigrationV5", migrateSettingsV5],
  ["SettingsMigrationV6", migrateSettingsV6],
  ["SettingsMigrationV7", migrateSettingsV7],
  ["SettingsMigrationV8", migrateSettingsV8],
  ["SettingsMigrationV9", migrateSettingsV9],
  ["SettingsMigrationV10", migrateSettingsV10],
];

/** Runs the migrations in order. A migration that fails is logged, and the next one runs. */
export async function runSettingsMigrations(settings: SettingsManager): Promise<void> {
  for (const [label, migrate] of SETTINGS_MIGRATIONS) {
    try {
      await migrate(settings);
    } catch (error) {
      console.warn(`[${label}] Failed to migrate settings:`, error);
    }
  }
}
