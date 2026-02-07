import type { Config } from "jest";

const config: Config = {
  testMatch: ["**/tests/*test*"],
  testEnvironment: "jsdom",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
};

export default config;
