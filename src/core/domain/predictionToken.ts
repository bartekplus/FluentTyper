export const KEEP_PREDICTION_TOKEN_CHARS_REGEX = /\[|\(|{|<|\/|-|\*|\+|=|"/;

export function extractPredictionTokenSuffix(
  value: string,
  isSeparator: (char: string) => boolean,
): string {
  let end = 0;
  while (end < value.length) {
    const current = value.charAt(end);
    if (isSeparator(current) && !KEEP_PREDICTION_TOKEN_CHARS_REGEX.test(current)) {
      break;
    }
    end += 1;
  }
  return value.slice(0, end);
}
