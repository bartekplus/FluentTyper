import { reviewLanguageRegions } from "@core/application/review/ReviewLanguageRegions";
import {
  HOST_EDITOR_ENABLED_ATTR,
  HOST_EDITOR_ENABLED_EVENT,
} from "./suggestions/HostEditorBridgeProtocol";
import type { FieldPreferenceResponse } from "@core/domain/fieldPreferences";
import { languageMatchesScript, resolveReviewLanguage, resolveUiLanguage } from "@core/domain/lang";
import { createLogger, setGlobalObservabilityRuntime } from "@core/application/logging/Logger";
import { getDeepActiveElement, isInDocument } from "@core/application/dom-utils";
import {
  CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY,
  CMD_CONTENT_SCRIPT_DISABLE_REVIEW_RULE,
  CMD_CONTENT_SCRIPT_REVIEW_SPELLING,
  CMD_FIELD_PREFERENCES,
} from "@core/domain/constants";
import { isCodeSafeGrammarRule } from "@core/domain/grammar/ruleCatalog";
import type {
  ContentScriptAddToDictionaryMessage,
  ContentScriptReviewSpellingMessage,
  ReviewSpellingResponse,
  ContentScriptPredictRequestContext,
  PredictResponseContext,
  SetConfigContext,
} from "@core/domain/messageTypes";
import { DomObserver } from "./DomObserver";
import { MutationPipeline } from "./MutationPipeline";
import { MutationScheduler } from "./MutationScheduler";
import { SHADOW_ATTACH_MARKER_ATTR, ShadowRootInterceptor } from "./ShadowRootInterceptor";
import { ThemeApplicator } from "./ThemeApplicator";
import { SuggestionManagerRuntime } from "./suggestions/SuggestionManagerRuntime";
import { ReviewController } from "./review/ReviewController";
import { LocalAiReviewProvider } from "./review/LocalAiReviewProvider";
import { MessagingReviewEngine } from "./review/MessagingReviewEngine";
import { ReviewLauncher } from "./review/ReviewLauncher";
import { whenDocumentFocused } from "./review/whenDocumentFocused";
import { reviewRuleIds } from "@core/domain/grammar/review/reviewCatalog";

import { GoogleDocsAdapter } from "./google-docs/GoogleDocsAdapter";
import { DocsReviewSurfaceProxy } from "./review/DocsReviewSurfaceProxy";
import { DOCS_SESSION_ID } from "./google-docs/GoogleDocsModel";
import { isGoogleDocsPage, isGoogleDocsInputFrame } from "./google-docs/GoogleDocsEnvironment";

const logger = createLogger("ContentRuntimeController");
/**
 * The browser's own on-device language identification (CLD; chrome/browser.i18n,
 * no permission): the text stays local. A base code such as "en", or null when unsure.
 */
async function detectTextLanguage(text: string, failOnError = false): Promise<string | null> {
  try {
    const result = await chrome.i18n.detectLanguage(text);
    const language = result.isReliable ? result.languages[0]?.language : null;
    return language && languageMatchesScript(language, text) ? language : null;
  } catch {
    if (failOnError) throw new Error("language-detection-failed");
    return null;
  }
}

// How long a review asked for from the popup waits for the page to regain focus.
const POPUP_FOCUS_WAIT_MS = 1500;

export class ContentRuntimeController {
  private static readonly SELECTORS = "textarea, input, [contentEditable]";
  private static readonly LATE_DISCOVERY_EVENTS = ["focusin", "mousedown", "input"] as const;
  private static readonly MUTATION_COALESCE_DELAY_MS = 16;
  private static readonly MAX_MUTATION_ROOTS = 64;

  private googleDocs: GoogleDocsAdapter | null = null;
  public suggestionManager: SuggestionManagerRuntime | null = null;
  public config: SetConfigContext = {
    enabled: false,
    autocomplete: false,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    selectByDigit: false,
    horizontalSuggestions: false,
    minWordLengthToPredict: 0,
    showSuggestionFooter: false,
    showReviewButton: true,
    inline_suggestion: false,
    preferNativeAutocomplete: true,
    codeMode: false,
    themeConfig: undefined,
    enabledGrammarRules: [],
    userDictionaryList: [],
  };
  private readonly domObserver: DomObserver;
  private readonly shadowObservers = new Map<ShadowRoot, DomObserver>();
  private shadowRootInterceptor: ShadowRootInterceptor | null = null;
  private readonly onMutationCallbackBound = this.mutationCallback.bind(this);
  private readonly onDocumentPotentialLateTargetBound: EventListener =
    this.onDocumentPotentialLateTarget.bind(this);

