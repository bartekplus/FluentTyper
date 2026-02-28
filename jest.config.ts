import type { Config } from "jest";

const config: Config = {
  testMatch: ["**/tests/*test*"],
  testEnvironment: "jsdom",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^@core/(.*)$": "<rootDir>/src/core/$1",
    "^@adapters/(.*)$": "<rootDir>/src/adapters/$1",
    "^@ui/(.*)$": "<rootDir>/src/ui/$1",
    "^@third-party/(.*)$": "<rootDir>/src/third_party/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
};

export default config;
