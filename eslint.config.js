import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

// Files created by the UI-primitives initiative are held to error severity;
// everything else lints as warn until it is cleaned up.
const NEW_CODE_FILES = ["src/client/components/ui/**/*.{vue,ts}"];

const withSeverity = (config, severity) => {
  if (!config.rules) return config;
  const rules = Object.fromEntries(Object.keys(config.rules).map((name) => [name, severity]));
  return { ...config, rules };
};

const vueEssentialWarn = pluginVue.configs["flat/essential"].map((config) => withSeverity(config, "warn"));
const vueEssentialErrorRules = Object.fromEntries(
  pluginVue.configs["flat/essential"].flatMap((config) => Object.keys(config.rules ?? {})).map((name) => [name, "error"])
);

const coreRules = {
  eqeqeq: "warn",
  "no-var": "warn",
  "prefer-const": "warn"
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "output/**", "storage/**", "prototype/**", "public/**"]
  },
  ...vueEssentialWarn,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser
    },
    rules: coreRules
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    },
    rules: coreRules
  },
  {
    files: NEW_CODE_FILES,
    rules: {
      ...vueEssentialErrorRules,
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error"
    }
  }
];
