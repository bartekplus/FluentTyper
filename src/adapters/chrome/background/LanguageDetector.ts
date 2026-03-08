import type { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import {
  getAutoLanguageSitePrior,
  recordAutoLanguageSitePrior,
  resolveAutoLanguageDecision,
  sanitizeAutoLanguageSitePriors,
  type AutoLanguageBrowserDetection,
  type AutoLanguageSitePriors,
} from "@core/domain/autoLanguageDetection";
import { normalizeDomainHost } from "@core/domain/siteProfiles";
import { resolveEnabledPredictionLanguages } from "@core/domain/lang";
import type { PredictionInputAction } from "@core/domain/messageTypes";

const SESSION_TTL_MS = 5 * 60 * 1000;

export interface AutoLanguageRequest {
  text: string;
  nextChar: string;
  tabId: number;
  frameId: number;
  suggestionId: number;
  runtimeGeneration?: number;
  inputAction?: PredictionInputAction;
  documentLang?: string;
  domainURL?: string;
  enabledLanguages?: string[];
}

export interface AutoLanguageResolution {
  language: string;
  changed: boolean;
  source: string;
  isLocked: boolean;
  switched: boolean;
  tabId: number;
  frameId: number;
}

export interface AutoLanguageSessionStatus {
  language: string;
  source: string;
  locked: boolean;
  tabId: number;
  frameId: number;
  domain: string | null;
  updatedAt: number;
}

interface AutoLanguageSessionState {
  key: string;
  tabId: number;
  frameId: number;
  suggestionId: number;
  runtimeGeneration: number;
  domain: string | null;
  enabledLanguages: string[];
  stableLanguage: string | null;
  resolvedLanguage: string;
  pendingLanguage: string | null;
  pendingConfirmations: number;
  manualLockLanguage: string | null;
  switchSuppressedUntilBoundary: boolean;
  source: string;
  lastSeenAt: number;
  priorEligible: boolean;
}

export class LanguageDetector {
  private readonly settingsRepository: CoreSettingsRepository;
  private readonly sessions = new Map<string, AutoLanguageSessionState>();

  constructor(settings: SettingsManager) {
    this.settingsRepository = new CoreSettingsRepository(settings);
  }

  async resolveLanguage(request: AutoLanguageRequest): Promise<AutoLanguageResolution> {
    const now = Date.now();
    await this.pruneStaleSessions(now);

    const allowedLanguages = resolveEnabledPredictionLanguages(request.enabledLanguages);
    const [fallbackLanguageRaw, priorsRaw] = await Promise.all([
      this.settingsRepository.getFallbackLanguage(),
      this.settingsRepository.getAutoLanguageSitePriors(),
    ]);
    const fallbackLanguage = allowedLanguages.includes(fallbackLanguageRaw)
      ? fallbackLanguageRaw
      : allowedLanguages[0];
    const domain = normalizeDomainHost(request.domainURL || "") || null;
    const priors = sanitizeAutoLanguageSitePriors(priorsRaw, allowedLanguages);
    const sitePrior = getAutoLanguageSitePrior(priors, domain || undefined, allowedLanguages);
    const key = this.getSessionKey(request);
    const session =
      this.sessions.get(key) ||
      ({
        key,
        tabId: request.tabId,
        frameId: request.frameId,
        suggestionId: request.suggestionId,
        runtimeGeneration:
          typeof request.runtimeGeneration === "number" && Number.isFinite(request.runtimeGeneration)
            ? request.runtimeGeneration
            : 0,
        domain,
        enabledLanguages: allowedLanguages.slice(),
        stableLanguage: null,
        resolvedLanguage: fallbackLanguage,
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
        source: "fallback",
        lastSeenAt: now,
        priorEligible: false,
      } as AutoLanguageSessionState);

    session.tabId = request.tabId;
    session.frameId = request.frameId;
    session.suggestionId = request.suggestionId;
    session.runtimeGeneration =
      typeof request.runtimeGeneration === "number" && Number.isFinite(request.runtimeGeneration)
        ? request.runtimeGeneration
        : 0;
    session.domain = domain;
    session.enabledLanguages = allowedLanguages.slice();
    session.lastSeenAt = now;

    const [browserDetections, pageLanguageHint] = await Promise.all([
      this.detectBrowserLanguages(request.text),
      this.detectPageLanguage(request.tabId),
    ]);

    const decision = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage,
      sampleText: request.text,
      browserDetections,
      documentLanguageHint: request.documentLang,
      pageLanguageHint,
      sitePriorLanguage: sitePrior.language,
      sitePriorConfidence: sitePrior.confidence,
      inputAction: request.inputAction,
      session: {
        stableLanguage: session.stableLanguage,
        pendingLanguage: session.pendingLanguage,
        pendingConfirmations: session.pendingConfirmations,
        manualLockLanguage: session.manualLockLanguage,
        switchSuppressedUntilBoundary: session.switchSuppressedUntilBoundary,
      },
    });

    const previousLanguage = session.resolvedLanguage;
    session.stableLanguage = decision.stableLanguage;
    session.resolvedLanguage = decision.resolvedLanguage;
    session.pendingLanguage = decision.pendingLanguage;
    session.pendingConfirmations = decision.pendingConfirmations;
    session.manualLockLanguage = decision.manualLockLanguage;
    session.switchSuppressedUntilBoundary = decision.switchSuppressedUntilBoundary;
    session.source = decision.source;
    session.priorEligible =
      session.priorEligible || Boolean(decision.stableLanguage && decision.hasQualifiedEvidence);
    this.sessions.set(key, session);

    return {
      language: decision.resolvedLanguage,
      changed: decision.resolvedLanguage !== previousLanguage,
      source: decision.source,
      isLocked: Boolean(decision.manualLockLanguage),
      switched: decision.switched,
      tabId: request.tabId,
      frameId: request.frameId,
    };
  }

  async cycleManualLockForTab(tabId: number): Promise<AutoLanguageSessionStatus | null> {
    const session = await this.getRecentSessionForTab(tabId);
    if (!session) {
      return null;
    }
    const currentIndex = session.enabledLanguages.indexOf(session.resolvedLanguage);
    const nextLanguage =
      session.enabledLanguages[
        ((currentIndex >= 0 ? currentIndex : 0) + 1) % session.enabledLanguages.length
      ];
    session.manualLockLanguage = nextLanguage;
    session.stableLanguage = nextLanguage;
    session.resolvedLanguage = nextLanguage;
    session.pendingLanguage = null;
    session.pendingConfirmations = 0;
    session.switchSuppressedUntilBoundary = true;
    session.source = "manual_lock";
    session.lastSeenAt = Date.now();
    session.priorEligible = true;
    this.sessions.set(session.key, session);
    await this.persistSitePrior(session.domain, nextLanguage, true);
    return this.toSessionStatus(session);
  }

  async getRecentSessionStatusForTab(tabId: number): Promise<AutoLanguageSessionStatus | null> {
    const session = await this.getRecentSessionForTab(tabId);
    return session ? this.toSessionStatus(session) : null;
  }

  clearSessions(): void {
    this.sessions.clear();
  }

  private async getRecentSessionForTab(tabId: number): Promise<AutoLanguageSessionState | null> {
    await this.pruneStaleSessions(Date.now());
    const sessions = [...this.sessions.values()]
      .filter((session) => session.tabId === tabId)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
    return sessions[0] || null;
  }

  private toSessionStatus(session: AutoLanguageSessionState): AutoLanguageSessionStatus {
    return {
      language: session.resolvedLanguage,
      source: session.source,
      locked: Boolean(session.manualLockLanguage),
      tabId: session.tabId,
      frameId: session.frameId,
      domain: session.domain,
      updatedAt: session.lastSeenAt,
    };
  }

  private getSessionKey(request: AutoLanguageRequest): string {
    const runtimeGeneration =
      typeof request.runtimeGeneration === "number" && Number.isFinite(request.runtimeGeneration)
        ? request.runtimeGeneration
        : 0;
    return `${request.tabId}:${request.frameId}:${runtimeGeneration}:${request.suggestionId}`;
  }

  private async detectBrowserLanguages(text: string): Promise<AutoLanguageBrowserDetection[]> {
    if (typeof text !== "string" || text.trim().length === 0) {
      return [];
    }
    try {
      const globalAny = globalThis as { browser?: typeof chrome };
      const api = typeof globalAny.browser === "undefined" ? chrome : globalAny.browser;
      const result = await api.i18n.detectLanguage(text);
      return Array.isArray(result?.languages) ? result.languages : [];
    } catch {
      return [];
    }
  }

  private async detectPageLanguage(tabId: number): Promise<string | null> {
    try {
      const globalAny = globalThis as { browser?: typeof chrome };
      const api = typeof globalAny.browser === "undefined" ? chrome : globalAny.browser;
      return (await api.tabs.detectLanguage(tabId)) || null;
    } catch {
      return null;
    }
  }

  private async pruneStaleSessions(now: number): Promise<void> {
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastSeenAt <= SESSION_TTL_MS) {
        continue;
      }
      if (session.domain && session.stableLanguage && session.priorEligible) {
        await this.persistSitePrior(session.domain, session.stableLanguage, false);
      }
      this.sessions.delete(key);
    }
  }

  private async persistSitePrior(
    domain: string | null,
    language: string,
    strong: boolean,
  ): Promise<void> {
    if (!domain) {
      return;
    }
    const enabledLanguages = await this.settingsRepository.getEnabledLanguages();
    if (!enabledLanguages.includes(language)) {
      return;
    }
    const priors = sanitizeAutoLanguageSitePriors(
      await this.settingsRepository.getAutoLanguageSitePriors(),
      enabledLanguages,
    );
    const nextPriors = recordAutoLanguageSitePrior(priors, domain, language, strong);
    await this.settingsRepository.setAutoLanguageSitePriors(nextPriors);
  }
}
