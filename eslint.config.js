import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// The game is written in .js/.jsx — there are no .ts/.tsx files under src/ at
// all — so a config matching only ts/tsx linted NOTHING. `npm run lint` passed
// on every commit while `no-undef` never ran — which is how an undefined
// identifier reaches a player as a white screen. That is exactly the class of
// bug linting exists to catch, so the glob now covers what the project is
// actually written in.
//
// The rules below are set to `warn` rather than `error` on purpose: they are
// pre-existing findings across the tree, and turning them into errors would
// make `npm run lint` fail everywhere on day one, which is how a lint step gets
// ignored. They are visible, and the correctness rules that matter — no-undef
// above all — are hard errors.
export default defineConfig([
  globalIgnores(['dist', 'dist-web', 'dist-site', 'release', 'server/data', 'mobile/www', 'mobile/android', 'fmg', 'node-content']),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Pre-existing, and each needs a human decision about the dependency list
      // rather than a blind fix — a wrong dep array causes stale renders or
      // infinite loops, both worse than the warning.
      'react-hooks/exhaustive-deps': 'warn',
      // Deliberate: the control characters are in a regex that strips them.
      'no-control-regex': 'warn',
      // Prompt text is full of escaped quotes inside template literals; the
      // "unnecessary" escapes are harmless and rewriting them risks changing
      // what the model is told.
      'no-useless-escape': 'warn',
      // Off: 228 findings across the tree, almost all deliberate (re-exports,
      // destructured-but-unused fields, JSX-only imports the parser cannot see).
      // Left on, it buries the one rule that matters.
      'no-unused-vars': 'off',
      // Pre-existing React patterns, 65 of them. Real issues worth fixing one day,
      // but each needs judgement about a specific component, and as errors they
      // would fail the lint everywhere on day one — which is how a lint step gets
      // ignored and stops catching anything.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/globals': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended, reactRefresh.configs.vite],
  },
])
