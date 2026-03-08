import type { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import {
  extractAutoLanguageSample,
  getAutoLanguageSitePrior,
  recordAutoLanguageSitePrior,
  resolveAutoLanguageDecision,
  sanitizeAutoLanguageSitePriors,
  updateAutoLanguageRollingSample,
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

export interface AutoLanguageSessionLookup {
  tabId: number;
  frameId?: number;
  runtimeGeneration?: number;
  domainURL?: string;
}

export interface AutoLanguageLiveRuntimeStatus {
  tabId: number;
  frameId: number;
  runtimeGeneration: number;
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
  rollingSample: string;
  pageLanguageHint: string | null;
  pageLanguageHintResolved: boolean;
  pendingLanguage: string | null;
  pendingConfirmations: number;
  manualLockLanguage: string | null;
  switchSuppressedUntilBoundary: boolean;
  source: string;
  lastSeenAt: number;
  priorEligible: boolean;
}

interface AutoLanguageLiveRuntimeState {
  key: string;
  tabId: number;
  frameId: number;
  runtimeGeneration: number;
  domain: string | null;
  pageLanguageHint: string | null;
  pageLanguageHintResolved: boolean;
  pageLanguageHintPromise: Promise<string | null> | null;
  lastSeenAt: number;
  activityOrder: number;
}

export class LanguageDetector {
  private readonly settingsRepository: CoreSettingsRepository;
  private readonly sessions = new Map<string, AutoLanguageSessionState>();
  private readonly liveRuntimes = new Map<string, AutoLanguageLiveRuntimeState>();
  private liveRuntimeSequence = 0;

  constructor(settings: SettingsManager) {
    this.settingsRepository = new CoreSettingsRepository(settings);
  }

  async resolveLanguage(request: AutoLanguageRequest): Promise<AutoLanguageResolution> {
    const now = Date.now();
    await this.pruneStaleState(now);

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
    const nextRuntimeGeneration =
      typeof request.runtimeGeneration === "number" && Number.isFinite(request.runtimeGeneration)
        ? request.runtimeGeneration
        : 0;
    const session =
      this.sessions.get(key) ||
      ({
        key,
        tabId: request.tabId,
        frameId: request.frameId,
        suggestionId: request.suggestionId,
        runtimeGeneration: nextRuntimeGeneration,
        domain,
        enabledLanguages: allowedLanguages.slice(),
        stableLanguage: null,
        resolvedLanguage: fallbackLanguage,
        rollingSample: "",
        pageLanguageHint: null,
        pageLanguageHintResolved: false,
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
        source: "fallback",
        lastSeenAt: now,
        priorEligible: false,
      } as AutoLanguageSessionState);

    const pageScopeChanged =
      session.runtimeGeneration !== nextRuntimeGeneration || session.domain !== domain;
    session.tabId = request.tabId;
    session.frameId = request.frameId;
    session.suggestionId = request.suggestionId;
    session.runtimeGeneration = nextRuntimeGeneration;
    session.domain = domain;
    session.enabledLanguages = allowedLanguages.slice();
    session.lastSeenAt = now;
    if (pageScopeChanged) {
      session.pageLanguageHint = null;
      session.pageLanguageHintResolved = false;
    }
    session.rollingSample = updateAutoLanguageRollingSample(session.rollingSample, request.text);
    const runtime = this.trackLiveRuntime({
      tabId: request.tabId,
      frameId: request.frameId,
      runtimeGeneration: session.runtimeGeneration,
      domainURL: request.domainURL,
    });

    const rollingSample = session.rollingSample || extractAutoLanguageSample(request.text);

    const [browserDetections, pageLanguageHint] = await Promise.all([
      this.detectBrowserLanguages(rollingSample),
      this.getCachedPageLanguageHint(session, runtime, request.tabId),
    ]);

    const decision = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage,
      sampleText: rollingSample,
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

  reportRuntimeActivity(scope: AutoLanguageSessionLookup): void {
    this.trackLiveRuntime(scope);
  }

  async getLiveRuntimeStatus(
    scope: AutoLanguageSessionLookup,
  ): Promise<AutoLanguageLiveRuntimeStatus | null> {
    await this.pruneStaleState(Date.now());
    const runtime = this.getMatchingLiveRuntime(scope);
    if (!runtime) {
      return null;
    }
    return {
      tabId: runtime.tabId,
      frameId: runtime.frameId,
      runtimeGeneration: runtime.runtimeGeneration,
      domain: runtime.domain,
      updatedAt: runtime.lastSeenAt,
    };
  }

  async cycleManualLockForScope(
    scope: AutoLanguageSessionLookup,
  ): Promise<AutoLanguageSessionStatus | null> {
    const session = await this.getScopedSession(scope);
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

  async getRecentSessionStatusForScope(
    scope: AutoLanguageSessionLookup,
  ): Promise<AutoLanguageSessionStatus | null> {
    const session = await this.getScopedSession(scope);
    return session ? this.toSessionStatus(session) : null;
  }

  clearSessions(): void {
    this.sessions.clear();
  }

  private async getScopedSession(
    scope: AutoLanguageSessionLookup,
  ): Promise<AutoLanguageSessionState | null> {
    await this.pruneStaleState(Date.now());
    const runtime = this.getMatchingLiveRuntime(scope);
    if (!runtime) {
      return null;
    }
    const sessions = [...this.sessions.values()]
      .filter(
        (session) =>
          session.tabId === runtime.tabId &&
          session.frameId === runtime.frameId &&
          session.runtimeGeneration === runtime.runtimeGeneration &&
          session.domain === runtime.domain,
      )
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

  private getLiveRuntimeKey(tabId: number, frameId: number): string {
    return `${tabId}:${frameId}`;
  }

  private trackLiveRuntime(
    scope: AutoLanguageSessionLookup,
  ): AutoLanguageLiveRuntimeState | null {
    const runtimeGeneration =
      typeof scope.runtimeGeneration === "number" && Number.isFinite(scope.runtimeGeneration)
        ? scope.runtimeGeneration
        : 0;
    if (runtimeGeneration <= 0) {
      return null;
    }
    const key = this.getLiveRuntimeKey(scope.tabId, scope.frameId ?? 0);
    const domain = normalizeDomainHost(scope.domainURL || "") || null;
    const existing = this.liveRuntimes.get(key);
    const reusesPageContext =
      existing &&
      existing.runtimeGeneration === runtimeGeneration &&
      existing.domain === domain;
    const runtime: AutoLanguageLiveRuntimeState = {
      key,
      tabId: scope.tabId,
      frameId: scope.frameId ?? 0,
      runtimeGeneration,
      domain,
      pageLanguageHint: reusesPageContext ? existing.pageLanguageHint : null,
      pageLanguageHintResolved: reusesPageContext ? existing.pageLanguageHintResolved : false,
      pageLanguageHintPromise: reusesPageContext ? existing.pageLanguageHintPromise : null,
      lastSeenAt: Date.now(),
      activityOrder: (this.liveRuntimeSequence += 1),
    };
    this.liveRuntimes.set(key, runtime);
    return runtime;
  }

  private getMatchingLiveRuntime(
    scope: AutoLanguageSessionLookup,
  ): AutoLanguageLiveRuntimeState | null {
    const requestedDomain = normalizeDomainHost(scope.domainURL || "") || null;
    const requestedFrameId =
      typeof scope.frameId === "number" && Number.isFinite(scope.frameId) ? scope.frameId : null;
    const requestedRuntimeGeneration =
      typeof scope.runtimeGeneration === "number" && Number.isFinite(scope.runtimeGeneration)
        ? scope.runtimeGeneration
        : null;
    const liveRuntimes = [...this.liveRuntimes.values()]
      .filter((runtime) => runtime.tabId === scope.tabId)
      .filter((runtime) => requestedFrameId === null || runtime.frameId === requestedFrameId)
      .filter(
        (runtime) =>
          requestedRuntimeGeneration === null ||
          runtime.runtimeGeneration === requestedRuntimeGeneration,
      )
      .filter((runtime) => requestedDomain === null || runtime.domain === requestedDomain)
      .sort((left, right) => right.activityOrder - left.activityOrder);
    return liveRuntimes[0] || null;
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

  private async getCachedPageLanguageHint(
    session: AutoLanguageSessionState,
    runtime: AutoLanguageLiveRuntimeState | null,
    tabId: number,
  ): Promise<string | null> {
    if (!runtime) {
      if (session.pageLanguageHintResolved) {
        return session.pageLanguageHint;
      }
      const pageLanguageHint = await this.detectPageLanguage(tabId);
      session.pageLanguageHint = pageLanguageHint;
      session.pageLanguageHintResolved = true;
      return pageLanguageHint;
    }

    if (runtime.pageLanguageHintResolved) {
      return runtime.pageLanguageHint;
    }
    if (!runtime.pageLanguageHintPromise) {
      runtime.pageLanguageHintPromise = this.detectPageLanguage(tabId).then((pageLanguageHint) => {
        runtime.pageLanguageHint = pageLanguageHint;
        runtime.pageLanguageHintResolved = true;
        runtime.pageLanguageHintPromise = null;
        this.liveRuntimes.set(runtime.key, runtime);
        return pageLanguageHint;
      });
      this.liveRuntimes.set(runtime.key, runtime);
    }
    const pageLanguageHint = await runtime.pageLanguageHintPromise;
    session.pageLanguageHint = pageLanguageHint;
    session.pageLanguageHintResolved = true;
    return pageLanguageHint;
  }

  private async pruneStaleState(now: number): Promise<void> {
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastSeenAt <= SESSION_TTL_MS) {
        continue;
      }
      if (session.domain && session.stableLanguage && session.priorEligible) {
        await this.persistSitePrior(session.domain, session.stableLanguage, false);
      }
      this.sessions.delete(key);
    }
    for (const [key, runtime] of this.liveRuntimes.entries()) {
      if (now - runtime.lastSeenAt <= SESSION_TTL_MS) {
        continue;
      }
      this.liveRuntimes.delete(key);
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
