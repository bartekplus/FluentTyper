import type { Config } from "jest";

const config: Config = {
  testMatch: ["**/tests/e2e/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  testTimeout: 60000,
};

export default config;
