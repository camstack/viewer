/**
 * How the embed page hands a host command to the recorded session (D42).
 *
 * Every timeline command is a pointer move on the per-viewer session. A page
 * with no session that can take it reports the gap ONCE (`onGap` — the page
 * logs it and tells the host `recState: error`) instead of pretending with a
 * second engine; the next accepted move re-arms the report.
 *
 * A channel still NEGOTIATING (a reconnect in flight) takes the moves the
 * session can hold for its open edge — a play pressed, or the host's
 * foreground re-assert, must not read as a dead stream.
 */
import type { RecordedTrackSession } from './recorded-track-session.js'

export interface RecordedCommandRouterDeps {
  /** The session on the page's current control channel, if any. */
  readonly current: () => RecordedTrackSession | null
  /** A command found no session to take it — reported once per gap. */
  readonly onGap: (what: string) => void
}

export interface RecordedCommandRouter {
  /** The session a command may use now, or null when there is none. */
  session(): RecordedTrackSession | null
  /** Run `action` on the session; a missing session or a refusal is a gap. */
  run(what: string, action: (session: RecordedTrackSession) => boolean): boolean
  /** A new control channel: the next gap is a new one, reported again. */
  resetGap(): void
}

export function createRecordedCommandRouter(deps: RecordedCommandRouterDeps): RecordedCommandRouter {
  let gapReported = false
  const session = (): RecordedTrackSession | null => {
    const current = deps.current()
    if (!current?.acceptsPointerMoves()) return null
    return current
  }
  return {
    session,
    run: (what, action) => {
      const current = session()
      if (!current || !action(current)) {
        if (!gapReported) {
          gapReported = true
          deps.onGap(what)
        }
        return false
      }
      gapReported = false
      return true
    },
    resetGap: () => {
      gapReported = false
    },
  }
}
