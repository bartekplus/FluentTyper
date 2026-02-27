import type { SiteProfiles } from "@core/domain/siteProfiles";
import { resolveSiteProfiles } from "@core/domain/siteProfiles";
import { resolveEnabledLanguages } from "@core/domain/lang";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

export class SiteProfileRepository extends SettingsRepositoryBase {
  async getSiteProfiles(): Promise<SiteProfiles> {
    const [rawProfiles, rawEnabledLanguages] = await Promise.all([
      this.getField("siteProfiles"),
      this.getField("enabledLanguages"),
    ]);
    const enabledLanguages = resolveEnabledLanguages(rawEnabledLanguages);
    return resolveSiteProfiles(rawProfiles, enabledLanguages);
  }

  async setSiteProfiles(profiles: SiteProfiles): Promise<void> {
    await this.setField("siteProfiles", profiles);
  }
}
