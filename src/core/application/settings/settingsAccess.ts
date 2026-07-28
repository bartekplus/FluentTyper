import { getSettingStorageAliases, type SettingField } from "@core/domain/contracts/settings";
import type { JsonValue, SettingsManager } from "../settingsManager";

type RawSettingsAccess = {
  getRaw?: (key: string) => Promise<unknown>;
  setRaw?: (key: string, value: JsonValue) => Promise<void>;
  removeRaw?: (key: string) => Promise<void>;
};

function getRawSettingsAccess(settings: SettingsManager): RawSettingsAccess {
  return settings;
}

export async function readRawSetting(settings: SettingsManager, key: string): Promise<unknown> {
  const maybeRawSettings = getRawSettingsAccess(settings);
  if (typeof maybeRawSettings.getRaw === "function") {
    return maybeRawSettings.getRaw(key);
  }
  return settings.get(key);
}

export async function writeRawSetting(
  settings: SettingsManager,
  key: string,
  value: JsonValue,
): Promise<void> {
  const maybeRawSettings = getRawSettingsAccess(settings);
  if (typeof maybeRawSettings.setRaw === "function") {
    await maybeRawSettings.setRaw(key, value);
    return;
  }
  await settings.set(key, value);
}

export async function removeRawSetting(settings: SettingsManager, key: string): Promise<void> {
  const maybeRawSettings = getRawSettingsAccess(settings);
  if (typeof maybeRawSettings.removeRaw === "function") {
    await maybeRawSettings.removeRaw(key);
    return;
  }
  await settings.set(key, undefined as unknown as JsonValue);
}

export async function readFirstDefinedSetting(
  settings: SettingsManager,
  keys: string[],
): Promise<unknown> {
  for (const key of keys) {
    const value = await readRawSetting(settings, key);
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

export function readStringArraySnapshot(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
