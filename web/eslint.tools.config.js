import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/bin/**"] },
  {
    ...js.configs.recommended,
    files: [
      "desktop/**/*.cjs",
      "scripts/*.{cjs,mjs}",
      "compat/headlamp/build.mjs",
    ],
    languageOptions: { ecmaVersion: "latest", globals: globals.node },
  },
  {
    ...js.configs.recommended,
    files: ["compat/headlamp/src/**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    plugins: { react },
    rules: {
      ...js.configs.recommended.rules,
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-key": "error",
    },
  },
];
