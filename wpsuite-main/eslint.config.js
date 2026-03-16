import jseslint from "@eslint/js";
import { defineConfig } from 'eslint/config';
import globals from "globals";
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/build/**', '**/dist/**', '**/webpack.config.cjs'] },
  jseslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.tsx", "**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  }
);
