import type { PredictionModeContext } from "./types";

export class PromptBuilder {
  constructor(private readonly maxGenerationChoices: number) {}

  resolvePredictionMode(predictionInput: string): PredictionModeContext {
    const trimmedInput = predictionInput.trim();
    const endsWithSpace = predictionInput !== predictionInput.trimEnd();
    if (trimmedInput.length === 0 || endsWithSpace) {
      return {
        mode: "next_word",
        fragment: "",
      };
    }
    const fragmentMatch = trimmedInput.match(/([\p{L}\p{N}'-]+)$/u);
    const fragment = (fragmentMatch?.[1] || "").toLowerCase();
    if (!fragment) {
      return {
        mode: "next_word",
        fragment: "",
      };
    }
    return {
      mode: "complete_or_correct",
      fragment,
    };
  }

  buildPrompt(
    predictionInput: string,
    lang: string,
    numSuggestions: number,
    modeContext: PredictionModeContext,
  ): string {
    const languageLabel = lang.replace("_", "-");
    const safeText = predictionInput.trim() || "<empty>";
    const count = Math.min(this.maxGenerationChoices, Math.max(1, numSuggestions));
    if (modeContext.mode === "complete_or_correct") {
      return [
        `You are a typing autocomplete assistant for language ${languageLabel}.`,
        `Given the text and current last-word fragment, output ${count} likely completed or corrected full-word candidates for that fragment only.`,
        "Rules:",
        "- return each candidate on a new line",
        "- single word only",
        "- no punctuation, numbering, or explanations",
        "- do not predict the next word after the current fragment",
        "- if the fragment has a typo, return corrected words",
        `Context: ${safeText}`,
        `Current fragment: ${modeContext.fragment || "<empty>"}`,
        "Examples:",
        '- Context: "This is sup" -> super',
        '- Context: "This is amazgi" -> amazing',
        "Candidates:",
      ].join("\n");
    }
    return [
      `You are a typing autocomplete assistant for language ${languageLabel}.`,
      `Given text context, output ${count} likely next single-word completions.`,
      "Rules:",
      "- return each candidate on a new line",
      "- do not number items",
      "- no punctuation, no explanations",
      "- return only the next word (context already ends with a space)",
      `Context: ${safeText}`,
      "Completions:",
    ].join("\n");
  }

  buildChatMessages(
    predictionInput: string,
    lang: string,
    numSuggestions: number,
    modeContext: PredictionModeContext,
  ): Array<{ role: "system" | "user"; content: string }> {
    const languageLabel = lang.replace("_", "-");
    const safeText = predictionInput.trim() || "<empty>";
    const count = Math.min(this.maxGenerationChoices, Math.max(1, numSuggestions));
    if (modeContext.mode === "complete_or_correct") {
      return [
        {
          role: "system",
          content: [
            `You are a typing autocomplete assistant for language ${languageLabel}.`,
            "Complete or correct only the current last word fragment.",
            "Return only candidate full words.",
            "No explanations, no numbering, no punctuation.",
            "If the fragment is misspelled, return corrected words.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Context: ${safeText}`,
            `Current fragment: ${modeContext.fragment || "<empty>"}`,
            `Return ${count} likely completed or corrected full words for this fragment.`,
            "Do not predict the next word.",
            'Example: "This is sup" -> "super"',
            'Example: "This is amazgi" -> "amazing"',
            "One candidate per line.",
          ].join("\n"),
        },
      ];
    }
    return [
      {
        role: "system",
        content: [
          `You are a typing autocomplete assistant for language ${languageLabel}.`,
          "Return only next-word candidates.",
          "No explanations, no numbering, no punctuation.",
          "Context ends with a space, so predict the next word only.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Context: ${safeText}`,
          `Return ${count} likely next single-word completions.`,
          "One completion per line.",
        ].join("\n"),
      },
    ];
  }

  buildSimpleChatMessages(
    predictionInput: string,
    numSuggestions: number,
    modeContext: PredictionModeContext,
  ): Array<{ role: "user"; content: string }> {
    const safeText = predictionInput.trim() || "<empty>";
    const count = Math.min(this.maxGenerationChoices, Math.max(1, numSuggestions));
    if (modeContext.mode === "complete_or_correct") {
      return [
        {
          role: "user",
          content: [
            `Text context: "${safeText}"`,
            `Current fragment: "${modeContext.fragment || "<empty>"}"`,
            `Return ${count} full-word completions/corrections for the current fragment only.`,
            'Example: "This is sup" -> "super"',
            'Example: "This is amazgi" -> "amazing"',
            "Output only comma-separated single words.",
          ].join("\n"),
        },
      ];
    }
    return [
      {
        role: "user",
        content: `Complete the text "${safeText}" with ${count} likely next single words. Return only comma-separated words.`,
      },
    ];
  }
}
