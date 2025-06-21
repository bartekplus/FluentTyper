import { SUPPORTED_LANGUAGES } from "../shared/lang";
import { isWhiteSpace } from "../shared/utils";
import {
  SpacingRulesHandler,
  Spacing,
  SPACING_RULES,
} from "./SpacingRulesHandler";
import { Capitalization } from "./CapitalizationHelper";
import { PredictionInputProcessor } from "./PredictionInputProcessor";
import { TemplateExpander, TemplateVariables } from "./TemplateExpander";
import { PresageModule } from "./PresageTypes";
import { UserDictionaryManager } from "./UserDictionaryManager";
import { TextExpansionManager } from "./TextExpansionManager";
import { PresageEngine, PresageEngineConfig } from "./PresageEngine";
import { ForceReplaceType } from "../shared/messageTypes";

const SUGGESTION_COUNT = 5;
const MIN_WORD_LENGTH_TO_PREDICT = 1;

export interface PredictionResult {
  predictions: string[];
  forceReplace: ForceReplaceType | null;
}

interface LastPrediction {
  pastStream: string;
  predictions: string[];
}

export type PresageConfig = {
  numSuggestions: number;
  minWordLengthToPredict: number;
  insertSpaceAfterAutocomplete: boolean;
  autoCapitalize: boolean;
  applySpacingRules: boolean;
  textExpansions: Array<[string, object]>;
  variableExpansion?: boolean;
  timeFormat?: string;
  dateFormat?: string;
  userDictionaryList?: string[];
};

export class PresageHandler {
  private presageEngines: Record<string, PresageEngine>;
  private lastPrediction: Record<string, LastPrediction>;
  private numSuggestions: number;
  private minWordLengthToPredict: number;
  private predictNextWordAfterSeparatorChar: boolean;
  private insertSpaceAfterAutocomplete: boolean;
  private autoCapitalize: boolean;
  private userDictionaryList: string[];
  private spacingHandler: SpacingRulesHandler;
  private predictionInputProcessor: PredictionInputProcessor;
  private textExpansionManager: TextExpansionManager;
  private userDictionaryManager: UserDictionaryManager;
  private variableExpansion?: boolean;
  private timeFormat?: string;
  private dateFormat?: string;

  constructor(Module: PresageModule) {
    const engineConfig: PresageEngineConfig = {
      numSuggestions: SUGGESTION_COUNT,
    };
    this.presageEngines = {};
    this.lastPrediction = {};
    this.numSuggestions = SUGGESTION_COUNT;
    this.minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT;
    this.predictNextWordAfterSeparatorChar = false;
    this.insertSpaceAfterAutocomplete = true;
    this.autoCapitalize = true;
    this.userDictionaryList = [];
    this.spacingHandler = new SpacingRulesHandler(
      this.insertSpaceAfterAutocomplete,
      false,
    );
    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (lang === "auto_detect") continue;
      try {
        this.lastPrediction[lang] = { pastStream: "", predictions: [] };
        this.presageEngines[lang] = new PresageEngine(
          Module,
          engineConfig,
          lang,
        );
      } catch (error) {
        console.log(
          "Failed to create Presage instance for %s language: %s",
          lang,
          error,
        );
      }
    }
    this.textExpansionManager = new TextExpansionManager(
      Module,
      this.presageEngines,
    );
    this.userDictionaryManager = new UserDictionaryManager(
      Module,
      this.presageEngines,
    );
  }

  setConfig(config: PresageConfig): void {
    this.numSuggestions = config.numSuggestions;
    this.minWordLengthToPredict = Math.max(0, config.minWordLengthToPredict);
    this.predictNextWordAfterSeparatorChar =
      this.minWordLengthToPredict === 0 ? true : false;
    this.insertSpaceAfterAutocomplete = config.insertSpaceAfterAutocomplete;
    this.autoCapitalize = config.autoCapitalize;
    this.variableExpansion = config.variableExpansion;
    this.timeFormat = config.timeFormat;
    this.dateFormat = config.dateFormat;
    this.userDictionaryList = config.userDictionaryList || [];
    this.textExpansionManager.setTextExpansions(config.textExpansions);
    this.userDictionaryManager.setUserDictionaryList(this.userDictionaryList);
    this.spacingHandler = new SpacingRulesHandler(
      config.insertSpaceAfterAutocomplete,
      config.applySpacingRules,
    );
    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const [, presageEngine] of Object.entries(this.presageEngines)) {
      presageEngine.setConfig({
        numSuggestions: this.numSuggestions,
      });
    }
  }

  parseStringTemplate(str: string, obj: TemplateVariables): string {
    return TemplateExpander.parseStringTemplate(str, obj);
  }

  getExpandedVariables(lang: string): TemplateVariables {
    return TemplateExpander.getExpandedVariables(
      lang,
      this.variableExpansion ?? false,
      this.timeFormat ?? "",
      this.dateFormat ?? "",
    );
  }

  removePrevSentence(wordArrayOrig: string[]): {
    wordArray: string[];
    foundNewSentence: boolean;
  } {
    const result =
      this.predictionInputProcessor.removePrevSentence(wordArrayOrig);
    return {
      wordArray: result.wordArray,
      foundNewSentence: result.newSentence,
    };
  }

  processInput(
    predictionInput: string,
    language: string,
  ): {
    predictionInput: string;
    lastWord: string;
    doPrediction: boolean;
    doCapitalize: Capitalization;
  } {
    return this.predictionInputProcessor.processInput(
      predictionInput,
      language,
      this.numSuggestions,
      this.predictNextWordAfterSeparatorChar,
    );
  }

  doPredictionHandler(predictionInput: string, lang: string): string[] {
    if (predictionInput === this.lastPrediction[lang]?.pastStream) {
      return this.lastPrediction[lang].predictions.slice();
    }
    const predictions = this.presageEngines[lang].predict(predictionInput);
    const expandedTemplateVariables = this.getExpandedVariables(lang);
    const expandedPredictions = predictions.map((text) =>
      this.parseStringTemplate(text, expandedTemplateVariables),
    );
    this.lastPrediction[lang] = {
      pastStream: predictionInput,
      predictions: expandedPredictions.slice(),
    };
    return expandedPredictions;
  }

  runPrediction(
    text: string,
    nextChar: string,
    lang: string,
  ): PredictionResult {
    let predictions: string[] = [];
    const { predictionInput, doPrediction, doCapitalize } = this.processInput(
      text,
      lang,
    );
    const forceReplace = this.spacingHandler.applySpacingRules(text);
    if (!(lang in this.presageEngines)) {
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

  getLastPredictionInput(lang: string): string {
    if (lang in this.lastPrediction) {
      return this.lastPrediction[lang].pastStream;
    }
    return "";
  }
}
