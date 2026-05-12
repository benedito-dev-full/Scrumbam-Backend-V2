// Flat config (ESLint v9+) — Scrumban-Backend-V2
// Usa @typescript-eslint instalado via npm install.
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.claude/**',
      'workspace/**',
      'docs/**',
      'prisma/migrations/**',
      'coverage/**',
      'agent/**',
    ],
  },
  {
    files: [
      'src/**/*.ts',
      'test/**/*.ts',
      'prisma/seeds/**/*.ts',
      'prisma/scripts/**/*.ts',
      'templates/**/*.ts',
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'writable',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        console: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },
];
