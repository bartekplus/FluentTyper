import type { Config } from "jest";

const config: Config = {
  testMatch: ["**/tests/e2e/*.test.ts"],
  moduleNameMapper: {
    "^@core/(.*)$": "<rootDir>/src/core/$1",
    "^@adapters/(.*)$": "<rootDir>/src/adapters/$1",
    "^@ui/(.*)$": "<rootDir>/src/ui/$1",
    "^@third-party/(.*)$": "<rootDir>/src/third_party/$1",
  },
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  testTimeout: 60000,
};

export default config;
