import { SUPPORTED_LANGUAGES } from "../shared/lang";
import { isWhiteSpace } from "../shared/utils";
import { SpacingRulesHandler, Spacing, SPACING_RULES } from "./spacingRulesHandler";
import { Capitalization } from "./capitalizationHelper";
import { PredictionInputProcessor } from "./predictionInputProcessor";
import { TemplateExpander, TemplateVariables } from "./TemplateExpander";
import { PresageModule, PresageInstance } from "./PresageTypes";
import { UserDictionaryManager } from "./UserDictionaryManager";
import { TextExpansionManager } from "./TextExpansionManager";
import { PresageEngine } from "./PresageEngine";

const SUGGESTION_COUNT = 5;
const MIN_WORD_LENGTH_TO_PREDICT = 1;

export interface PredictionResult {
  predictions: string[];
  forceReplace: string | null;
}

interface LastPrediction {
  pastStream: string;
  predictions: string[];
}

interface LibPresageCallback {
  pastStream: string;
  get_past_stream: () => string;
  get_future_stream: () => string;
}

export class PresageHandler {
  private Module: PresageModule;
  private presageEngine: PresageEngine;
  private lastPrediction: Record<string, LastPrediction>;
  private libPresage: Record<string, PresageInstance>;
  private libPresageCallback: Record<string, LibPresageCallback>;
  private libPresageCallbackImpl: Record<string, unknown>;
  private numSuggestions: number;
  private minWordLengthToPredict: number;
  private predictNextWordAfterSeparatorChar: boolean;
  private insertSpaceAfterAutocomplete: boolean;
  private autoCapitalize: boolean;
  private applySpacingRules: boolean;
  private userDictionaryList: string[];
  private spacingHandler: SpacingRulesHandler;
  private predictionInputProcessor: PredictionInputProcessor;
  private textExpansionManager: TextExpansionManager;
  private userDictionaryManager: UserDictionaryManager;
  private variableExpansion?: boolean;
  private timeFormat?: string;
  private dateFormat?: string;

