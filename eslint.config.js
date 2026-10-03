import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  // `local-files/` is the repo's scratch area - the live probe and the demo
  // frontend live there, gitignored and published nowhere. Without this,
  // linting the repo walks into a built React bundle and reports two hundred
  // errors about `window`, which turns a real gate into noise people learn to
  // scroll past.
  { ignores: ["dist/**", "node_modules/**", "local-files/**"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser, parserOptions: { sourceType: "module" } },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Off for TypeScript, as typescript-eslint itself recommends: `tsc`
      // already resolves every identifier, and eslint's own scope analysis does
      // not know the platform lib, so it reports `URL` and `console` as undefined.
      "no-undef": "off",
      // A type-level assertion IS a `_`-prefixed alias no runtime code can
      // consume. Without this the assertions read as dead code and get deleted.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Tests introspect the opaque exported bundle, which has no useful type.
    // Source stays `any`-free - this exemption is for test/ alone.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
