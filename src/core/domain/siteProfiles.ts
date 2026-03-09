import { MAX_NUM_SUGGESTIONS } from "./constants";

export interface SiteProfile {
  language: string;
  numSuggestions?: number;
  inline_suggestion?: boolean;
  preferNativeAutocomplete?: boolean;
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

  let hostName = parseHostName(trimmed);
  if (!hostName) {
    hostName = parseHostName(`http://${trimmed}`);
  }
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
  const integerValue = Math.round(value);
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, integerValue));
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

export function sanitizeSiteProfile(
  profileRaw: unknown,
  enabledLanguages: string[],
): SiteProfile | undefined {
  if (!profileRaw || typeof profileRaw !== "object" || Array.isArray(profileRaw)) {
    return undefined;
  }
  const profile = profileRaw as Record<string, unknown>;
  const language = normalizeLanguage(profile.language, enabledLanguages);
  if (!language) {
    return undefined;
  }
  const siteProfile: SiteProfile = { language };
  const numSuggestions = normalizeNumSuggestions(profile.numSuggestions);
  if (typeof numSuggestions === "number") {
    siteProfile.numSuggestions = numSuggestions;
  }
  if (typeof profile.inline_suggestion === "boolean") {
    siteProfile.inline_suggestion = profile.inline_suggestion;
  }
  if (typeof profile.preferNativeAutocomplete === "boolean") {
    siteProfile.preferNativeAutocomplete = profile.preferNativeAutocomplete;
  }
  return siteProfile;
}

export function resolveSiteProfiles(
  profilesRaw: unknown,
  enabledLanguages: string[],
): SiteProfiles {
  if (!profilesRaw || typeof profilesRaw !== "object" || Array.isArray(profilesRaw)) {
    return {};
  }
  const profiles = profilesRaw as Record<string, unknown>;
  const resolvedProfiles: SiteProfiles = {};
  for (const [domainKey, profileRaw] of Object.entries(profiles)) {
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
  const profiles = resolveSiteProfiles(profilesRaw, enabledLanguages);
  return profiles[normalizedDomain];
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
