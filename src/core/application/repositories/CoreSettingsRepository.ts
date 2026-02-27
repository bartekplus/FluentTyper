import { DEFAULT_NUM_SUGGESTIONS } from "@core/domain/constants";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

export class CoreSettingsRepository extends SettingsRepositoryBase {
  async isEnabled(): Promise<boolean> {
    return Boolean(await this.getField("enabled"));
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.setField("enabled", enabled);
  }

  async getLanguage(): Promise<string> {
    return (await this.getField("language")) || "en_US";
  }

  async setLanguage(language: string): Promise<void> {
    await this.setField("language", language);
  }

  async getEnabledLanguages(): Promise<string[]> {
    const enabledLanguages = await this.getField("enabledLanguages");
    return Array.isArray(enabledLanguages)
      ? enabledLanguages.filter((lang): lang is string => typeof lang === "string")
      : [];
  }

  async getNumSuggestions(): Promise<number> {
    const value = await this.getField("numSuggestions");
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.round(value))
      : DEFAULT_NUM_SUGGESTIONS;
  }

  async getInlineSuggestion(): Promise<boolean> {
    return Boolean(await this.getField("inlineSuggestion"));
  }

  async getDomainListMode(): Promise<string> {
    return (await this.getField("domainListMode")) || "blackList";
  }

  async getDomainList(): Promise<string[]> {
    const list = await this.getField("domainList");
    return Array.isArray(list)
      ? list.map((item) => String(item))
      : [];
  }

  async setDomainList(list: string[]): Promise<void> {
    await this.setField("domainList", list);
  }
}
