import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Router access goes through src/routing/navigation.tsx only.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/routing/**',
      'src/test/renderWithRoute.tsx',
      // Router entry, replaced by the Next.js route tree.
      'src/router.tsx',
      'src/main.tsx',
      // Route-table tests reading `routes` from router.tsx.
      'src/test/addRoute.test.tsx',
      'src/test/messagesRoutes.test.tsx',
      'src/test/EventPage.test.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-router-dom',
              message: 'Use the navigation facade in src/routing/navigation.tsx.',
            },
          ],
        },
      ],
    },
  },
  {
    // The facade and the test router pair each component with its hooks on
    // purpose (one import site); Fast Refresh boundaries do not apply there.
    files: ['src/routing/**/*.{ts,tsx}', 'src/test/renderWithRoute.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
