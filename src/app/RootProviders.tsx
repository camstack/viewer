import React from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '../theme/theme-provider.js'
import { ThemedStatusBar } from './ThemedStatusBar.js'
import { ServerProvider } from './ServerProvider.js'
import { CameraOrderBoot } from './CameraOrderBoot.js'
import { ServerScopeBinder } from './ServerScopeBinder.js'
import { EmbedWarmup } from './EmbedWarmup.js'
import { OtaUpdateGate } from './OtaUpdateGate.js'
import { WhatsNewGate } from './WhatsNewGate.js'
import { LoggerBridge } from './LoggerBridge.js'
import { createQueryClient } from './query-client.js'
import { bindQueryFocusToAppState } from './query-focus.js'
import { RootErrorBoundary } from './RootErrorBoundary.js'
import { ConfirmProvider } from '../components/ui/confirm.js'
import { AppState } from 'react-native'

import {
  bindExitMarkerToAppState,
  installCrashReporter,
  reportPreviousExit,
} from '../lib/crash-reporter.js'
import { publishRunningBundle } from './running-bundle.js'

// Module-level singleton — one cache for the whole srcV2 tree, stable across
// re-renders so queries are not torn down on every render.
const queryClient = createQueryClient()

// Bound once, beside the client it governs. Without it React Query never learns
// the app came back to the foreground, so `refetchInterval` stays parked and a
// list can sit stale indefinitely — see `query-focus.ts`.
bindQueryFocusToAppState()

// Installed at MODULE scope, beside the other once-per-process bindings, so the
// handler is in place before the first component renders — a throw while the
// tree is mounting is exactly the shape of "it crashes when I open it". The
// previous runtime's verdict is read once here too; both are best-effort and
// neither can throw into the app. See `lib/crash-reporter.ts`.
publishRunningBundle()
installCrashReporter()
void reportPreviousExit()
// …and keep the verdict honest for the rest of the session. Without this the
// marker stays `running` until the process ends, so CLOSING the app reports as
// a crash — 57 of those in 72 hours across twelve versions (2026-08-26), which
// is what hid the foreground kill actually being reported.
bindExitMarkerToAppState(AppState)

/** The srcV2 provider stack: gesture root → safe area → React Query → theme →
 *  confirm surface → server (active-server + token).
 *
 *  `ConfirmProvider` sits INSIDE the theme (it draws a themed dialog on the
 *  web) and ABOVE everything that can ask a question, so `useConfirm` /
 *  `useNotice` resolve from any screen. Both hooks throw without it rather than
 *  falling back to a no-op — see `components/ui/confirm.tsx`. */
export function RootProviders({ children }: { children: React.ReactNode }) {
  return (
    <RootErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <ThemedStatusBar />
              <ConfirmProvider>
                <ServerProvider>
                  <CameraOrderBoot />
                  <LoggerBridge>
                    <OtaUpdateGate />
                    <WhatsNewGate />
                    <EmbedWarmup />
                    <ServerScopeBinder />
                    {children}
                  </LoggerBridge>
                </ServerProvider>
              </ConfirmProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </RootErrorBoundary>
  )
}
