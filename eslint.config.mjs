import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["out/", "test-out/", "dist/", "test-dist/", "**/*.d.ts", "node_modules/", "lib/"],
  },
  eslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["src/**/*.ts"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        NodeJS: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "off",
    },
  },
  {
    files: ["src/ui/webview/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        document: "readonly",
        window: "readonly",
        console: "readonly",
        acquireVsCodeApi: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        MutationObserver: "readonly",
        HTMLElement: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      curly: "warn",
      eqeqeq: "warn",
      semi: "off",
    },
  }
);
