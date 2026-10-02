import { sanitizeFieldPreferences, type FieldPreference } from "@core/domain/fieldPreferences";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

export class FieldPreferenceRepository extends SettingsRepositoryBase {
  async read(): Promise<FieldPreference[]> {
    return sanitizeFieldPreferences(await this.getField("fieldPreferences"));
  }
  async write(records: FieldPreference[]): Promise<void> {
    await this.setField("fieldPreferences", records);
  }
}
