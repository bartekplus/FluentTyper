import { SUPPORTED_LANGUAGES_SHORT_CODE, SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "./lang";

export interface AutoLanguageBrowserDetection {
  language: string;
  percentage: number;
}

export interface AutoLanguageSitePriors {
  [domain: string]: Record<string, number>;
}

export interface AutoLanguageSessionSnapshot {
  stableLanguage: string | null;
  pendingLanguage: string | null;
  pendingConfirmations: number;
  manualLockLanguage: string | null;
  switchSuppressedUntilBoundary: boolean;
}

export interface ResolveAutoLanguageDecisionInput {
  allowedLanguages: string[];
  fallbackLanguage: string;
  sampleText: string;
  browserDetections: AutoLanguageBrowserDetection[];
  documentLanguageHint?: string | null;
  pageLanguageHint?: string | null;
  sitePriorLanguage?: string | null;
  sitePriorConfidence?: number;
  inputAction?: "insert" | "delete" | "other";
  session: AutoLanguageSessionSnapshot;
}

export interface ResolveAutoLanguageDecisionResult {
  resolvedLanguage: string;
  stableLanguage: string | null;
  pendingLanguage: string | null;
  pendingConfirmations: number;
  manualLockLanguage: string | null;
  switchSuppressedUntilBoundary: boolean;
  source:
    | "manual_lock"
    | "strong_script"
    | "detection"
    | "stable"
    | "provisional_document"
    | "provisional_page"
    | "provisional_site_prior"
    | "fallback";
  changed: boolean;
  switched: boolean;
  hasQualifiedEvidence: boolean;
  sampleText: string;
  topLanguage: string | null;
  topScore: number;
  stableScore: number;
}

export const AUTO_LANGUAGE_MAX_SAMPLE_CHARS = 160;
export const AUTO_LANGUAGE_MAX_SAMPLE_TOKENS = 6;
const INITIAL_COMMIT_THRESHOLD = 0.65;
const SWITCH_THRESHOLD = 0.75;
const SWITCH_MARGIN = 0.2;
const QUALIFIED_ALPHA_THRESHOLD = 20;
const QUALIFIED_TOKEN_THRESHOLD = 3;
const DOCUMENT_HINT_BONUS = 0.15;
const PAGE_HINT_BONUS = 0.1;
const SITE_PRIOR_MAX_BONUS = 0.1;
const STICKY_BONUS = 0.05;
const GREEK_SCRIPT_REGEX = /[\u0370-\u03FF\u1F00-\u1FFF]/u;
const LETTER_REGEX = /\p{L}/u;
const TOKEN_REGEX = /\p{L}+/gu;
const BOUNDARY_REGEX = /[\s.,!?;:()[\]{}"'`~@#$%^&*+=|\\/<>_-]/;

function clampProbability(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function countAlphaChars(text: string): number {
  let count = 0;
  for (const char of text) {
    if (LETTER_REGEX.test(char)) {
      count += 1;
    }
  }
  return count;
}

function countTokens(text: string): number {
  const matches = text.match(TOKEN_REGEX);
  return matches ? matches.length : 0;
}

function resolveHintLanguage(
  language: string | null | undefined,
  allowedLanguages: string[],
): string | null {
  if (typeof language !== "string") {
    return null;
  }
  const trimmed = language.trim();
  if (!trimmed) {
    return null;
  }
  if (allowedLanguages.includes(trimmed)) {
    return trimmed;
  }
  const shortCode = trimmed.toLowerCase().split(/[_-]/)[0];
  const resolved = SUPPORTED_LANGUAGES_SHORT_CODE[shortCode];
  return resolved && allowedLanguages.includes(resolved) ? resolved : null;
}

function getStrongScriptLanguage(sampleText: string, allowedLanguages: string[]): string | null {
  if (allowedLanguages.includes("el_GR") && GREEK_SCRIPT_REGEX.test(sampleText)) {
    return "el_GR";
  }
  return null;
}

function isTokenBoundary(sampleText: string): boolean {
  const lastChar = sampleText.charAt(sampleText.length - 1);
  return !lastChar || BOUNDARY_REGEX.test(lastChar);
}

function compareCandidateScores(
  left: { language: string; score: number },
  right: { language: string; score: number },
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.language.localeCompare(right.language);
}

export function extractAutoLanguageSample(text: string): string {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }
  const lastChar = text.charAt(text.length - 1);
  const trailingBoundary = lastChar && BOUNDARY_REGEX.test(lastChar) ? lastChar : "";
  const tokens = [...text.matchAll(TOKEN_REGEX)].map((match) => match[0]);
  const limitedTokens = tokens.slice(-AUTO_LANGUAGE_MAX_SAMPLE_TOKENS);
  const tokenSample = limitedTokens.join(" ").trim();
  const textSample = text.trim();
  let source = tokenSample || textSample;
  if (source && trailingBoundary) {
    source += trailingBoundary;
  }
  if (source.length <= AUTO_LANGUAGE_MAX_SAMPLE_CHARS) {
    return source;
  }
  return source.slice(-AUTO_LANGUAGE_MAX_SAMPLE_CHARS).trimStart();
}

export function updateAutoLanguageRollingSample(
  previousSample: string,
  nextText: string,
): string {
  if (typeof nextText === "string" && nextText.length > 0) {
    return extractAutoLanguageSample(nextText);
  }
  return extractAutoLanguageSample(previousSample);
}

export function sanitizeAutoLanguageSitePriors(
  priorsRaw: unknown,
  enabledLanguages: string[],
): AutoLanguageSitePriors {
  if (!priorsRaw || typeof priorsRaw !== "object" || Array.isArray(priorsRaw)) {
    return {};
  }
  const result: AutoLanguageSitePriors = {};
  for (const [domain, entryRaw] of Object.entries(priorsRaw as Record<string, unknown>)) {
    if (!entryRaw || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
      continue;
    }
    const normalizedEntries = Object.entries(entryRaw as Record<string, unknown>)
      .filter(
        ([language, weight]) =>
          enabledLanguages.includes(language) && typeof weight === "number" && Number.isFinite(weight),
      )
      .map(([language, weight]) => [language, clampProbability(weight)] as const)
      .filter(([, weight]) => weight > 0)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3);
    if (normalizedEntries.length === 0) {
      continue;
    }
    result[domain] = Object.fromEntries(normalizedEntries);
  }
  return result;
}

export function recordAutoLanguageSitePrior(
  priorsRaw: AutoLanguageSitePriors,
  domain: string,
  language: string,
  strong: boolean,
): AutoLanguageSitePriors {
  const next = sanitizeAutoLanguageSitePriors(priorsRaw, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
  const current = { ...(next[domain] || {}) };
  for (const key of Object.keys(current)) {
    current[key] = clampProbability(current[key] * 0.9);
  }
  const increment = strong ? 0.35 : 0.15;
  current[language] = Math.min(1, clampProbability(current[language]) + increment);
  const limited = Object.entries(current)
    .filter(([, weight]) => weight > 0.01)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
  if (limited.length === 0) {
    const withoutDomain = { ...next };
    delete withoutDomain[domain];
    return withoutDomain;
  }
  next[domain] = Object.fromEntries(limited);
  return next;
}

export function getAutoLanguageSitePrior(
  priorsRaw: AutoLanguageSitePriors,
  domain: string | undefined,
  allowedLanguages: string[],
): { language: string | null; confidence: number } {
  if (!domain) {
    return { language: null, confidence: 0 };
  }
  const entry = priorsRaw[domain];
  if (!entry) {
    return { language: null, confidence: 0 };
  }
  const allowedEntry = Object.entries(entry)
    .filter(([language]) => allowedLanguages.includes(language))
    .sort((left, right) => right[1] - left[1]);
  if (allowedEntry.length === 0) {
    return { language: null, confidence: 0 };
  }
  return {
    language: allowedEntry[0][0],
    confidence: clampProbability(allowedEntry[0][1]),
  };
}

export function resolveAutoLanguageDecision(
  input: ResolveAutoLanguageDecisionInput,
): ResolveAutoLanguageDecisionResult {
  const sampleText = extractAutoLanguageSample(input.sampleText);
  const atTokenBoundary = isTokenBoundary(input.sampleText);
  const pasteLikeInput = input.inputAction === "other";
  const documentLanguageHint = resolveHintLanguage(input.documentLanguageHint, input.allowedLanguages);
  const pageLanguageHint = resolveHintLanguage(input.pageLanguageHint, input.allowedLanguages);
  const sitePriorLanguage = resolveHintLanguage(input.sitePriorLanguage, input.allowedLanguages);
  const strongScriptLanguage = getStrongScriptLanguage(sampleText, input.allowedLanguages);
  const hasQualifiedEvidence =
    Boolean(strongScriptLanguage) ||
    countAlphaChars(sampleText) >= QUALIFIED_ALPHA_THRESHOLD ||
    countTokens(sampleText) >= QUALIFIED_TOKEN_THRESHOLD;

  const manualLockLanguage = resolveHintLanguage(
    input.session.manualLockLanguage,
    input.allowedLanguages,
  );
  const fallbackLanguage = resolveHintLanguage(input.fallbackLanguage, input.allowedLanguages)
    || input.allowedLanguages[0];
  const stableLanguage = resolveHintLanguage(input.session.stableLanguage, input.allowedLanguages);
  let pendingLanguage = resolveHintLanguage(input.session.pendingLanguage, input.allowedLanguages);
  let pendingConfirmations = Number.isFinite(input.session.pendingConfirmations)
    ? Math.max(0, Math.round(input.session.pendingConfirmations))
    : 0;
  let switchSuppressedUntilBoundary = input.session.switchSuppressedUntilBoundary === true;

  if (switchSuppressedUntilBoundary && atTokenBoundary) {
    switchSuppressedUntilBoundary = false;
  }

  if (manualLockLanguage) {
    return {
      resolvedLanguage: manualLockLanguage,
      stableLanguage: manualLockLanguage,
      pendingLanguage: null,
      pendingConfirmations: 0,
      manualLockLanguage,
      switchSuppressedUntilBoundary,
      source: "manual_lock",
      changed: stableLanguage !== manualLockLanguage,
      switched: stableLanguage !== null && stableLanguage !== manualLockLanguage,
      hasQualifiedEvidence,
      sampleText,
      topLanguage: manualLockLanguage,
      topScore: 1,
      stableScore: stableLanguage === manualLockLanguage ? 1 : 0,
    };
  }

  const scores = new Map<string, number>();
  for (const language of input.allowedLanguages) {
    scores.set(language, 0);
  }
  for (const detection of input.browserDetections) {
    const language = resolveHintLanguage(detection.language, input.allowedLanguages);
    if (!language) {
      continue;
    }
    scores.set(language, Math.max(scores.get(language) || 0, clampProbability(detection.percentage / 100)));
  }
  if (documentLanguageHint) {
    scores.set(documentLanguageHint, (scores.get(documentLanguageHint) || 0) + DOCUMENT_HINT_BONUS);
  }
  if (pageLanguageHint) {
    scores.set(pageLanguageHint, (scores.get(pageLanguageHint) || 0) + PAGE_HINT_BONUS);
  }
  if (sitePriorLanguage) {
    scores.set(
      sitePriorLanguage,
      (scores.get(sitePriorLanguage) || 0) +
        SITE_PRIOR_MAX_BONUS * clampProbability(input.sitePriorConfidence),
    );
  }
  if (stableLanguage) {
    scores.set(stableLanguage, (scores.get(stableLanguage) || 0) + STICKY_BONUS);
  }
  if (strongScriptLanguage) {
    scores.set(strongScriptLanguage, 1);
  }

  const ranked = [...scores.entries()]
    .map(([language, score]) => ({ language, score }))
    .sort(compareCandidateScores);
  const topCandidate = ranked[0] || null;
  const topLanguage = topCandidate?.language || null;
  const topScore = topCandidate?.score || 0;
  const stableScore = stableLanguage ? scores.get(stableLanguage) || 0 : 0;
  const provisionalLanguage =
    documentLanguageHint || pageLanguageHint || sitePriorLanguage || fallbackLanguage;

  if (!stableLanguage) {
    if (strongScriptLanguage) {
      return {
        resolvedLanguage: strongScriptLanguage,
        stableLanguage: strongScriptLanguage,
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
        source: "strong_script",
        changed: true,
        switched: false,
        hasQualifiedEvidence,
        sampleText,
        topLanguage,
        topScore,
        stableScore: 0,
      };
    }
    if (hasQualifiedEvidence && topLanguage && topScore >= INITIAL_COMMIT_THRESHOLD) {
      return {
        resolvedLanguage: topLanguage,
        stableLanguage: topLanguage,
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
        source: "detection",
        changed: true,
        switched: false,
        hasQualifiedEvidence,
        sampleText,
        topLanguage,
        topScore,
        stableScore: 0,
      };
    }
    return {
      resolvedLanguage: provisionalLanguage,
      stableLanguage: null,
      pendingLanguage: null,
      pendingConfirmations: 0,
      manualLockLanguage: null,
      switchSuppressedUntilBoundary: false,
      source: documentLanguageHint
        ? "provisional_document"
        : pageLanguageHint
          ? "provisional_page"
          : sitePriorLanguage
            ? "provisional_site_prior"
            : "fallback",
      changed: false,
      switched: false,
      hasQualifiedEvidence,
      sampleText,
      topLanguage,
      topScore,
      stableScore: 0,
    };
  }

  if (strongScriptLanguage && strongScriptLanguage !== stableLanguage) {
    return {
      resolvedLanguage: strongScriptLanguage,
      stableLanguage: strongScriptLanguage,
      pendingLanguage: null,
      pendingConfirmations: 0,
      manualLockLanguage: null,
      switchSuppressedUntilBoundary: true,
      source: "strong_script",
      changed: true,
      switched: true,
      hasQualifiedEvidence,
      sampleText,
      topLanguage,
      topScore,
      stableScore,
    };
  }

  if (
    switchSuppressedUntilBoundary &&
    !atTokenBoundary &&
    !pasteLikeInput
  ) {
    return {
      resolvedLanguage: stableLanguage,
      stableLanguage,
      pendingLanguage,
      pendingConfirmations,
      manualLockLanguage: null,
      switchSuppressedUntilBoundary,
      source: "stable",
      changed: false,
      switched: false,
      hasQualifiedEvidence,
      sampleText,
      topLanguage,
      topScore,
      stableScore,
    };
  }

  if (!topLanguage || topLanguage === stableLanguage || !hasQualifiedEvidence) {
    return {
      resolvedLanguage: stableLanguage,
      stableLanguage,
      pendingLanguage: null,
      pendingConfirmations: 0,
      manualLockLanguage: null,
      switchSuppressedUntilBoundary,
      source: "stable",
      changed: false,
      switched: false,
      hasQualifiedEvidence,
      sampleText,
      topLanguage,
      topScore,
      stableScore,
    };
  }

  const canSwitchNow = atTokenBoundary || pasteLikeInput;
  const eligibleChallenger =
    canSwitchNow &&
    topScore >= SWITCH_THRESHOLD &&
    topScore - stableScore >= SWITCH_MARGIN;

  if (!eligibleChallenger) {
    return {
      resolvedLanguage: stableLanguage,
      stableLanguage,
      pendingLanguage: null,
      pendingConfirmations: 0,
      manualLockLanguage: null,
      switchSuppressedUntilBoundary,
      source: "stable",
      changed: false,
      switched: false,
      hasQualifiedEvidence,
      sampleText,
      topLanguage,
      topScore,
      stableScore,
    };
  }

  if (pendingLanguage === topLanguage) {
    pendingConfirmations += 1;
  } else {
    pendingLanguage = topLanguage;
    pendingConfirmations = 1;
  }

  if (pendingConfirmations >= 2) {
    return {
      resolvedLanguage: topLanguage,
      stableLanguage: topLanguage,
      pendingLanguage: null,
      pendingConfirmations: 0,
      manualLockLanguage: null,
      switchSuppressedUntilBoundary: true,
      source: "detection",
      changed: true,
      switched: true,
      hasQualifiedEvidence,
      sampleText,
      topLanguage,
      topScore,
      stableScore,
    };
  }

  return {
    resolvedLanguage: stableLanguage,
    stableLanguage,
    pendingLanguage,
    pendingConfirmations,
    manualLockLanguage: null,
    switchSuppressedUntilBoundary,
    source: "stable",
    changed: false,
    switched: false,
    hasQualifiedEvidence,
    sampleText,
    topLanguage,
    topScore,
    stableScore,
  };
}
