import type { DonationPromptAction, DonationPromptSummary } from "@core/domain/messageTypes";
import {
  CMD_GET_AUTO_LANGUAGE_STATUS,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_POPUP_ACK_WEEKLY_RECAP,
} from "@core/domain/constants";
import type {
  OptionsPageConfigChangeMessage,
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

/** Sends the message again after each delay until isValid accepts the response; resolves null if no response is valid. */
export async function sendRuntimeMessageWithRetry<T>(
  message: object,
  isValid: (response: unknown) => response is T,
  delaysMs: readonly number[],
): Promise<T | null> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await sendRuntimeMessage(message);
    if (isValid(response)) {
      return response;
    }
    if (attempt >= delaysMs.length) {
      return null;
    }
    await new Promise((resolve) => window.setTimeout(resolve, delaysMs[attempt]));
  }
}

export function notifyConfigChange(): Promise<unknown> {
  const message: OptionsPageConfigChangeMessage = {
    command: CMD_OPTIONS_PAGE_CONFIG_CHANGE,
    context: {},
  };
  return chrome.runtime.sendMessage(message);
}

export async function acknowledgeWeeklyRecap(weekKey: string): Promise<void> {
  const message: PopupAckWeeklyRecapMessage = {
    command: CMD_POPUP_ACK_WEEKLY_RECAP,
    context: { weekKey },
  };
  await sendRuntimeMessage(message);
}

export async function ackDonation(
  prompt: DonationPromptSummary,
  action: DonationPromptAction,
): Promise<void> {
  const message: PopupAckDonationMilestoneMessage = {
    command: CMD_POPUP_ACK_DONATION_MILESTONE,
    context: { promptId: prompt.promptId, action, milestoneHours: prompt.milestoneHours },
  };
  await sendRuntimeMessage(message);
}

/** Returns a function that sends "shown" one time for each new donation prompt. */
export function trackDonationPromptShown(): (prompt: DonationPromptSummary | null) => void {
  let lastPromptId: string | null = null;
  return (prompt) => {
    if (prompt && prompt.promptId !== lastPromptId) {
      void ackDonation(prompt, "shown");
    }
    lastPromptId = prompt?.promptId ?? null;
  };
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
