import { DEFAULT_LOCAL_AI_REVIEW_ENABLED } from "@core/domain/constants";
import type { SettingsSchema } from "@core/domain/contracts/settings";
import {
  DEFAULT_LOCAL_AI_TIER,
  localAiModelById,
  type LocalAiModelTier,
} from "@core/domain/localAi/modelRegistry";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

export type LocalAiReviewConsent = NonNullable<SettingsSchema["localAiReviewConsent"]>;

/**
 * Local AI Review settings. Consent is read only from its own key: the legacy
 * predictor keys (`aiPredictorEnabled`, `aiModelId`, ...) never imply consent.
 */
export class LocalAiSettingsRepository extends SettingsRepositoryBase {
  /** The preference; absent means on, an explicit `false` stays off. */
  async getLocalAiReviewEnabled(): Promise<boolean> {
    const value = await this.getField("localAiReviewEnabled");
    return typeof value === "boolean" ? value : DEFAULT_LOCAL_AI_REVIEW_ENABLED;
  }

  async getLocalAiReviewTier(): Promise<LocalAiModelTier> {
    const value = await this.getField("localAiReviewTier");
    return value === "standard" || value === "quality" ? value : DEFAULT_LOCAL_AI_TIER;
  }

  async setLocalAiReviewTier(tier: LocalAiModelTier): Promise<void> {
    await this.setField("localAiReviewTier", tier);
  }

  /** A consent record naming a registry model of the recorded tier, else null. */
  async getLocalAiReviewConsent(): Promise<LocalAiReviewConsent | null> {
    const value: unknown = await this.getField("localAiReviewConsent");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const { modelId, tier, at } = value as Record<string, unknown>;
    const model = localAiModelById(modelId);
    if (!model || model.tier !== tier || typeof at !== "number" || !Number.isFinite(at)) {
      return null;
    }
    return { modelId: model.modelId, tier: model.tier, at };
  }

  /** Written only by the explicit Install action; `null` revokes consent. */
  async setLocalAiReviewConsent(consent: LocalAiReviewConsent | null): Promise<void> {
    await this.setField("localAiReviewConsent", consent);
  }

  async getLocalAiSetupOfferDismissed(): Promise<boolean> {
    return (await this.getField("localAiSetupOfferDismissed")) === true;
  }

  async setLocalAiSetupOfferDismissed(dismissed: boolean): Promise<void> {
    await this.setField("localAiSetupOfferDismissed", dismissed);
  }
}
