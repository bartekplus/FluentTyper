import { MAX_NUM_SUGGESTIONS } from "./constants";
import { isObjectRecord } from "./guards";

export interface SiteProfile {
  language: string;
  numSuggestions?: number;
  inline_suggestion?: boolean;
  preferNativeAutocomplete?: boolean;
  codeMode?: boolean;
}

export type SiteProfiles = Record<string, SiteProfile>;

export function normalizeDomainHost(domainOrUrl: string): string | undefined {
  if (typeof domainOrUrl !== "string") {
    return undefined;
  }

  const trimmed = domainOrUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  const parseHostName = (value: string): string | undefined => {
    try {
      return new URL(value).hostname;
    } catch {
      return undefined;
    }
  };

  const hostName = parseHostName(trimmed) || parseHostName(`http://${trimmed}`);
  if (!hostName) {
    return undefined;
  }

  const normalized = hostName.toLowerCase().replace(/\.+$/, "");
  return normalized || undefined;
}

function normalizeNumSuggestions(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(value)));
}

function normalizeLanguage(value: unknown, enabledLanguages: string[]): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "auto_detect") {
    return undefined;
  }
  return enabledLanguages.includes(trimmed) ? trimmed : undefined;
}

function sanitizeSiteProfile(
  profileRaw: unknown,
  enabledLanguages: string[],
): SiteProfile | undefined {
  if (!isObjectRecord(profileRaw)) {
    return undefined;
  }
  const language = normalizeLanguage(profileRaw.language, enabledLanguages);
  if (!language) {
    return undefined;
  }
  const siteProfile: SiteProfile = { language };
  const numSuggestions = normalizeNumSuggestions(profileRaw.numSuggestions);
  if (typeof numSuggestions === "number") {
    siteProfile.numSuggestions = numSuggestions;
  }
  if (typeof profileRaw.inline_suggestion === "boolean") {
    siteProfile.inline_suggestion = profileRaw.inline_suggestion;
  }
  if (typeof profileRaw.preferNativeAutocomplete === "boolean") {
    siteProfile.preferNativeAutocomplete = profileRaw.preferNativeAutocomplete;
  }
  if (typeof profileRaw.codeMode === "boolean") {
    siteProfile.codeMode = profileRaw.codeMode;
  }
  return siteProfile;
}

export function resolveSiteProfiles(
  profilesRaw: unknown,
  enabledLanguages: string[],
): SiteProfiles {
  if (!isObjectRecord(profilesRaw)) {
    return {};
  }
  const resolvedProfiles: SiteProfiles = {};
  for (const [domainKey, profileRaw] of Object.entries(profilesRaw)) {
    const normalizedDomain = normalizeDomainHost(domainKey);
    if (!normalizedDomain) {
      continue;
    }
    const sanitized = sanitizeSiteProfile(profileRaw, enabledLanguages);
    if (sanitized) {
      resolvedProfiles[normalizedDomain] = sanitized;
    }
  }
  return resolvedProfiles;
}

export function getSiteProfileForDomain(
  profilesRaw: unknown,
  domainOrUrl: string,
  enabledLanguages: string[],
): SiteProfile | undefined {
  const normalizedDomain = normalizeDomainHost(domainOrUrl);
  if (!normalizedDomain) {
    return undefined;
  }
  return resolveSiteProfiles(profilesRaw, enabledLanguages)[normalizedDomain];
}

export function setSiteProfileForDomain(
  profilesRaw: unknown,
  domainOrUrl: string,
  profileRaw: unknown,
  enabledLanguages: string[],
): SiteProfiles {
  const normalizedDomain = normalizeDomainHost(domainOrUrl);
  const siteProfile = sanitizeSiteProfile(profileRaw, enabledLanguages);
  const resolvedProfiles = resolveSiteProfiles(profilesRaw, enabledLanguages);
  if (!normalizedDomain || !siteProfile) {
    return resolvedProfiles;
  }
  resolvedProfiles[normalizedDomain] = siteProfile;
  return resolvedProfiles;
}

export function removeSiteProfileForDomain(
  profilesRaw: unknown,
  domainOrUrl: string,
  enabledLanguages: string[],
): SiteProfiles {
  const normalizedDomain = normalizeDomainHost(domainOrUrl);
  const resolvedProfiles = resolveSiteProfiles(profilesRaw, enabledLanguages);
  if (!normalizedDomain) {
    return resolvedProfiles;
  }
  delete resolvedProfiles[normalizedDomain];
  return resolvedProfiles;
}