  private _enabled = false;
  private hostBridgeEnabled = false;
  private readonly onRestartRequest = this.restart.bind(this);
  // An open Docs review outlives a settings restart, which replaces the adapter.
  private readonly docsReviewSurface = new DocsReviewSurfaceProxy();
  private readonly mutationPipeline: MutationPipeline;
  private readonly mutationScheduler: MutationScheduler;
  private predictionGeneration = 0;
  private pendingRestartTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly themeApplicator = new ThemeApplicator();
  // Created on the first review request: no cost for pages that never review.
  private review: ReviewController | null = null;
  // Typing-time proposals are detected in the background, like a review.
  private readonly liveProposalEngine = new MessagingReviewEngine((message) =>
    chrome.runtime.sendMessage(message),
  );
  private reviewLauncher: ReviewLauncher | null = null;
  private reviewSuspended: HTMLElement | null = null;
  // A review asked for before the first config arrived; that config decides whether it runs.
  private configured = false;
  private reviewBeforeConfig: "command" | "popup" | null = null;

  constructor(
    private readonly handlers: {
      onPredictionRequest: (context: ContentScriptPredictRequestContext) => void;
      onRuntimeActivity: (runtimeGeneration: number) => void;
    },
  ) {
    this.domObserver = new DomObserver(
      document.body || document.documentElement,
      this.onMutationCallbackBound,
    );
    this.mutationScheduler = new MutationScheduler(
      ContentRuntimeController.MUTATION_COALESCE_DELAY_MS,
      (mutations, overflow) => {
        if (this.enabled) {
          this.processMutations(mutations, overflow);
        }
      },
    );
    this.mutationPipeline = new MutationPipeline(ContentRuntimeController.MAX_MUTATION_ROOTS);
  }

