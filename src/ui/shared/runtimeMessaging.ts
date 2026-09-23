import {
  CMD_GET_AUTO_LANGUAGE_STATUS,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_POPUP_ACK_WEEKLY_RECAP,
} from "@core/domain/constants";
import type {
  PopupAckDonationMilestoneMessage,
  PopupAckWeeklyRecapMessage,
} from "@core/domain/messageTypes";

/** Callback-style sendMessage that resolves null on runtime errors or empty responses. */
export function sendRuntimeMessage<T = unknown>(message: object): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve((response as T) || null);
    });
  });
}

export async function acknowledgeWeeklyRecap(weekKey: string): Promise<void> {
  const message: PopupAckWeeklyRecapMessage = {
    command: CMD_POPUP_ACK_WEEKLY_RECAP,
    context: { weekKey },
  };
  await sendRuntimeMessage(message);
}

export async function acknowledgeDonationPrompt(
  promptId: string,
  action: "shown" | "supported" | "snooze",
  milestoneHours: number | null,
): Promise<void> {
  const message: PopupAckDonationMilestoneMessage = {
    command: CMD_POPUP_ACK_DONATION_MILESTONE,
    context: { promptId, action, milestoneHours },
  };
  await sendRuntimeMessage(message);
}

export async function fetchAutoLanguageStatus(
  context: { tabId?: number; domainURL?: string } = {},
): Promise<{ language: string; locked: boolean } | null> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      command: CMD_GET_AUTO_LANGUAGE_STATUS,
      context,
    });
    const status = (response as { status?: { language?: string; locked?: boolean } | null })
      ?.status;
    if (!status || typeof status.language !== "string" || status.language.length === 0) {
      return null;
    }
    return {
      language: status.language,
      locked: status.locked === true,
    };
  } catch {
    return null;
  }
}
