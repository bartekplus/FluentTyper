import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import { fileURLToPath } from "url";

const ALL_CODE_FILES = ["**/*.{js,mjs,cjs,ts,mts,cts}"];
const SOURCE_FILES = ["src/**/*.{js,mjs,cjs,ts,mts,cts,d.ts}"];
const TEST_FILES = ["tests/**/*.{js,mjs,cjs,ts,mts,cts}"];
const TOOLING_FILES = ["build.ts", "eslint.config.js", "scripts/**/*.{js,mjs,cjs,ts,mts,cts}"];
const MODULE_FILES = ["src/**/*.{ts,mts,cts,d.ts}"];
const ESLINT_CONFIG_DIR = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig([
  {
    ignores: [
      ".cache/**",
      ".claude/**",
      ".tmp/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "public/third_party/**",
      "src/third_party/**",
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    files: ALL_CODE_FILES,
    plugins: { js },
    extends: ["js/recommended"],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    files: MODULE_FILES,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: ESLINT_CONFIG_DIR,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: TEST_FILES,
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: TOOLING_FILES,
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: SOURCE_FILES,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
  },
  {
    files: TEST_FILES,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.jest,
        ...globals.node,
        ...globals.bunBuiltin,
      },
    },
  },
  {
    files: TOOLING_FILES,
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.bunBuiltin,
      },
    },
  },
  {
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "prefer-template": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          disallowTypeAnnotations: false,
        },
      ],
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/no-meaningless-void-operator": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-arguments": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-useless-constructor": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unified-signatures": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      curly: ["error", "all"],
      "object-shorthand": ["error", "always"],
      "prefer-template": "error",
    },
  },
  {
    files: ["src/**/*.{ts,mts,cts,d.ts}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
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
              message: "Legacy module roots are deprecated. Import from @core, @adapters, or @ui.",
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
              message: "Background adapter must not import content-script modules directly.",
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
              message: "Content-script adapter must not import background modules directly.",
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
