import type { SiteProfiles } from "@core/domain/siteProfiles";
import { resolveSiteProfiles } from "@core/domain/siteProfiles";
import { resolveEnabledLanguages } from "@core/domain/lang";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

export class SiteProfileRepository extends SettingsRepositoryBase {
  async getRawSiteProfiles(): Promise<unknown> {
    return this.getField("siteProfiles");
  }

  async getSiteProfiles(): Promise<SiteProfiles> {
    const [rawProfiles, rawEnabledLanguages] = await Promise.all([
      this.getRawSiteProfiles(),
      this.getField("enabledLanguages"),
    ]);
    const enabledLanguages = resolveEnabledLanguages(rawEnabledLanguages);
    return resolveSiteProfiles(rawProfiles, enabledLanguages);
  }

  async setSiteProfiles(profiles: SiteProfiles): Promise<void> {
    await this.setField("siteProfiles", profiles);
  }
}
