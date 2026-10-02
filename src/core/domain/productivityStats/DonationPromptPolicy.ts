import type {
  DonationPromptAction,
  DonationPromptSummary,
  ProductivityMetricSummary,
  WeeklyRecapSummary,
} from "@core/domain/messageTypes";
import {
  DONATION_FIRST_VALUE_ACCEPTS,
  DONATION_FIRST_VALUE_MINUTES,
  DONATION_MILESTONE_HOURS,
  DONATION_PROMPT_COOLDOWN_DAYS,
  DONATION_SNOOZE_DAYS,
} from "./constants";
import type { StatsSanitizer } from "./StatsSanitizer";
import type { ProductivityStatsState } from "./types";

export class DonationPromptPolicy {
  constructor(private readonly sanitizer: StatsSanitizer) {}

  toDonationPrompt(
    state: ProductivityStatsState,
    lifetime: ProductivityMetricSummary,
    now: Date,
    weeklyRecap: WeeklyRecapSummary,
    shouldShowWeeklyRecapCard: boolean,
  ): DonationPromptSummary | null {
    if (state.donationPromptsDisabled) return null;

    const snoozedUntilDate = this.sanitizer.parseIsoDate(state.donationSnoozedUntil);
    if (snoozedUntilDate && now < snoozedUntilDate) {
      return null;
    }

    // Weekly recap cards reuse the same donation surface, so they take priority.
    if (shouldShowWeeklyRecapCard) {
      return {
        promptId: `weekly_recap_${weeklyRecap.weekKey}`,
        kind: "weekly_recap",
        milestoneHours:
          weeklyRecap.milestonesCrossedHours[weeklyRecap.milestonesCrossedHours.length - 1] || null,
      };
    }

    const lastPromptDate = this.sanitizer.parseIsoDate(state.lastDonationPromptAt);
    if (lastPromptDate) {
      const cooldownEndsAt = this.sanitizer.addDaysFromDateTime(
        lastPromptDate,
        DONATION_PROMPT_COOLDOWN_DAYS,
      );
      if (now < cooldownEndsAt) {
        return null;
      }
    }

    if (
      !state.firstValuePromptAcknowledged &&
      (lifetime.acceptedSuggestions >= DONATION_FIRST_VALUE_ACCEPTS ||
        lifetime.estimatedMinutesSaved >= DONATION_FIRST_VALUE_MINUTES)
    ) {
      // The first-value ask appears once the user has clearly seen the product save time.
      return {
        promptId: "first_value",
        kind: "first_value",
        milestoneHours: null,
      };
    }

    const savedHours = lifetime.estimatedMinutesSaved / 60;
    const nextMilestone = DONATION_MILESTONE_HOURS.find(
      (milestone) => savedHours >= milestone && !state.shownMilestones.includes(milestone),
    );
    if (!nextMilestone) {
      return null;
    }

    return {
      promptId: `milestone_${nextMilestone}`,
      kind: "milestone",
      milestoneHours: nextMilestone,
    };
  }

  applyAction(
    state: ProductivityStatsState,
    promptId: string,
    action: DonationPromptAction,
    milestoneHours: number | null,
    now: Date,
  ): void {
    if (!["shown", "snooze", "dismiss", "support_clicked"].includes(action)) return;

    state.lastDonationPromptAt = now.toISOString();

    if (action === "dismiss") {
      state.donationPromptsDisabled = true;
      return;
    }

    if (action === "shown") {
      return;
    }

    if (action === "snooze") {
      state.donationSnoozedUntil = this.sanitizer
        .addDaysFromDateTime(now, DONATION_SNOOZE_DAYS)
        .toISOString();
      return;
    }

    state.donationSnoozedUntil = null;
    if (promptId === "first_value") {
      state.firstValuePromptAcknowledged = true;
    }

    const milestone = this.sanitizer.clampCount(milestoneHours);
    if (
      DONATION_MILESTONE_HOURS.includes(milestone) &&
      !state.shownMilestones.includes(milestone)
    ) {
      state.shownMilestones.push(milestone);
      state.shownMilestones.sort((left, right) => left - right);
    }
  }
}
