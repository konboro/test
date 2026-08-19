import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
  {
    rules: {
      // A `const` referenced above its declaration is legal to the type checker —
      // inside a closure the call might well happen later — but an immediately
      // invoked one runs in the temporal dead zone and throws on every render.
      // That shipped once and took the dashboard down; `variables: true` is the
      // part that catches it.
      '@typescript-eslint/no-use-before-define': [
        'error',
        { functions: false, classes: false, variables: true, enums: true, typedefs: false },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
