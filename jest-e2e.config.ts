import type { Config } from "jest";

const config: Config = {
  testMatch: ["**/tests/e2e/*"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
};

export default config;
