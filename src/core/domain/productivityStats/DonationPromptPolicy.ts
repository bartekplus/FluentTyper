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
    const snoozedUntilDate = this.sanitizer.parseIsoDate(state.donationSnoozedUntil);
    if (snoozedUntilDate && now < snoozedUntilDate) {
      return null;
    }

    if (shouldShowWeeklyRecapCard) {
      return {
        promptId: `weekly_recap_${weeklyRecap.weekKey}`,
        kind: "weekly_recap",
        source: "weekly_recap",
        milestoneHours:
          weeklyRecap.milestonesCrossedHours[weeklyRecap.milestonesCrossedHours.length - 1] || null,
        message:
          "Your weekly recap is ready. If FluentTyper is saving you time, support development.",
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
      return {
        promptId: "first_value",
        kind: "first_value",
        source: "lifetime_threshold",
        milestoneHours: null,
        message:
          "You are saving real time already. If this helps your workflow, support FluentTyper.",
      };
    }

    const savedHours = lifetime.estimatedMinutesSaved / 60;
    const nextMilestone = DONATION_MILESTONE_HOURS.find(
      (milestone) => savedHours >= milestone && !state.shownMilestones.includes(milestone),
    );
    if (!nextMilestone) {
      return null;
    }

    const hoursLabel = nextMilestone === 1 ? "hour" : "hours";
    const ordinal = this.toOrdinal(nextMilestone);
    return {
      promptId: `milestone_${nextMilestone}`,
      kind: "milestone",
      source: "lifetime_threshold",
      milestoneHours: nextMilestone,
      message: `You just saved your ${ordinal} ${hoursLabel}. Buy the dev a coffee?`,
    };
  }

  applyAction(
    state: ProductivityStatsState,
    promptId: string,
    action: DonationPromptAction,
    milestoneHours: number | null,
    now: Date,
  ): void {
    state.lastDonationPromptAt = now.toISOString();

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

  private toOrdinal(value: number): string {
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) {
      return `${value}th`;
    }

    const mod10 = value % 10;
    if (mod10 === 1) {
      return `${value}st`;
    }
    if (mod10 === 2) {
      return `${value}nd`;
    }
    if (mod10 === 3) {
      return `${value}rd`;
    }
    return `${value}th`;
  }
}
