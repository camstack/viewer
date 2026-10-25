/**
 * AppPhaseTracer — puts foreground/background on the same timeline as the
 * connection-state lines.
 *
 * Renders nothing. Mounted once at the app root.
 *
 * ## Why it is not inside `ConnectionProvider`
 *
 * It belongs there conceptually, and it lived there for one commit. But
 * `ConnectionProvider` is imported (transitively) by every `src/data/**` hook
 * and therefore by their tests, and importing `react-native` from it makes 15
 * spec files fail to LOAD: vitest runs in the `node` environment and cannot
 * parse react-native's Flow syntax (`import typeof * as …`). The tests do not
 * fail — they never run, which is the quieter and worse outcome.
 *
 * So the react-native dependency lives here, in a component only the app tree
 * mounts, and `ConnectionProvider` stays parseable in a plain node environment.
 *
 * ## It also HANGS UP, and that is not a blind redial
 *
 * On a real departure it closes the socket (`background-suspend.ts`): a
 * suspended runtime stops reading and the server queues for it regardless —
 * 33 MB to 88 MB in one evening on this hub, for a phone nobody was holding.
 * The decision of what counts as a departure is the whole of that module's
 * subtlety; `inactive` is not one.
 *
 * A return then has two shapes and `SystemController.handleForeground` picks
 * between them. When WE closed the socket there is nothing to ask, only
 * something to reopen. When we did not — the app was merely obscured — it
 * still ASKS rather than redialling blind: three different faults produce the
 * same "stuck on loading" and a blind resume-triggered redial would destroy
 * the evidence saying which one it is (`lifecycle-trace.ts`). One bounded
 * `auth.me` produces that evidence instead, and rebuilds the transport only
 * when the answer is "the socket did not survive". Without it the app waits up
 * to ~16 s for the frozen keep-alive to notice, and everything the resume asks
 * for in that window is written into a black hole. See `resume-probe.ts`.
 *
 * It also bumps the snapshots: the snapshot URL was gated on the WebSocket's
 * state even though a snapshot is a plain HTTP GET, so a suspended socket
 * blanked every card until the socket came back.
 */
import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { traceAppPhase } from './lifecycle-trace.js'
import { classifyPresence } from './background-suspend.js'
import { useConnection } from './ConnectionProvider.js'
import { useSnapshotRefreshStore } from '../store/snapshot-refresh-store.js'

export function AppPhaseTracer(): null {
  /** When the app left the foreground — `awayMs` is the variable the operator's
   *  report hinges on ("riapro dopo un po'"). */
  const awaySinceRef = useRef<number | null>(null)
  const { controller } = useConnection()

  useEffect(() => {
    const onChange = (next: AppStateStatus): void => {
      const presence = classifyPresence(next)
      if (presence === 'foreground') {
        const since = awaySinceRef.current
        awaySinceRef.current = null
        const awayMs = since === null ? null : Date.now() - since
        traceAppPhase('foreground', awayMs)
        // One question, two answers: reopen the socket WE closed on the way
        // out, or — when nothing was closed, because the app was only obscured
        // — ask whether the one still in hand survived. Nothing else in the
        // app can answer the second for up to ~16 s (the keep-alive was frozen
        // too), and every query issued in that window goes nowhere.
        // Fire-and-forget: it never throws, and it drives the mirrored state
        // through the same callbacks every other transport event uses.
        void controller.handleForeground(awayMs)
        // Move every snapshot's cache-buster. A frame killed mid-flight by the
        // OS on suspend latched `failed`, and that latch only clears on a
        // successful load — which needs the URL to change. This is the change.
        useSnapshotRefreshStore.getState().bumpSnapshots()
        return
      }
      // `unknown` / `extension` are not departures and not returns: they are
      // the launch window and the share-sheet process. Starting the away clock
      // on one would invent a gap the app never had.
      if (next !== 'background' && next !== 'inactive') return
      // Only the FIRST departure starts the clock: iOS emits
      // `inactive` → `background`, and restarting on the second would report
      // an away time of roughly zero for every real backgrounding.
      if (awaySinceRef.current === null) awaySinceRef.current = Date.now()
      traceAppPhase('background', null)
      // …but only a REAL departure closes the socket. `inactive` is Control
      // Centre, the notification shade, an app-switcher peek and an incoming
      // call — the runtime keeps reading through all of them, and closing
      // there would cost a reconnect per glance (`background-suspend.ts`).
      if (presence === 'background') controller.suspendForBackground()
    }
    const sub = AppState.addEventListener('change', onChange)
    return () => sub.remove()
  }, [controller])

  return null
}
