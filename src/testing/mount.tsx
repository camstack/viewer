/**
 * The renderer this repo did not have.
 *
 * Until 2026-08-17 not one test mounted a component: `react-native` is Flow
 * source and fails to parse under vitest, so 2,900 green tests could not tell
 * anyone that two whole tabs threw on their first render. `vitest.config.ts`
 * resolves `react-native` to `react-native-web` and stubs the native modules
 * (`src/testing/native-stubs/`); this module supplies the provider stack.
 *
 * What is real: the screens, every component under them, every `src/data` hook,
 * every store, i18n over the shipped `locales/*.json`, the theme, React Query,
 * and `ServerProvider`. What is faked: the wire (`hub-stub.ts`) and the
 * connection context that owns it (`connection-stub.tsx`), plus native modules.
 *
 * Usage — the `vi.mock` line must be in the spec file itself, vitest hoists it:
 *
 * ```ts
 * // @vitest-environment jsdom
 * vi.mock('../../connection/ConnectionProvider.js', async () =>
 *   (await import('../../testing/connection-stub.js')).connectionStubModule())
 * ```
 */
import React from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ThemeProvider } from '../theme/theme-provider.js'
import { ConfirmProvider } from '../components/ui/confirm.js'
import { ServerProvider } from '../app/ServerProvider.js'
import { resetHubStub, setHubResponses, type HubResponses } from './hub-stub.js'
import { setTestAppState, type TestAppStateStatus } from './app-state-control.js'
import { resetTestFocus } from './focus-control.js'
import { resetOrientationCalls } from './orientation-control.js'
import { resetWebViewStub } from './webview-control.js'
import {
  resetRouterStub,
  setTestPathname,
  setTestSearchParams,
} from './native-stubs/expo-router.js'

// Side effect: i18next init over the real locale JSON. Imported here so a
// missing translation key shows up in a mount test as it would on the device.
import '../app/i18n.js'
import { useServerScopeStore } from '../store/server-scope.js'

/**
 * The hub every mounted screen's per-hub state belongs to. The harness has no
 * saved server, so nothing would bind the scope (`ServerScopeBinder`) and every
 * per-camera store would wait for it; a spec seeding grids stamps them with
 * this id.
 */
export const TEST_SERVER_ID = 'test-hub'

export interface MountOptions {
  /** `'nc.listRules'` → payload or handler. Absent paths behave as NOT_FOUND. */
  readonly hub?: HubResponses
  /** What `useLocalSearchParams()` returns (`?section=exports`, `?trackId=…`). */
  readonly params?: Readonly<Record<string, string | string[] | undefined>>
  /** What `usePathname()` returns. */
  readonly pathname?: string
  /**
   * What `AppState.currentState` reports at the FIRST render. Defaults to
   * `active`; pass `inactive` to reproduce the iOS launch window, where the
   * bridge's `initialAppState` is whatever `UIApplication.applicationState`
   * happens to be before `applicationDidBecomeActive:`.
   */
  readonly appState?: TestAppStateStatus
}

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // No retries and no delay: a mount test asserts the render, and a retried
      // failure would just make it slow.
      queries: { retry: false, retryDelay: 0, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

/**
 * Mount `element` inside the real provider stack.
 *
 * Deliberately NOT wrapped in an error boundary: a render throw must reach the
 * test as a thrown error, because in the app it reaches the operator as the
 * whole tree unmounting — `RenderErrorBoundary` guards only `ZoomableImage`.
 */
export function mountScreen(element: React.ReactElement, options: MountOptions = {}): RenderResult {
  useServerScopeStore.getState().bind(TEST_SERVER_ID)
  resetHubStub()
  resetRouterStub()
  resetTestFocus()
  resetOrientationCalls()
  resetWebViewStub()
  setTestAppState(options.appState ?? 'active')
  if (options.hub) setHubResponses(options.hub)
  setTestSearchParams({ ...(options.params ?? {}) })
  if (options.pathname) setTestPathname(options.pathname)

  const queryClient = newQueryClient()
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        ThemeProvider,
        null,
        // Mirrors `RootProviders`. Without it every screen holding a
        // confirmation would throw on mount here but not on the device, which
        // is the wrong way round for a harness.
        React.createElement(
          ConfirmProvider,
          null,
          React.createElement(ServerProvider, null, element),
        ),
      ),
    ),
  )
}
