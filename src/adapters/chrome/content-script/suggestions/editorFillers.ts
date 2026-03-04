const ONLY_FILLERS_REGEX = /^(?:\u200B|\u200C|\u200D|\u2060|\uFEFF)*$/;
const TRAILING_FILLERS_REGEX = /(?:\u200B|\u200C|\u200D|\u2060|\uFEFF)+$/g;

export function isOnlyFillers(text: string): boolean {
  return ONLY_FILLERS_REGEX.test(text);
}

export function trimTrailingFillers(text: string): string {
  return text.replace(TRAILING_FILLERS_REGEX, "");
}
