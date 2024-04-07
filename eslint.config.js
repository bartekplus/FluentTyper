import js from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

export default [
  {
    files: ["**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      sourceType: "module",
    },
    rules: {
      semi: "error",
      "no-unused-vars": "error",
      "no-var": 1,
      "prefer-const": 1,
      eqeqeq: 1,
      "no-extra-bind": 1,
      "no-implicit-coercion": 1,
      strict: 1,
    },
  },
  {
    ignores: ["**/src/third_party/", "**/scripts/"],
  },
  eslintPluginPrettierRecommended,
];
