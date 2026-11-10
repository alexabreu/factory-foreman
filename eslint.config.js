// Lint for the workspace's own JavaScript. The fixture app is TypeScript and
// checked by its own typecheck; deployed harness files are linted at source.
import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/test-results/',
      '**/playwright-report/',
      '**/.local/',
      'apm_modules/',
      '.claude/',
      'fixtures/sample-target/',
    ],
  },
  js.configs.recommended,
  {
    files: [ '**/*.{js,mjs}' ],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': [ 'error', { argsIgnorePattern: '^_', caughtErrors: 'none' } ],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: [ 'error', 'smart' ],
    },
  },
]
