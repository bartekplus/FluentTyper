import { FieldPreferenceRepository } from "@core/application/repositories/FieldPreferenceRepository";
import {
  FIELD_PREFERENCE_LIMIT,
  hashFieldSource,
  isFieldLabel,
  isFieldSignature,
  webOrigin,
  type FieldPreferenceResponse,
} from "@core/domain/fieldPreferences";
import { isObjectRecord } from "@core/domain/guards";
import { serialQueue } from "@core/domain/serialQueue";
import { isExtensionPageSender } from "./extensionSender";

/** One background writer prevents simultaneous frame/settings updates losing records. */
export class FieldPreferenceService {
  private readonly queue = serialQueue();

  handle(
    raw: unknown,
    sender: chrome.runtime.MessageSender,
    repository: FieldPreferenceRepository,
    changed: () => Promise<void>,
  ): Promise<FieldPreferenceResponse> {
    return this.queue(async (): Promise<FieldPreferenceResponse> => {
      if (!isObjectRecord(raw)) return { ok: false, error: "Invalid field preference." };
      const extensionPage = isExtensionPageSender(sender);
      const topOrigin = webOrigin(sender.tab?.url);
      const frameOrigin = webOrigin(sender.origin ?? sender.url);
      if (!extensionPage && (!topOrigin || !frameOrigin || typeof sender.tab?.id !== "number"))
        return { ok: false, error: "This page cannot save field preferences." };
      if (raw.action === "hash") {
        if (extensionPage || typeof raw.source !== "string" || raw.source.length > 2048)
          return { ok: false, error: "Invalid field signature." };
        let parts: unknown;
        try {
          parts = JSON.parse(raw.source);
        } catch {
          return { ok: false, error: "Invalid field signature." };
        }
        if (
          !Array.isArray(parts) ||
          parts.length < 6 ||
          parts.length > 20 ||
          parts[0] !== "1" ||
          !parts.every((part) => typeof part === "string" && part.length <= 128)
        )
          return { ok: false, error: "Invalid field signature." };
        return { ok: true, records: [], signature: await hashFieldSource(raw.source) };
      }
      let records = await repository.read();
      const scoped = () =>
        extensionPage
          ? records
          : records.filter((r) => r.topOrigin === topOrigin && r.frameOrigin === frameOrigin);
      if (raw.action === "list") return { ok: true, records: scoped() };
      if (raw.action === "enable") {
        if (extensionPage || !isFieldSignature(raw.signature) || !isFieldLabel(raw.label))
          return { ok: false, error: "Invalid field preference." };
        if (
          !records.some(
            (r) =>
              r.topOrigin === topOrigin &&
              r.frameOrigin === frameOrigin &&
              r.signature === raw.signature,
          )
        ) {
          if (records.length >= FIELD_PREFERENCE_LIMIT)
            return {
              ok: false,
              error: "100 saved fields reached. Forget a field in Site settings first.",
            };
          records.push({
            version: 1,
            enabled: true,
            topOrigin: topOrigin!,
            frameOrigin: frameOrigin!,
            signature: raw.signature,
            label: raw.label,
          });
        }
      } else {
        if (
          !extensionPage ||
          !webOrigin(raw.topOrigin) ||
          raw.topOrigin !== webOrigin(raw.topOrigin)
        )
          return { ok: false, error: "Only extension settings can manage saved fields." };
        if (raw.action === "clear") records = records.filter((r) => r.topOrigin !== raw.topOrigin);
        else if (
          (raw.action === "rename" || raw.action === "forget") &&
          isFieldSignature(raw.signature) &&
          webOrigin(raw.frameOrigin) === raw.frameOrigin
        ) {
          if (raw.action === "rename" && !isFieldLabel(raw.label))
            return { ok: false, error: "Use a label of 1–80 characters." };
          const matches = (r: (typeof records)[number]) =>
            r.topOrigin === raw.topOrigin &&
            r.frameOrigin === raw.frameOrigin &&
            r.signature === raw.signature;
          records =
            raw.action === "forget"
              ? records.filter((r) => !matches(r))
              : records.map((r) => (matches(r) ? { ...r, label: raw.label as string } : r));
        } else return { ok: false, error: "Invalid field preference." };
      }
      await repository.write(records);
      await changed();
      return { ok: true, records: scoped() };
    }).catch((): FieldPreferenceResponse => ({
      ok: false,
      error: "Could not save field preferences. Temporary activation still works.",
    }));
  }
}
