import {
  SUPPORTED_LANGUAGES_SHORT_CODE,
  SUPPORTED_PREDICTION_LANGUAGE_KEYS,
  TEXT_EXPANDER_LANG,
} from "./lang";
import { isObjectRecord } from "./guards";

export interface AutoLanguageBrowserDetection {
  language: string;
  percentage: number;
}

interface AutoLanguageSitePriors {
  [domain: string]: Record<string, number>;
}

interface AutoLanguageSessionSnapshot {
  stableLanguage: string | null;
  pendingLanguage: string | null;
  pendingConfirmations: number;
  manualLockLanguage: string | null;
  switchSuppressedUntilBoundary: boolean;
}

interface ResolveAutoLanguageDecisionInput {
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

interface ResolveAutoLanguageDecisionResult {
  resolvedLanguage: string;
  stableLanguage: string | null;
  pendingLanguage: string | null;
  pendingConfirmations: number;
  manualLockLanguage: string | null;
  switchSuppressedUntilBoundary: boolean;
  source:
    | "manual_lock"
    | "strong_script"
    | "script_switch"
    | "detection"
    | "stable"
    | "provisional_document"
    | "provisional_page"
    | "provisional_site_prior"
    | "fallback";
  switched: boolean;
  hasQualifiedEvidence: boolean;
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
const MAX_SITE_PRIOR_ENTRIES = 3;
const STICKY_BONUS = 0.05;
const GREEK_SCRIPT_REGEX = /[\u0370-\u03FF\u1F00-\u1FFF]/u;
// Letters only: the Arabic blocks also hold digits and punctuation (١٢٣ ، ؛ ؟),
// which say nothing about the language being typed.
const ARABIC_SCRIPT_REGEX = /(?=\p{L})\p{Script=Arabic}/u;
// The Arabic block is shared with Persian, Urdu and Pashto.  These letters are
// exclusive to those languages (Farsi yeh/keheh, Urdu tteh/heh-goal, Pashto
// dzhe/tshe/...), so a sample containing one is not unambiguously Arabic and
// must not take the strong-script shortcut — it falls through to scored
// detection, where the user's enabled languages decide.
const SHARED_ARABIC_BLOCK_EXCLUSIVE_REGEX =
  /[\u0679\u067E\u0681\u0685\u0686\u0688\u0689\u0691\u0693\u0696\u0698\u069A\u069B\u06A9\u06AB\u06AF\u06BA\u06BC\u06BE\u06C1\u06C2\u06C3\u06CC\u06CD\u06D0\u06D2\u06D3]/u;
const LETTER_REGEX = /\p{L}/gu;
// Combining marks (Arabic tashkeel, Indic vowel signs) and ZWNJ are part of a
// word; splitting on them inflated the token evidence count.
const TOKEN_REGEX = /\p{L}[\p{L}\p{M}\u200C]*/gu;
const BOUNDARY_REGEX = /[\s.,!?;:()[\]{}"'`~@#$%^&*+=|\\/<>_-]/;

function clampProbability(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function countAlphaChars(text: string): number {
  return text.match(LETTER_REGEX)?.length ?? 0;
}

function countTokens(text: string): number {
  return text.match(TOKEN_REGEX)?.length ?? 0;
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

function getStrongScriptLanguage(
  tokenText: string,
  sampleText: string,
  allowedLanguages: string[],
): string | null {
  if (
    allowedLanguages.includes("ar_SA") &&
    ARABIC_SCRIPT_REGEX.test(tokenText) &&
    // The exclusivity evidence is taken from the whole sample: Persian, Urdu
    // and Pashto letters need not appear in the same token that looks Arabic.
    !SHARED_ARABIC_BLOCK_EXCLUSIVE_REGEX.test(sampleText)
  ) {
    return "ar_SA";
  }
  if (allowedLanguages.includes("el_GR") && GREEK_SCRIPT_REGEX.test(tokenText)) {
    return "el_GR";
  }
  return null;
}

function isTokenBoundary(sampleText: string): boolean {
  const lastChar = sampleText.charAt(sampleText.length - 1);
  return !lastChar || BOUNDARY_REGEX.test(lastChar);
}

const LATIN_SCRIPT_REGEX = /\p{Script=Latin}/u;

type ScriptKind = "arabic" | "greek" | "latin";

/** Languages that are not written in Latin script; everything else is. */
const NON_LATIN_LANGUAGE_SCRIPTS: Record<string, ScriptKind> = {
  ar_SA: "arabic",
  el_GR: "greek",
};

function languageScript(language: string): ScriptKind {
  return NON_LATIN_LANGUAGE_SCRIPTS[language] ?? "latin";
}

function textScript(text: string): ScriptKind | null {
  if (!text) {
    return null;
  }
  if (ARABIC_SCRIPT_REGEX.test(text)) {
    return "arabic";
  }
  if (GREEK_SCRIPT_REGEX.test(text)) {
    return "greek";
  }
  return LATIN_SCRIPT_REGEX.test(text) ? "latin" : null;
}

/** The word currently being typed: the last token in the sample. */
function extractCurrentToken(sampleText: string): string {
  return sampleText.match(TOKEN_REGEX)?.at(-1) ?? "";
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

function keepTopSitePriorEntries(entries: Array<[string, number]>): Array<[string, number]> {
  return entries.sort((left, right) => right[1] - left[1]).slice(0, MAX_SITE_PRIOR_ENTRIES);
}

export function extractAutoLanguageSample(text: string): string {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }
  const lastChar = text.charAt(text.length - 1);
  const trailingBoundary = lastChar && BOUNDARY_REGEX.test(lastChar) ? lastChar : "";
  const tokenSample = (text.match(TOKEN_REGEX) ?? [])
    .slice(-AUTO_LANGUAGE_MAX_SAMPLE_TOKENS)
    .join(" ")
    .trim();
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

export function updateAutoLanguageRollingSample(previousSample: string, nextText: string): string {
  if (typeof nextText === "string" && nextText.length > 0) {
    return extractAutoLanguageSample(nextText);
  }
  return extractAutoLanguageSample(previousSample);
}

export function sanitizeAutoLanguageSitePriors(
  priorsRaw: unknown,
  enabledLanguages: string[],
): AutoLanguageSitePriors {
  if (!isObjectRecord(priorsRaw)) {
    return {};
  }
  const result: AutoLanguageSitePriors = {};
  for (const [domain, entryRaw] of Object.entries(priorsRaw)) {
    if (!isObjectRecord(entryRaw)) {
      continue;
    }
    const normalizedEntries = Object.entries(entryRaw)
      .filter(
        ([language, weight]) =>
          enabledLanguages.includes(language) &&
          typeof weight === "number" &&
          Number.isFinite(weight),
      )
      .map(([language, weight]): [string, number] => [language, clampProbability(weight)])
      .filter(([, weight]) => weight > 0);
    if (normalizedEntries.length === 0) {
      continue;
    }
    result[domain] = Object.fromEntries(keepTopSitePriorEntries(normalizedEntries));
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
  const limited = keepTopSitePriorEntries(
    Object.entries(current).filter(([, weight]) => weight > 0.01),
  );
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
  const entry = domain ? priorsRaw[domain] : undefined;
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
  // Text Expander is not a prediction language: never a detection candidate.
  // It stays reachable only through an explicit manual lock or the fallback
  // (e.g. when it is the only enabled language).
  const candidateLanguages = input.allowedLanguages.filter(
    (language) => language !== TEXT_EXPANDER_LANG,
  );
  const sampleText = extractAutoLanguageSample(input.sampleText);
  const atTokenBoundary = isTokenBoundary(input.sampleText);
  const pasteLikeInput = input.inputAction === "other";
  const documentLanguageHint = resolveHintLanguage(input.documentLanguageHint, candidateLanguages);
  const pageLanguageHint = resolveHintLanguage(input.pageLanguageHint, candidateLanguages);
  const sitePriorLanguage = resolveHintLanguage(input.sitePriorLanguage, candidateLanguages);
  const currentToken = extractCurrentToken(input.sampleText);
  // The strong script is judged on the token being typed, not on the whole
  // rolling sample: the sample still contains the previous script after a
  // language switch, which pinned Arabic for the rest of the sentence and made
  // the Arabic engine predict Latin words.
  const strongScriptLanguage = getStrongScriptLanguage(
    currentToken || sampleText,
    sampleText,
    candidateLanguages,
  );
  const hasQualifiedEvidence =
    Boolean(strongScriptLanguage) ||
    countAlphaChars(sampleText) >= QUALIFIED_ALPHA_THRESHOLD ||
    countTokens(sampleText) >= QUALIFIED_TOKEN_THRESHOLD;

  const manualLockLanguage = resolveHintLanguage(
    input.session.manualLockLanguage,
    input.allowedLanguages,
  );
  const fallbackLanguage =
    resolveHintLanguage(input.fallbackLanguage, input.allowedLanguages) ||
    input.allowedLanguages[0];
  const stableLanguage = resolveHintLanguage(input.session.stableLanguage, input.allowedLanguages);
  let pendingLanguage = resolveHintLanguage(input.session.pendingLanguage, input.allowedLanguages);
  let pendingConfirmations = Number.isFinite(input.session.pendingConfirmations)
    ? Math.max(0, Math.round(input.session.pendingConfirmations))
    : 0;
  let switchSuppressedUntilBoundary = input.session.switchSuppressedUntilBoundary === true;

  if (switchSuppressedUntilBoundary && atTokenBoundary) {
    switchSuppressedUntilBoundary = false;
  }

  // Every outcome except the manual lock and a pending switch clears the pending state.
  const settle = (
    resolvedLanguage: string,
    stable: string | null,
    source: ResolveAutoLanguageDecisionResult["source"],
    switched: boolean,
    suppressUntilBoundary: boolean,
  ): ResolveAutoLanguageDecisionResult => ({
    resolvedLanguage,
    stableLanguage: stable,
    pendingLanguage: null,
    pendingConfirmations: 0,
    manualLockLanguage: null,
    switchSuppressedUntilBoundary: suppressUntilBoundary,
    source,
    switched,
    hasQualifiedEvidence,
  });

  if (manualLockLanguage) {
    return {
      resolvedLanguage: manualLockLanguage,
      stableLanguage: manualLockLanguage,
      pendingLanguage: null,
      pendingConfirmations: 0,
      manualLockLanguage,
      switchSuppressedUntilBoundary,
      source: "manual_lock",
      switched: stableLanguage !== null && stableLanguage !== manualLockLanguage,
      hasQualifiedEvidence,
    };
  }

  const scores = new Map<string, number>();
  for (const language of candidateLanguages) {
    scores.set(language, 0);
  }
  for (const detection of input.browserDetections) {
    const language = resolveHintLanguage(detection.language, candidateLanguages);
    if (!language) {
      continue;
    }
    scores.set(
      language,
      Math.max(scores.get(language) || 0, clampProbability(detection.percentage / 100)),
    );
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
  if (stableLanguage && candidateLanguages.includes(stableLanguage)) {
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

  // A language can only predict a token written in its own script.  Arabic
  // cannot predict a Latin word, so a stable Arabic session must hand over as
  // soon as the token being typed is Latin - the scored path cannot do this
  // mid-word, because switching there is gated on a token boundary.
  if (stableLanguage) {
    const tokenScript = textScript(currentToken);
    if (
      !strongScriptLanguage &&
      tokenScript &&
      tokenScript !== languageScript(stableLanguage) &&
      // Same guard as the strong-script shortcut: Persian/Urdu/Pashto letters
      // mean the Arabic-block text is not necessarily Arabic.
      !(tokenScript === "arabic" && SHARED_ARABIC_BLOCK_EXCLUSIVE_REGEX.test(sampleText))
    ) {
      // Mid-word most candidates score 0; picking among those would fall to
      // the alphabetical tie-break.  Take a candidate with evidence, else the
      // fallback language, else stay put.
      const scored = ranked.find(
        (candidate) => candidate.score > 0 && languageScript(candidate.language) === tokenScript,
      );
      const compatible =
        scored?.language ??
        (languageScript(fallbackLanguage) === tokenScript &&
        candidateLanguages.includes(fallbackLanguage)
          ? fallbackLanguage
          : null);
      if (compatible && compatible !== stableLanguage) {
        return settle(compatible, compatible, "script_switch", true, true);
      }
    }
  }

  if (!stableLanguage) {
    if (strongScriptLanguage) {
      return settle(strongScriptLanguage, strongScriptLanguage, "strong_script", false, false);
    }
    if (hasQualifiedEvidence && topLanguage && topScore >= INITIAL_COMMIT_THRESHOLD) {
      return settle(topLanguage, topLanguage, "detection", false, false);
    }
    return settle(
      provisionalLanguage,
      null,
      documentLanguageHint
        ? "provisional_document"
        : pageLanguageHint
          ? "provisional_page"
          : sitePriorLanguage
            ? "provisional_site_prior"
            : "fallback",
      false,
      false,
    );
  }

  if (strongScriptLanguage && strongScriptLanguage !== stableLanguage) {
    return settle(strongScriptLanguage, strongScriptLanguage, "strong_script", true, true);
  }

  if (switchSuppressedUntilBoundary && !atTokenBoundary && !pasteLikeInput) {
    return {
      resolvedLanguage: stableLanguage,
      stableLanguage,
      pendingLanguage,
      pendingConfirmations,
      manualLockLanguage: null,
      switchSuppressedUntilBoundary,
      source: "stable",
      switched: false,
      hasQualifiedEvidence,
    };
  }

  const canSwitchNow = atTokenBoundary || pasteLikeInput;
  const eligibleChallenger =
    canSwitchNow && topScore >= SWITCH_THRESHOLD && topScore - stableScore >= SWITCH_MARGIN;

  if (
    !topLanguage ||
    topLanguage === stableLanguage ||
    !hasQualifiedEvidence ||
    !eligibleChallenger
  ) {
    return settle(stableLanguage, stableLanguage, "stable", false, switchSuppressedUntilBoundary);
  }

  if (pendingLanguage === topLanguage) {
    pendingConfirmations += 1;
  } else {
    pendingLanguage = topLanguage;
    pendingConfirmations = 1;
  }

  if (pendingConfirmations >= 2) {
    return settle(topLanguage, topLanguage, "detection", true, true);
  }

  return {
    resolvedLanguage: stableLanguage,
    stableLanguage,
    pendingLanguage,
    pendingConfirmations,
    manualLockLanguage: null,
    switchSuppressedUntilBoundary,
    source: "stable",
    switched: false,
    hasQualifiedEvidence,
  };
}
