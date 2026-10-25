import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Vitest for the embed app (separate from the addon's server-side `vitest.config.ts`).
 * jsdom because the pure-logic specs touch `window` (grid-messages → `postToHost`,
 * embed-grid-config → `readGridConfig`) and the component specs render React.
 */
export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.spec.{ts,tsx}', '../shared/**/__tests__/**/*.spec.ts'],
  },
})