  constructor(Module: PresageModule) {
    this.Module = Module;
    const engineConfig = {
      numSuggestions: SUGGESTION_COUNT,
      minWordLengthToPredict: MIN_WORD_LENGTH_TO_PREDICT,
      insertSpaceAfterAutocomplete: true,
    };
    this.presageEngine = new PresageEngine(Module, engineConfig);
    this.lastPrediction = {};
    this.libPresage = {};
    this.libPresageCallback = {};
    this.libPresageCallbackImpl = {};
    this.numSuggestions = SUGGESTION_COUNT;
    this.minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT;
    this.predictNextWordAfterSeparatorChar = false;
    this.insertSpaceAfterAutocomplete = true;
    this.autoCapitalize = true;
    this.applySpacingRules = false;
    this.userDictionaryList = [];
    this.spacingHandler = new SpacingRulesHandler(
      this.insertSpaceAfterAutocomplete);
    this.predictionInputProcessor = new PredictionInputProcessor(
      MIN_WORD_LENGTH_TO_PREDICT,
      this.autoCapitalize
    );
    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (lang === "auto_detect") continue;
      try {
        this.lastPrediction[lang] = { pastStream: "", predictions: [] };
        this.libPresageCallback[lang] = {
          pastStream: "",
          get_past_stream: function () {
            return this.pastStream;
          },
          get_future_stream: function () {
            return "";
          },
        };
        this.libPresageCallbackImpl[lang] =
          this.Module.PresageCallback.implement(this.libPresageCallback[lang]);
        this.libPresage[lang] = new this.Module.Presage(
          this.libPresageCallbackImpl[lang],
          "resources_js/" + lang + "/presage.xml",
        ) as PresageInstance;
      } catch (error) {
        console.log(
          "Failed to create Presage instance for %s language: %s",
          lang,
          error,
        );
      }
    }
    this.textExpansionManager = new TextExpansionManager(this.Module as PresageModule, this.libPresage);
    this.userDictionaryManager = new UserDictionaryManager(this.Module as PresageModule, this.libPresage);
  }

  setConfig(
    numSuggestions: number,
    minWordLengthToPredict: number,
    insertSpaceAfterAutocomplete: boolean,
    autoCapitalize: boolean,
    applySpacingRules: boolean,
    textExpansions: Array<[string, object]>,
    variableExpansion?: boolean,
    timeFormat?: string,
    dateFormat?: string,
    userDictionaryList?: string[],
  ): void {
    this.numSuggestions = numSuggestions;
    this.minWordLengthToPredict = Math.max(0, minWordLengthToPredict);
    this.predictNextWordAfterSeparatorChar = this.minWordLengthToPredict === 0 ? true : false;
    this.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
    this.autoCapitalize = autoCapitalize;
    this.applySpacingRules = applySpacingRules;
    this.variableExpansion = variableExpansion;
    this.timeFormat = timeFormat;
    this.dateFormat = dateFormat;
    this.userDictionaryList = userDictionaryList || [];
    this.textExpansionManager.setTextExpansions(textExpansions);
    this.userDictionaryManager.setUserDictionaryList(this.userDictionaryList);
    this.spacingHandler = new SpacingRulesHandler(insertSpaceAfterAutocomplete);
    this.presageEngine.setConfig({
      numSuggestions,
      minWordLengthToPredict,
      insertSpaceAfterAutocomplete,
    });
  }

  parseStringTemplate(str: string, obj: TemplateVariables): string {
    return TemplateExpander.parseStringTemplate(str, obj);
  }

  getExpandedVariables(lang: string): TemplateVariables {
    return TemplateExpander.getExpandedVariables(
      lang,
      this.variableExpansion ?? false,
      this.timeFormat ?? "",
      this.dateFormat ?? ""
    );
  }

  removePrevSentence(wordArrayOrig: string[]): { wordArray: string[]; foundNewSentence: boolean } {
    const result = this.predictionInputProcessor.removePrevSentence(wordArrayOrig);
    return { wordArray: result.wordArray, foundNewSentence: result.newSentence };
  }

  checkDoPrediction(lastWord: string, endsWithSpace: boolean): boolean {
    return this.predictionInputProcessor.checkDoPrediction(
      lastWord,
      endsWithSpace,
      this.numSuggestions,
      this.predictNextWordAfterSeparatorChar
    );
  }

  processInput(
    predictionInput: string,
    language: string
  ): { predictionInput: string; lastWord: string; doPrediction: boolean; doCapitalize: Capitalization } {
    return this.predictionInputProcessor.processInput(
      predictionInput,
      language,
      this.numSuggestions,
      this.predictNextWordAfterSeparatorChar
    );
  }

  doPredictionHandler(predictionInput: string, lang: string): string[] {
    const predictions = this.presageEngine.predict(predictionInput, lang);
    const expandedTemplateVariables = this.getExpandedVariables(lang);
    return predictions.map(text => this.parseStringTemplate(text, expandedTemplateVariables));
  }

  runPrediction(text: string, nextChar: string, lang: string): PredictionResult {
    let predictions: string[] = [];
    let forceReplace: string | null = null;
    const { predictionInput, doPrediction, doCapitalize } = this.processInput(
      text,
      lang,
    );
    if (this.applySpacingRules && this.spacingHandler instanceof SpacingRulesHandler) {
      const spacingResult = this.spacingHandler.applySpacingRules(text);
      forceReplace = spacingResult ? spacingResult.text : null;
    }
    if (!this.presageEngine.hasLanguage(lang)) {
      // Do nothing, reply with empty predictions
    } else if (!forceReplace && doPrediction) {
      predictions = this.doPredictionHandler(predictionInput, lang);
    }
    if (this.insertSpaceAfterAutocomplete) {
      if (
        !isWhiteSpace(nextChar, false) &&
        (!(nextChar in SPACING_RULES) ||
          SPACING_RULES[nextChar].spaceBefore === Spacing.INSERT_SPACE)
      ) {
        predictions = predictions.map((pred) => `${pred}\xA0`);
      }
    }
    switch (doCapitalize) {
      case Capitalization.FirstLetter:
        predictions = predictions.map(
          (pred) => pred.charAt(0).toUpperCase() + pred.slice(1),
        );
        break;
      case Capitalization.WholeWord:
        predictions = predictions.map((pred) => pred.toUpperCase());
        break;
      case Capitalization.None:
      default:
    }
    return { predictions, forceReplace };
  }
}
