import type { SettingsManager } from "@core/application/settingsManager";
import type {
  ContentScriptUsageEventContext,
  DonationPromptAction,
  ProductivityDashboardStats,
} from "@core/domain/messageTypes";
import { ProductivityStatsService } from "@core/application/productivityStats/ProductivityStatsService";

export class ProductivityStatsManager {
  private readonly service: ProductivityStatsService;

  constructor(settingsManager: SettingsManager, options: { now?: () => Date } = {}) {
    this.service = new ProductivityStatsService(settingsManager, options);
  }

  setSnippetShortcuts(textExpansions: unknown): void {
    this.service.setSnippetShortcuts(textExpansions);
  }

  async recordSuggestionAccepted(event: ContentScriptUsageEventContext): Promise<void> {
    await this.service.recordSuggestionAccepted(event);
  }

  async recordUsageEvent(event: ContentScriptUsageEventContext): Promise<void> {
    await this.service.recordUsageEvent(event);
  }

  async getDashboardStats(): Promise<ProductivityDashboardStats> {
    return this.service.getDashboardStats();
  }

  async acknowledgeWeeklyRecap(weekKey: string): Promise<void> {
    await this.service.acknowledgeWeeklyRecap(weekKey);
  }

  async acknowledgeDonationMilestone(milestoneHours: number): Promise<void> {
    await this.service.acknowledgeDonationMilestone(milestoneHours);
  }

  async handleDonationPromptAction(
    promptId: string,
    action: DonationPromptAction,
    milestoneHours: number | null,
  ): Promise<void> {
    await this.service.handleDonationPromptAction(promptId, action, milestoneHours);
  }

  async resetStats(): Promise<void> {
    await this.service.resetStats();
  }
}
