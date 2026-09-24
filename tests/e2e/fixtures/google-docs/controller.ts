if (!crypto.randomUUID)
  Object.defineProperty(crypto, "randomUUID", {
    value: () =>
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
  });
import { SuggestionManagerRuntime } from "../../../../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";
import { GoogleDocsAdapter } from "../../../../src/adapters/chrome/content-script/google-docs/GoogleDocsAdapter";
import type {
  SuggestionManagerOptions,
  PredictionRequest,
} from "../../../../src/adapters/chrome/content-script/suggestions/types";
const fixture = globalThis as unknown as {
  docs: GoogleDocsAdapter;
  generic: SuggestionManagerRuntime;
  requests: PredictionRequest[];
  events: string[];
  predictions: string[];
  snippetShortcuts: Array<string | null>;
  startDocs: (options?: Partial<SuggestionManagerOptions>) => void;
};
fixture.predictions = ["hello", "help", "helmet"];
fixture.snippetShortcuts = [];
fixture.events = [];
fixture.requests = [];
fixture.startDocs = (options = {}) => {
  fixture.docs?.dispose();
  fixture.generic?.detachAllHelpers();
  const config: SuggestionManagerOptions = {
    selectors: "textarea,input,[contentEditable]",
    lang: "en_US",
    autocomplete: false,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    selectByDigit: true,
    displayLangHeader: true,
    inline_suggestion: false,
    preferNativeAutocomplete: true,
    userDictionaryList: [],
    enabledGrammarRules: [],
    telemetry: {
      recordSuggestionShown: () => fixture.events.push("shown"),
      recordSuggestionAccepted: () => fixture.events.push("accepted"),
    },
    personalization: {
      recordSuggestionAccepted: () => {
        fixture.events.push("learned");
        return "learning-id";
      },
      recordSuggestionReverted: () => fixture.events.push("reverted"),
    },
    getPrediction: (context) => {
      fixture.requests.push(context);
      queueMicrotask(() => {
        const response = {
          ...context,
          predictions: fixture.predictions.slice(),
          snippetShortcuts: fixture.snippetShortcuts.slice(),
          lang: context.lang,
        };
        if (context.suggestionId === -1) fixture.docs.fulfillPrediction(response);
        else fixture.generic.fulfillPrediction(response);
      });
    },
    ...options,
  };
  fixture.generic = new SuggestionManagerRuntime(config);
  fixture.generic.queryAndAttachHelper();
  fixture.docs = new GoogleDocsAdapter(config);
  fixture.docs.start();
};
fixture.startDocs();
