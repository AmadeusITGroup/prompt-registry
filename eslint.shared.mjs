import o3rConfig from '@o3r/eslint-config';
import globals from 'globals';

/**
 * Shared ESLint configuration blocks used by both root and lib packages.
 * @param {object} options
 * @param {string} options.name - Config name prefix (e.g. 'prompt-registry' or 'collection-scripts')
 * @param {string[]} options.tsProjects - tsconfig files for type-checked linting
 * @param {string} options.tsconfigRootDir - Root directory for tsconfig resolution (use import.meta.dirname)
 * @param {string[]} [options.nodeGlobFiles] - File patterns for node globals (default: ['**\/*.ts'])
 */
export function createSharedConfig({ name, tsProjects, tsconfigRootDir, nodeGlobFiles = ['**/*.ts'] }) {
  return [
    ...o3rConfig,
    {
      name: `${name}/report-unused-disable-directives`,
      linterOptions: {
        reportUnusedDisableDirectives: 'error'
      }
    },
    {
      name: `${name}/typescript-type-checking`,
      files: ['**/*.ts'],
      languageOptions: {
        parserOptions: {
          project: tsProjects,
          tsconfigRootDir
        }
      }
    },
    {
      name: `${name}/node-globals`,
      files: nodeGlobFiles,
      languageOptions: {
        globals: {
          ...globals.node,
          NodeJS: true
        }
      }
    },
    {
      name: `${name}/overrides`,
      files: ['**/*.ts'],
      rules: {
        '@typescript-eslint/restrict-template-expressions': ['error', {
          allow: ['unknown']
        }]
      }
    },
    {
      name: `${name}/settings`,
      settings: {
        'import/resolver': {
          node: true,
          typescript: {
            project: tsProjects
          }
        }
      }
    }
  ];
}

// TODO to be discussed and fixed in future PRs
export const temporaryWarnRulesTs = {
  '@typescript-eslint/no-unsafe-member-access': 'warn',
  '@typescript-eslint/no-unsafe-argument': 'warn',
  '@typescript-eslint/no-unsafe-call': 'warn',
  '@typescript-eslint/no-unsafe-return': 'warn',
  '@typescript-eslint/no-unsafe-assignment': 'warn',
  '@typescript-eslint/no-require-imports': 'warn',
  '@typescript-eslint/no-unused-vars': 'warn',
  '@typescript-eslint/restrict-template-expressions': 'warn',
  '@typescript-eslint/explicit-member-accessibility': 'warn',
  '@typescript-eslint/member-ordering': 'warn',
  '@typescript-eslint/naming-convention': 'warn',
  '@typescript-eslint/require-await': 'warn',
  '@typescript-eslint/no-floating-promises': 'warn',
  '@typescript-eslint/no-redundant-type-constituents': 'warn',
  '@typescript-eslint/no-shadow': 'warn',
  '@typescript-eslint/prefer-promise-reject-errors': 'warn'
};

// TODO to be discussed and fixed in future PRs
export const temporaryWarnRules = {
  'jsdoc/check-tag-names': 'warn',
  'jsdoc/require-throws-type': 'warn',
  'import/order': 'warn',
  'unicorn/filename-case': 'warn',
  'unicorn/no-array-sort': 'warn',
  'unicorn/no-useless-switch-case': 'warn',
  'unicorn/prefer-single-call': 'warn',
  'unicorn/prefer-query-selector': 'warn',
  'unicorn/prefer-default-parameters': 'warn',
  'unicorn/prefer-number-properties': 'warn',
  'unicorn/prefer-ternary': 'warn',
  'unicorn/text-encoding-identifier-case': 'warn',
  'unicorn/explicit-length-check': 'warn',
  'unicorn/no-immediate-mutation': 'warn',
  'prefer-arrow/prefer-arrow-functions': 'warn',
  'jsdoc/require-description': 'warn',
  'jsdoc/require-param-type': 'warn',
  'jsdoc/reject-any-type': 'warn',
  'jsdoc/escape-inline-tags': 'warn',
  'jsdoc/check-alignment': 'warn',
  'no-underscore-dangle': 'warn',
  'no-console': 'warn',
  'no-undef': 'warn',
  'no-loop-func': 'warn',
  'no-bitwise': 'warn',
  'new-cap': 'warn',
  'prefer-const': 'warn',
  'import/no-cycle': 'warn',
  'import-newlines/enforce': 'warn',
  '@stylistic/max-len': 'warn',
  '@stylistic/max-statements-per-line': 'warn',
  '@stylistic/indent-binary-ops': 'warn',
  '@stylistic/comma-dangle': 'warn',
  '@stylistic/brace-style': 'warn',
  '@stylistic/semi': 'warn',
  '@stylistic/indent': 'warn',
  '@eslint-community/eslint-comments/require-description': 'warn'
};