  set enabled(newValue: boolean) {
    if (this._enabled !== newValue) {
      logger.info("Runtime enabled state changed", { enabled: newValue });
      this._enabled = newValue;
      if (newValue) {
        this.enable();
      } else {
        this.disable();
      }
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setConfig(config: SetConfigContext): void {
    const pendingReview = this.configured ? null : this.reviewBeforeConfig;
    this.configured = true;
    this.reviewBeforeConfig = null;
    this.applyConfig(config);
    if (pendingReview) this.reviewActiveEditor(pendingReview);
  }

  private applyConfig(config: SetConfigContext): void {
    if (config.observability) {
      setGlobalObservabilityRuntime({
        config: config.observability,
        source: "content_script",
      });
    }
    logger.debug("Applying runtime config update", {
      enabled: config.enabled,
      lang: config.lang,
      autocomplete: config.autocomplete,
    });
    this.config = config;
    this.reviewLauncher?.refresh();

    if (config.enabled && config.themeConfig) {
      this.themeApplicator.apply(config.themeConfig);
    }

    if (this.enabled && config.enabled) {
      logger.info("Restarting runtime due to config change");
      this.onRestartRequest();
      // A settings change (rules, dictionary, language) rechecks an open review.
      this.review?.handleOptionsChanged();
      return;
    }

    this.enabled = config.enabled;
    if (!this.enabled) {
      this.suggestionManager = null;
    }
  }

  updateLanguage(lang: string): void {
    if (this.config.lang === lang) {
      return;
    }
    this.config.lang = lang;
    this.suggestionManager?.updateLangConfig(this.config.lang);
    this.googleDocs?.updateLanguage(this.config.lang);
    this.review?.handleOptionsChanged();
  }

  /**
   * Starts a review of the focused editor in THIS frame. Every frame receives
   * the request; only the one holding the focused editor acts. From the popup,
   * focus returns to the page once the popup closes.
   */
  reviewActiveEditor(source: "command" | "popup"): void {
    if (isGoogleDocsInputFrame()) return;
    if (!this.enabled) {
      // The page's settings are still on their way (GET_CONFIG); they decide.
      if (!this.configured) this.reviewBeforeConfig = source;
      return;
    }
    const run = () => {
      const active = getDeepActiveElement(document);
      if (
        !this.googleDocs &&
        (/^I?FRAME$/.test(document.activeElement?.tagName ?? "") ||
          (active && active.ownerDocument !== document))
      ) {
        // A child frame holds the focus and handles the request itself.
        return;
      }
      this.review ??= this.createReviewController();
      this.review.invoke();
    };
    if (document.hasFocus()) {
      run();
      return;
    }
    if (source !== "popup") {
      return;
    }
    whenDocumentFocused(document, run, POPUP_FOCUS_WAIT_MS);
  }

  /** FluentTyper's own UI text follows the "Extension UI Language" setting. */
  private uiLanguage(): string {
    return resolveUiLanguage(this.config.extensionLanguage, navigator.language);
  }

  private createReviewController(): ReviewController {
    return new ReviewController({
      uiLanguage: () => this.uiLanguage(),
      // Detection runs in the background service worker; this page loads none of it.
      createEngine: () =>
        new MessagingReviewEngine((message) => chrome.runtime.sendMessage(message)),
      getOptions: () => ({
        spellingEnabled: !this.config.codeMode,
        lang: this.config.lang,
        languagePreferences: JSON.stringify([
          this.config.enabledLanguages,
          this.config.fallbackLanguage,
        ]),
        // Review choices are independent of typing switches; none run in code mode.
        enabledRules: reviewRuleIds({
          codeMode: this.config.codeMode,
          overrides: this.config.reviewRuleOverrides,
        }),
        preferredTerminology: this.config.preferredTerminology,
        longSentenceWords: this.config.reviewLongSentenceWords,
        userDictionary: this.config.userDictionaryList ?? [],
        insertSpaceAfterAutocomplete: this.config.insertSpaceAfterAutocomplete,
      }),
      suspend: (element) => {
        this.reviewSuspended = element;
        this.suggestionManager?.suspendForReview(element);
      },
      resume: (element) => {
        this.reviewSuspended = null;
        this.suggestionManager?.resumeAfterReview(element);
      },
      suggestionsOpen: (element) => this.suggestionManager?.hasOpenSuggestions(element) ?? false,
      disableReviewRule: async (ruleId) => {
        const response: unknown = await chrome.runtime.sendMessage({
          command: CMD_CONTENT_SCRIPT_DISABLE_REVIEW_RULE,
          context: { ruleId },
        });
        return (response as { ok?: unknown } | undefined)?.ok === true;
      },
      addToDictionary: async (word) => {
        const message: ContentScriptAddToDictionaryMessage = {
          command: CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY,
          context: { word },
        };
        const response: unknown = await chrome.runtime.sendMessage(message);
        return (response as { ok?: unknown } | undefined)?.ok === true;
      },
      // Unknown words are looked up in the extension's own Presage engine; nothing leaves the browser.
      lookupSpelling: async (lang, words) => {
        const message: ContentScriptReviewSpellingMessage = {
          command: CMD_CONTENT_SCRIPT_REVIEW_SPELLING,
          context: { lang, words: [...words] },
        };
        const response = (await chrome.runtime.sendMessage(message)) as
          ReviewSpellingResponse | undefined;
        if (response?.ok === false && response.error === "resource-failed")
          throw new Error("dictionary-resource-failed");
        return response?.ok === true && Array.isArray(response.results) ? response.results : null;
      },
      getDocsSurface: () => (this.googleDocs ? this.docsReviewSurface : null),
      onActiveChange: () => this.reviewLauncher?.refresh(),
      // Created even with the preference off, so turning it on reaches an open Review
      // (`aiEnabled` and the status keep it "off" until then; nothing connects before a job).
      createAiProvider: () =>
        typeof chrome.runtime?.connect === "function"
          ? new LocalAiReviewProvider(chrome.runtime)
          : null,
      aiEnabled: () => this.config.localAiReviewEnabled !== false,
      detectLanguage: detectTextLanguage,
      languageRegions: (text, language, requireEvidence) =>
        reviewLanguageRegions(text, language, detectTextLanguage, requireEvidence),
      resolveAutoLanguage: async (text) => {
        const enabled = this.config.enabledLanguages ?? [];
        const fallback = this.config.fallbackLanguage ?? enabled[0] ?? "auto_detect";
        return resolveReviewLanguage(
          "auto_detect",
          await detectTextLanguage(text, true),
          enabled,
          fallback,
          text,
        );
      },
    });
  }

  triggerActiveSuggestion(): void {
    this.googleDocs?.triggerActiveSuggestion();
    this.suggestionManager?.triggerActiveSuggestion();
  }

  handleEarlyTabAcceptRequest(entryId: string): void {
    this.suggestionManager?.handleEarlyTabAcceptRequest(entryId);
  }

  fulfillPrediction(context: PredictResponseContext): void {
    if (
      Number.isFinite(context.runtimeGeneration) &&
      context.runtimeGeneration !== this.predictionGeneration
    ) {
      logger.debug("Ignoring stale prediction response generation", {
        responseGeneration: context.runtimeGeneration,
        activeGeneration: this.predictionGeneration,
        suggestionId: context.suggestionId,
        requestId: context.requestId,
      });
      return;
    }
    if (context.suggestionId === DOCS_SESSION_ID && this.googleDocs) {
      void this.googleDocs.fulfillPrediction(context);
      return;
    }
    this.suggestionManager?.fulfillPrediction(context);
  }

  mutationCallback(mutationsList: MutationRecord[]): void {
    if (!this.enabled) {
      return;
    }
    this.mutationScheduler.enqueue(mutationsList);
  }

  processMutations(mutationsList: MutationRecord[], overflow = false): void {
    if (mutationsList.length > 1) {
      logger.debug("Processing DOM mutations", {
        mutationCount: mutationsList.length,
      });
    }
    this.domObserver.disconnect();
    this.disconnectShadowObservers();
    try {
      if (!this.suggestionManager) {
        return;
      }
      this.suggestionManager.removeHelpersNotInDocument();

      const plan = overflow
        ? { type: "full-scan" as const }
        : this.mutationPipeline.buildPlan(mutationsList);
      if (plan.type === "full-scan") {
        this.suggestionManager.queryAndAttachHelper();
      } else if (plan.type === "targeted-scan") {
        for (const root of plan.roots) {
          this.suggestionManager.queryAndAttachHelper(root);
        }
      }
    } finally {
      if (this.enabled) {
        this.domObserver.attach();
        this.refreshShadowObservers();
      }
    }
  }

  enable(): void {
    this.setHostBridgeEnabled(true);
    logger.info("Enabling content runtime");
    if (!this.suggestionManager || (isGoogleDocsPage() && !this.googleDocs)) {
      this.suggestionManager?.detachAllHelpers();
      this.initializeSuggestionManager();
    }
    this.googleDocs?.start();
    this.suggestionManager?.queryAndAttachHelper();
    this.suggestionManager?.triggerActiveSuggestion();
    this.domObserver.attach();
    this.refreshShadowObservers();
    this.ensureShadowRootInterceptor();
    this.ensureLateDiscoveryListeners();
    this.ensureReviewLauncher();
    this.reportRuntimeActivity();
  }

  /** The in-field "Review text" button; Google Docs has no DOM field to put it on. */
  private ensureReviewLauncher(): void {
    if (this.reviewLauncher || isGoogleDocsPage() || isGoogleDocsInputFrame()) {
      this.reviewLauncher?.refresh();
      return;
    }
    this.reviewLauncher = new ReviewLauncher(document, {
      uiLanguage: () => this.uiLanguage(),
      isEnabled: () =>
        this.enabled &&
        this.config.showReviewButton !== false &&
        // Dictionary suggestions stay available when native checks are disabled.
        !this.config.codeMode,
      canShowFor: (field) => !this.suggestionManager?.isAwaitingManualAttach(field),
      reviewedElement: () => this.review?.reviewedElement ?? null,
      review: () => {
        this.review ??= this.createReviewController();
        this.review.invoke();
      },
    });
  }

  private setHostBridgeEnabled(enabled: boolean): void {
    if (this.hostBridgeEnabled === enabled) return;
    this.hostBridgeEnabled = enabled;
    const root = document.documentElement;
    root.setAttribute(HOST_EDITOR_ENABLED_ATTR, String(enabled));
    document.dispatchEvent(new Event(HOST_EDITOR_ENABLED_EVENT));
    root.removeAttribute(HOST_EDITOR_ENABLED_ATTR);
  }

  disable({ keepReview = false }: { keepReview?: boolean } = {}): void {
    // A restart for a settings change keeps an open review; turning off ends it,
    // along with any notice explaining why a review could not start.
    if (!keepReview) {
      this.setHostBridgeEnabled(false);
      this.review?.dispose();
      this.reviewLauncher?.dispose();
      this.reviewLauncher = null;
    }
    this.googleDocs?.dispose();
    this.googleDocs = null;
    this.docsReviewSurface.attach(null);
    logger.info("Disabling content runtime");
    if (this.pendingRestartTimer !== null) {
      clearTimeout(this.pendingRestartTimer);
      this.pendingRestartTimer = null;
    }
    this.domObserver.disconnect();
    this.disconnectShadowObservers();
    for (const root of this.shadowObservers.keys()) {
      root.host.removeAttribute(SHADOW_ATTACH_MARKER_ATTR);
      root
        .querySelectorAll(`[${SHADOW_ATTACH_MARKER_ATTR}]`)
        .forEach((node) => node.removeAttribute(SHADOW_ATTACH_MARKER_ATTR));
    }
    this.shadowObservers.clear();
    if (!keepReview) this.themeApplicator.remove();
    this.mutationScheduler.clear();
    this.suggestionManager?.detachAllHelpers();
    this.shadowRootInterceptor?.detach();
    this.removeLateDiscoveryListeners();
  }

  restart(): void {
    if (this.pendingRestartTimer !== null) {
      logger.debug("Skipping content runtime restart; restart already scheduled");
      return;
    }

    logger.warn("Restarting content runtime");
    this.disable({ keepReview: true });
    this.suggestionManager = null;
    this.pendingRestartTimer = setTimeout(() => {
      this.pendingRestartTimer = null;
      if (this._enabled) {
        this.enable();
      }
    }, 0);
  }

  getObservedNode(): Node {
    return this.domObserver.getNode();
  }

  setObservedNode(node: Node): void {
    this.domObserver.setNode(node);
  }

  private registerShadowRoot(root: ShadowRoot): void {
    if (this.shadowObservers.has(root)) {
      return;
    }
    const observer = new DomObserver(root, this.onMutationCallbackBound);
    this.shadowObservers.set(root, observer);
    if (this.enabled) {
      observer.attach();
    }
  }

  private disconnectShadowObservers(): void {
    for (const observer of this.shadowObservers.values()) {
      observer.disconnect();
    }
  }

  private refreshShadowObservers(): void {
    for (const [root, observer] of this.shadowObservers.entries()) {
      if (!isInDocument(root.host)) {
        observer.disconnect();
        this.shadowObservers.delete(root);
        continue;
      }
      observer.attach();
    }
  }

  private ensureShadowRootInterceptor(): void {
    if (!this.shadowRootInterceptor) {
      this.shadowRootInterceptor = new ShadowRootInterceptor((root) => {
        this.registerShadowRoot(root);
        // Trigger an initial scan of the host so elements already present in
        // the shadow root at interception time are discovered immediately.
        // Subsequent appends are caught by the DomObserver on the shadow root.
        this.suggestionManager?.queryAndAttachHelper(root.host);
      });
    }
    this.shadowRootInterceptor.attach();
  }

  private ensureLateDiscoveryListeners(): void {
    for (const eventName of ContentRuntimeController.LATE_DISCOVERY_EVENTS) {
      document.addEventListener(eventName, this.onDocumentPotentialLateTargetBound, true);
    }
  }

  private removeLateDiscoveryListeners(): void {
    for (const eventName of ContentRuntimeController.LATE_DISCOVERY_EVENTS) {
      document.removeEventListener(eventName, this.onDocumentPotentialLateTargetBound, true);
    }
  }

  private onDocumentPotentialLateTarget(event: Event): void {
    if (!this.enabled || !this.suggestionManager) {
      return;
    }
    const candidate = this.resolveLateDiscoveryCandidate(event);
    if (!candidate) {
      return;
    }
    this.reportRuntimeActivity();
    const attachedNow = this.suggestionManager.queryAndAttachHelper(candidate);
    if (event.type === "focusin" || (event.type === "input" && attachedNow)) {
      this.suggestionManager.triggerActiveSuggestion();
    }
  }

  private resolveLateDiscoveryCandidate(event: Event): Element | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) {
        continue;
      }
      const shadowActiveElement = node.shadowRoot?.activeElement;
      if (
        shadowActiveElement instanceof Element &&
        shadowActiveElement.matches(ContentRuntimeController.SELECTORS)
      ) {
        return shadowActiveElement;
      }
      if (node.matches(ContentRuntimeController.SELECTORS)) {
        return node;
      }
      const matchingAncestor = node.closest(ContentRuntimeController.SELECTORS);
      if (matchingAncestor) {
        return matchingAncestor;
      }
    }
    return null;
  }

  private initializeSuggestionManager(): void {
    this.predictionGeneration += 1;
    const generation = this.predictionGeneration;
    logger.debug("Initializing suggestion manager", {
      lang: this.config.lang,
      autocomplete: this.config.autocomplete,
      minWordLengthToPredict: this.config.minWordLengthToPredict,
      generation,
    });
    const managerOptions = {
      loadFieldPreferences: async () => {
        const response: FieldPreferenceResponse = await chrome.runtime.sendMessage({
          command: CMD_FIELD_PREFERENCES,
          context: { action: "list" },
        });
        return response?.ok ? response.records.map((record) => record.signature) : [];
      },
      rememberField: async (signature: string, label: string) => {
        const response: FieldPreferenceResponse = await chrome.runtime.sendMessage({
          command: CMD_FIELD_PREFERENCES,
          context: { action: "enable", signature, label },
        });
        if (!response?.ok) throw new Error(response?.error ?? "Could not remember this field.");
      },
      // Only Docs' hidden input iframe is excluded; titles/comments keep the normal helper.
      selectors: isGoogleDocsInputFrame() ? ":not(*)" : ContentRuntimeController.SELECTORS,
      minWordLengthToPredict: this.config.minWordLengthToPredict,
      autocomplete: this.config.autocomplete,
      autocompleteOnEnter: this.config.autocompleteOnEnter,
      autocompleteOnTab: this.config.autocompleteOnTab,
      insertSpaceAfterAutocomplete: this.config.insertSpaceAfterAutocomplete,
      lang: this.config.lang,
      selectByDigit: this.config.selectByDigit,
      horizontalSuggestions: this.config.horizontalSuggestions,
      uiLanguage: this.uiLanguage(),
      showSuggestionFooter: this.config.showSuggestionFooter,
      inline_suggestion: this.config.inline_suggestion,
      preferNativeAutocomplete: this.config.preferNativeAutocomplete,
      // Code mode keeps FluentTyper from rewriting code: only rules that never
      // touch code run.
      enabledGrammarRules: this.config.codeMode
        ? this.config.enabledGrammarRules.filter(isCodeSafeGrammarRule)
        : this.config.enabledGrammarRules,
      // Review's own switches decide what is proposed; code mode proposes nothing.
      grammarProposalRules:
        this.config.liveGrammarProposals === false || this.config.codeMode
          ? []
          : reviewRuleIds({ codeMode: false, overrides: this.config.reviewRuleOverrides }),
      findLiveProposals: this.liveProposalEngine.liveProposals.bind(this.liveProposalEngine),
      userDictionaryList: this.config.userDictionaryList,
      getPrediction: (context: ContentScriptPredictRequestContext) =>
        this.handlers.onPredictionRequest({
          ...context,
          runtimeGeneration: generation,
        }),
      onShadowRootDiscovered: this.registerShadowRoot.bind(this),
    };
    this.suggestionManager = new SuggestionManagerRuntime(managerOptions);
    if (this.reviewSuspended) this.suggestionManager.suspendForReview(this.reviewSuspended);
    if (isGoogleDocsPage()) {
      this.googleDocs = new GoogleDocsAdapter(managerOptions);
      this.docsReviewSurface.attach(this.googleDocs);
    }
    this.reportRuntimeActivity();
  }

  private reportRuntimeActivity(): void {
    if (this.predictionGeneration <= 0) {
      return;
    }
    this.handlers.onRuntimeActivity(this.predictionGeneration);
  }
}
