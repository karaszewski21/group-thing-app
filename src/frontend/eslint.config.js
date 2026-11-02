import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import nextVitals from 'eslint-config-next/core-web-vitals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const REACT_ROUTER = { name: 'react-router-dom', message: 'The app runs on the Next.js App Router.' }
const NEXT_ROUTER = ['next/navigation', 'next/link'].map((name) => ({
  name,
  message: 'Use the navigation facade in src/routing/navigation.tsx.',
}))

export default defineConfig([
  globalIgnores(['dist', '.next', 'next-env.d.ts']),
  // Same lint surface as before: TypeScript sources only.
  ...nextVitals.map((config) => (config.files ? { ...config, files: ['**/*.{ts,tsx}'] } : config)),
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
    rules: {
      // React Compiler rules arriving via eslint-config-next; satisfying them
      // means restructuring existing effects and refs (behaviour change).
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      // Literal quotes in existing Polish copy; JSX renders them unchanged.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    // Next route files export `metadata` and other config next to the component.
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // The Google Fonts <link> stays in the root layout (spec D12), not next/font.
    files: ['src/app/layout.tsx'],
    rules: {
      '@next/next/no-page-custom-font': 'off',
    },
  },
  {
    // Router access goes through src/routing/navigation.tsx only.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [REACT_ROUTER, ...NEXT_ROUTER] }],
    },
  },
  {
    // The facade, the route files (server redirect(), notFound()) and the
    // test doubles of the Next router.
    files: [
      'src/routing/**/*.{ts,tsx}',
      'src/app/**/*.{ts,tsx}',
      'src/test/navigationMock.ts',
      'src/test/nextLinkMock.tsx',
      'src/test/navigationMock.test.tsx',
    ],
    rules: {
      'no-restricted-imports': ['error', { paths: [REACT_ROUTER] }],
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
