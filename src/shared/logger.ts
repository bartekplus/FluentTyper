import Debug from "debug";

const APP_NAME = "fluentTyper";

function getFileName(): string {
  // Try to get the caller file name from the stack trace
  const err = new Error();
  // If the stack is not available, return "unknown"
  if (err.stack) {
    const stackLines = err.stack.split("\n");
    for (const line of stackLines) {
      // Chrome/Node style: at ... (file:line:col)
      let match = line.match(/\(([^)]+)\)/);
      if (match && !match[1].includes("logger.ts")) {
        const parts = match[1].split("/");
        return parts[parts.length - 1].split(":")[0];
      }
      // Firefox/extension style: func@file:line:col
      match = line.match(/@(.+?):\d+:\d+/);
      if (match && !match[1].includes("logger.ts")) {
        const parts = match[1].split("/");
        return parts[parts.length - 1];
      }
    }
  }
  return "unknown";
}

function makeLogger(level: string, logFn: (...args: any[]) => void) {
  return (...args: any[]) => {
    const file = getFileName();
    const logger = Debug(`${APP_NAME}:${file}:${level}`);
    logger.log = logFn.bind(console);
    (logger as unknown as (...args: any[]) => void)(...args);
  };
}

export const info = makeLogger("debug", console.info);
export const debug = makeLogger("debug", console.log);
export const error = makeLogger("error", console.error);
export const warning = makeLogger("warning", console.warn);
export const stackTrace = makeLogger("trace", console.trace);
