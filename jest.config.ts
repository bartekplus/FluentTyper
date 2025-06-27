import type { Config } from "jest";

const config: Config = {
  testMatch: ["**/tests/*test*"],
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
};

export default config;
