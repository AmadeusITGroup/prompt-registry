import {
  defineConfig,
  globalIgnores,
} from 'eslint/config';
import {
  createSharedConfig,
  temporaryWarnRules,
  temporaryWarnRulesTs,
} from '../eslint.shared.mjs';

export default defineConfig([
  globalIgnores(
    [
      'dist/',
      'dist-test/',
      '**/*.d.ts',
      'node_modules/',
      'bin/'
    ],
    'collection-scripts/ignores'
  ),
  ...createSharedConfig({
    name: 'collection-scripts',
    tsProjects: ['tsconfig.json', 'tsconfig.test.json'],
    tsconfigRootDir: import.meta.dirname
  }),
  {
    // TODO to be discussed and fixed in a future PR
    name: 'collection-scripts/temporary-warn-rules-ts',
    files: ['**/*.ts'],
    rules: temporaryWarnRulesTs
  },
  {
    // TODO to be discussed and fixed in a future PR
    name: 'collection-scripts/temporary-warn-rules',
    files: ['**/*.{j,t}s'],
    rules: temporaryWarnRules
  },
  {
    name: 'collection-scripts/test-ts-rules',
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    }
  }
]);
