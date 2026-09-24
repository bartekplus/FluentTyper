import { SUPPORTED_LANGUAGES, TEXT_EXPANDER_LANG } from "@core/domain/lang";
import { isWhiteSpace } from "@core/application/domain-utils";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage } from "@core/domain/error";
import { damerauLevenshteinDistance } from "@core/domain/editDistance";
import { Capitalization } from "./CapitalizationHelper";
import { MIN_WORD_LENGTH_TO_PREDICT, PredictionInputProcessor } from "./PredictionInputProcessor";
import { TemplateExpander } from "./TemplateExpander";
import type { PresageModule } from "./PresageTypes";
import { setTextExpansions, setUserDictionaryList } from "./PresageFiles";
import { PresageEngine, type PresageEngineConfig } from "./PresageEngine";
import { MAX_NUM_SUGGESTIONS } from "@core/domain/constants";
import type { PredictionCandidate, PredictionResult } from "./PredictionTypes";
import { normalizePrediction } from "./PredictionMerger";
import { SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import { rankPersonalizedCandidates } from "@core/domain/personalization/PersonalizationRanker";
import type { PersonalizationRankingSnapshot } from "@core/domain/personalization/types";
const SUGGESTION_COUNT = 5;
const logger = createLogger("PresageHandler");

// Shorter tokens are often real words one edit from a shortcut ("the" -> "thx").
const MIN_TYPO_TOKEN_LENGTH = 4;

function isSubsequence(token: string, text: string): boolean {
  let pos = 0;
  for (const char of token) {
    pos = text.indexOf(char, pos) + 1;
    if (pos === 0) {
      return false;
    }
  }
  return true;
}

/**
 * How well `token` matches a snippet `shortcut`, lower is better:
 * 0 = prefix ("ad" -> "address"),
 * 1 = abbreviation: token chars in order, first char anchored ("adr" -> "address"),
 * 2 = typo: one edit away from the shortcut's start ("adre" -> "address"),
 * null = no match. Exact matches are left to Presage.
 *
 * Fuzzy tiers only run when `fuzzy` is set (Text Expander, not prefix-only mode):
 * in a word language they turn ordinary words into snippet hits against
 * marker-prefixed shortcuts ("date" -> "ddate", "title" -> "ptitle").
 */
function snippetMatchRank(shortcut: string, token: string, fuzzy: boolean): number | null {
  if (shortcut === token) {
    return null;
  }
  if (shortcut.startsWith(token)) {
    return 0;
  }
  if (!fuzzy) {
    return null;
  }
  if (shortcut[0] === token[0] && isSubsequence(token, shortcut)) {
    return 1;
  }
  // Compare against starts one shorter/longer too, so a missing or extra letter counts as one edit.
  const isTypo =
    token.length >= MIN_TYPO_TOKEN_LENGTH &&
    [-1, 0, 1].some(
      (delta) => damerauLevenshteinDistance(token, shortcut.slice(0, token.length + delta), 1) <= 1,
    );
  return isTypo ? 2 : null;
}

export interface PresageConfig {
  numSuggestions: number;
  minWordLengthToPredict: number;
  insertSpaceAfterAutocomplete: boolean;
  autoCapitalize: boolean;
  textExpansions: Array<[string, object]>;
  prefixOnlyMode: boolean;
  personalizationEnabled?: boolean;

  timeFormat?: string;
  dateFormat?: string;
  userDictionaryList?: string[];
}

interface PresageHandlerOptions {
  getPersonalizationSnapshot?: () => PersonalizationRankingSnapshot;
  now?: () => number;
}

export interface PresagePredictionContext {
  text: string;
  nextChar: string;
  afterCursorTokenSuffix?: string;
  lang: string;
  predictionInput: string;
  doPrediction: boolean;
  doCapitalize: Capitalization;
  effectiveNumSuggestions: number;
  tabId?: number;
  /**
   * The word being typed, lowercased, as prediction and the content script's
   * replacement both see it: "(ad" -> "ad". Empty after a space.
   */
  snippetToken: string;
}

type TemplateResolver = (fullVarName: string) => Promise<string | undefined>;

export class PresageHandler {
  private readonly module: PresageModule;
  private readonly presageEngines: Record<string, PresageEngine> = {};
  private numSuggestions = SUGGESTION_COUNT;
  private minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT;
  private predictNextWordAfterSeparatorChar = false;
  private insertSpaceAfterAutocomplete = true;
  private autoCapitalize = true;
  private prefixOnlyMode = false;
  private predictionInputProcessor = new PredictionInputProcessor(
    this.minWordLengthToPredict,
    this.autoCapitalize,
  );

  private timeFormat?: string;
  private dateFormat?: string;
  private textExpansionsSignature = "";
  private textExpansionsByShortcut = new Map<string, string>();
  private userDictionarySignature = "";
  private personalizationEnabled = false;
  private readonly getPersonalizationSnapshot: () => PersonalizationRankingSnapshot;
  private readonly now: () => number;

  constructor(Module: PresageModule, options: PresageHandlerOptions = {}) {
    const engineConfig: PresageEngineConfig = {
      numSuggestions: SUGGESTION_COUNT,
      prefixOnlyMode: false,
    };
    this.module = Module;
    this.getPersonalizationSnapshot = options.getPersonalizationSnapshot ?? (() => ({}));
    this.now = options.now ?? Date.now;

    for (const lang of Object.keys(SUPPORTED_LANGUAGES)) {
      if (lang === "auto_detect") {
        continue;
      }
      try {
        this.presageEngines[lang] = new PresageEngine(Module, engineConfig, lang);
      } catch (error) {
        logger.warn("Failed to create Presage engine instance", {
          lang,
          error: getErrorMessage(error),
        });
      }
    }
  }

  setConfig(config: PresageConfig): void {
    const textExpansionsSignature = JSON.stringify(config.textExpansions ?? []);
    const userDictionarySignature = JSON.stringify(config.userDictionaryList ?? []);
    const shouldRefreshEngines =
      textExpansionsSignature !== this.textExpansionsSignature ||
      userDictionarySignature !== this.userDictionarySignature;

    this.numSuggestions = config.numSuggestions;
    this.minWordLengthToPredict = Math.max(0, config.minWordLengthToPredict);
    this.predictNextWordAfterSeparatorChar = this.minWordLengthToPredict === 0;
    this.insertSpaceAfterAutocomplete = config.insertSpaceAfterAutocomplete;
    this.autoCapitalize = config.autoCapitalize;
    this.prefixOnlyMode = config.prefixOnlyMode;
    this.personalizationEnabled = config.personalizationEnabled ?? false;
    this.textExpansionsByShortcut = new Map(
      (config.textExpansions ?? []).flatMap(([shortcut, expansion]) =>
        // Presage drops non-string expansions too (PresageEngine.parsePrediction).
        typeof expansion === "string"
          ? [[shortcut.trim().toLocaleLowerCase(), expansion] as [string, string]]
          : [],
      ),
    );

    this.timeFormat = config.timeFormat;
    this.dateFormat = config.dateFormat;

    if (shouldRefreshEngines) {
      this.refreshPresageEngines();
      this.textExpansionsSignature = textExpansionsSignature;
      this.userDictionarySignature = userDictionarySignature;
    }

    setTextExpansions(this.module, this.presageEngines, config.textExpansions);
    setUserDictionaryList(this.module, this.presageEngines, config.userDictionaryList || []);

    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const presageEngine of Object.values(this.presageEngines)) {
      presageEngine.setConfig({
        numSuggestions: MAX_NUM_SUGGESTIONS,
        prefixOnlyMode: this.prefixOnlyMode,
      });
    }
  }

  getDebugState(): {
    languageEngineCount: number;
  } {
    return {
      languageEngineCount: Object.keys(this.presageEngines).length,
    };
  }

  hasLanguageEngine(lang: string): boolean {
    return lang in this.presageEngines;
  }

  async doPredictionHandler(
    predictionInput: string,
    lang: string,
    tabId?: number,
  ): Promise<string[]> {
    if (!this.hasLanguageEngine(lang)) {
      return [];
    }
    const resolver = this.createResolver(lang, tabId);
    return Promise.all(
      this.presageEngines[lang]
        .predict(predictionInput)
        .map((text) => TemplateExpander.parseStringTemplateAsync(text, resolver)),
    );
  }

  /** One resolver per request; page variables (a chrome.tabs.get each) are fetched once. */
  private createResolver(lang: string, tabId?: number): TemplateResolver {
    const resolve = TemplateExpander.createResolver(
      lang,
      this.timeFormat ?? "",
      this.dateFormat ?? "",
      tabId,
    );
    const pageVariables = new Map<string, Promise<string | undefined>>();
    return (name) => {
      if (!name.startsWith("page_")) {
        return resolve(name);
      }
      let value = pageVariables.get(name);
      if (!value) {
        value = resolve(name);
        pageVariables.set(name, value);
      }
      return value;
    };
  }

  preparePredictionContext(
    text: string,
    nextChar: string,
    lang: string,
    numSuggestionsOverride?: number,
    tabId?: number,
    afterCursorTokenSuffix?: string,
  ): PresagePredictionContext {
    const effectiveNumSuggestions =
      typeof numSuggestionsOverride === "number"
        ? Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(numSuggestionsOverride)))
        : this.numSuggestions;
    const { predictionInput, lastWord, doPrediction, doCapitalize } =
      this.predictionInputProcessor.processInput(
        text,
        lang,
        effectiveNumSuggestions,
        this.predictNextWordAfterSeparatorChar,
        afterCursorTokenSuffix,
      );

    return {
      text,
      nextChar,
      afterCursorTokenSuffix,
      lang,
      predictionInput,
      doPrediction,
      doCapitalize,
      effectiveNumSuggestions,
      tabId,
      snippetToken: /\s$/u.test(predictionInput) ? "" : lastWord.toLocaleLowerCase(),
    };
  }

  async predictPresage(context: PresagePredictionContext): Promise<PredictionCandidate[]> {
    if (
      !context.doPrediction ||
      context.effectiveNumSuggestions <= 0 ||
      !this.hasLanguageEngine(context.lang)
    ) {
      return [];
    }
    const predictions = await this.doPredictionHandler(
      context.predictionInput,
      context.lang,
      context.tabId,
    );
    const ranked =
      !this.personalizationEnabled || this.isTextExpansionRequest(context.predictionInput)
        ? predictions
        : this.rankPersonalized(predictions, context);
    const words = ranked.map((text): PredictionCandidate => ({ text }));
    const snippets = await this.predictSnippets(context, ranked);
    // Keep the top word prediction first so snippets never displace plain autocomplete.
    return [...words.slice(0, 1), ...snippets, ...words.slice(1)];
  }

  /**
   * Snippet expansions matching the word being typed (#366), best match first,
   * minus any whose text is already a word prediction or an earlier snippet.
   * The token length is already gated by minWordLengthToPredict via doPrediction.
   */
  private async predictSnippets(
    context: PresagePredictionContext,
    words: string[],
  ): Promise<PredictionCandidate[]> {
    const fuzzy = context.lang === TEXT_EXPANDER_LANG && !this.prefixOnlyMode;
    const token = context.snippetToken;
    if (!token) {
      return [];
    }
    const matches = [...this.textExpansionsByShortcut]
      .flatMap(([shortcut, expansion]) => {
        const rank = snippetMatchRank(shortcut, token, fuzzy);
        return rank === null ? [] : [{ rank, shortcut, expansion }];
      })
      .sort((a, b) => a.rank - b.rank || a.shortcut.length - b.shortcut.length);
    // Cap at half the list so snippets never crowd out words, but let them fill
    // slots words leave empty. Text Expander has no words to protect.
    const numSuggestions = context.effectiveNumSuggestions;
    const budget =
      context.lang === TEXT_EXPANDER_LANG
        ? numSuggestions
        : Math.max(Math.floor(numSuggestions / 2), numSuggestions - words.length);
    const seen = new Set(words.map(normalizePrediction));
    const resolver = this.createResolver(context.lang, context.tabId);
    const picked: PredictionCandidate[] = [];
    // Resolve one at a time: templates can hit chrome.tabs, so only pay for what is
    // shown, and refill from lower-ranked matches when one collides.
    for (const { shortcut, expansion } of matches) {
      if (picked.length >= budget) {
        break;
      }
      const text = await TemplateExpander.parseStringTemplateAsync(expansion, resolver);
      const key = normalizePrediction(text);
      if (!seen.has(key)) {
        seen.add(key);
        picked.push({ text, snippetShortcut: shortcut });
      }
    }
    return picked;
  }

  private rankPersonalized(predictions: string[], context: PresagePredictionContext): string[] {
    const inputLower = context.predictionInput.trim().toLocaleLowerCase();
    const pinnedCandidates = new Set(
      predictions.filter((candidate) => candidate.toLocaleLowerCase() === inputLower),
    );
    return rankPersonalizedCandidates({
      candidates: predictions,
      language: context.lang,
      snapshot: this.getPersonalizationSnapshot(),
      nowMs: this.now(),
      pinnedCandidates,
    });
  }

  finalizePrediction(
    predictionCandidates: PredictionCandidate[],
    context: PresagePredictionContext,
  ): PredictionResult {
    const { predictionInput, nextChar, doCapitalize, effectiveNumSuggestions } = context;
    const candidates = predictionCandidates.slice(0, effectiveNumSuggestions);
    let predictions = candidates.map(({ text }) => text);
    // Sort prediction so that the most relevant ones are at the top
    // eg. if input is "the act", then "act" will be first and "action" will be second
    if (candidates.length > 1 && predictionInput.trim().length > 0) {
      const inputLower = predictionInput.trim().toLowerCase();
      const isExact = ({ text }: PredictionCandidate) => text.toLowerCase() === inputLower;
      // Stable sort: exact match first, otherwise keep Presage order.
      candidates.sort((a, b) => Number(isExact(b)) - Number(isExact(a)));
      predictions = candidates.map(({ text }) => text);
    }
    if (this.insertSpaceAfterAutocomplete) {
      if (
        nextChar !== undefined &&
        nextChar !== null &&
        (nextChar === "" ||
          nextChar === "\n" ||
          (!isWhiteSpace(nextChar) &&
            (!(nextChar in SPACING_RULES) ||
              SPACING_RULES[nextChar].spaceBefore === Spacing.INSERT_SPACE)))
      ) {
        predictions = predictions.map((pred) => `${pred} `);
      }
    }
    switch (doCapitalize) {
      case Capitalization.FirstLetter:
        predictions = predictions.map((pred) => pred.charAt(0).toUpperCase() + pred.slice(1));
        break;
      case Capitalization.WholeWord:
        predictions = predictions.map((pred) => pred.toUpperCase());
        break;
      case Capitalization.None:
      default:
    }
    if (!candidates.some(({ snippetShortcut }) => snippetShortcut)) {
      return { predictions };
    }
    return {
      predictions,
      snippetShortcuts: candidates.map(({ snippetShortcut }) => snippetShortcut ?? null),
    };
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: { numSuggestions?: number; tabId?: number },
    afterCursorTokenSuffix?: string,
  ): Promise<PredictionResult> {
    const context = this.preparePredictionContext(
      text,
      nextChar,
      lang,
      configOverride?.numSuggestions,
      configOverride?.tabId,
      afterCursorTokenSuffix,
    );
    const predictions = await this.predictPresage(context);
    return this.finalizePrediction(predictions, context);
  }

  private refreshPresageEngines(): void {
    for (const presageEngine of Object.values(this.presageEngines)) {
      presageEngine.reinitialize();
    }
  }

  private isTextExpansionRequest(predictionInput: string): boolean {
    const finalToken = predictionInput.trim().split(/\s+/u).at(-1)?.toLocaleLowerCase();
    return finalToken ? this.textExpansionsByShortcut.has(finalToken) : false;
  }
}
