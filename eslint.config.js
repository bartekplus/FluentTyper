import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

const MODULE_FILES = ["src/**/*.{ts,mts,cts,d.ts}"];

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.jest,
      },
    },
  },
  {
    ignores: [
      "**/build/",
      "**/public/third_party/",
      "**/src/third_party/",
      "**/scripts/",
      "**/coverage/",
    ],
  },
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: MODULE_FILES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["src/background/*", "src/content-script/*", "src/shared/*"],
              message:
                "Legacy module roots are deprecated. Import from @core, @adapters, or @ui.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/domain/**/*.{ts,mts,cts,d.ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@core/application/*", "@adapters/*", "@ui/*"],
              message: "Domain must not depend on application, adapters, or UI.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/application/**/*.{ts,mts,cts,d.ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@adapters/*", "@ui/*"],
              message: "Application must not depend on adapters or UI.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/chrome/**/*.{ts,mts,cts,d.ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ui/*"],
              message: "Adapters must not depend on UI.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/chrome/background/**/*.{ts,mts,cts,d.ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@adapters/chrome/content-script/*"],
              message:
                "Background adapter must not import content-script modules directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/chrome/content-script/**/*.{ts,mts,cts,d.ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@adapters/chrome/background/*"],
              message:
                "Content-script adapter must not import background modules directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/ui/**/*.{ts,mts,cts,d.ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@adapters/chrome/background/*", "@adapters/chrome/content-script/*"],
              message: "UI modules must not depend on adapter internals.",
            },
          ],
        },
      ],
    },
  },
]);
