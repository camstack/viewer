// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * A VALUE from `@dominevo/types` comes from `@dominevo/types/client` (or the
 * tiny `/enums` entry) — never from the bare root (D721 in dominevo-server).
 * The root is one pre-bundled module carrying every capability schema and
 * Metro does not tree-shake, so one value import from it drags ~1.2 MB into
 * the bundle. Types are erased, so `import type { … } from '@dominevo/types'`
 * stays allowed for the types the client entry does not export.
 *
 * Specs are exempt: they never reach a bundle, and some assert against server
 * schemas the client entry deliberately leaves out. The same rule is enforced
 * without lint by `scripts/check-types-client-imports.mjs` (in `ts-check`).
 */
const TYPES_ROOT_VALUE_IMPORT = {
  files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}', 'embed/**/*.{ts,tsx}'],
  ignores: ['**/__tests__/**', '**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}', 'src/testing/**'],
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@dominevo/types',
            allowTypeImports: true,
            message:
              "Import values from '@dominevo/types/client' (or '/enums'). The bare entry is the whole 2.7 MB barrel and Metro does not tree-shake it. A value missing from /client is added to packages/types/src/client.ts in dominevo-server.",
          },
        ],
      },
    ],
  },
};

/**
 * Specs build trees with `React.createElement` in `.ts` files, and a provider
 * whose props type REQUIRES `children` can only be satisfied by passing it in
 * the props object — the third-argument form does not type-check against it.
 * `react/no-children-prop` is a JSX-style rule; in a spec it has no reader.
 */
const SPEC_CREATE_ELEMENT = {
  files: ['**/__tests__/**', '**/*.spec.{ts,tsx}'],
  rules: {
    'react/no-children-prop': 'off',
  },
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'embed-dist/*', 'embed-ota-dist/*'],
  },
  TYPES_ROOT_VALUE_IMPORT,
  SPEC_CREATE_ELEMENT,
]);
