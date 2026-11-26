/**
 * ready-navigation — where a framed app is sent when it says `ready`.
 *
 * A handoff signs the frame in at the admin root, so an addon page is reached by
 * ONE navigate per load: the first `ready` after each (re)load. A `web` entry
 * and an iframe (the browser session is shared, the URL already names the page)
 * never need it. A path a search result asked for belongs to the app itself and
 * is more specific than the page root, so it wins and spends the page navigation.
 */
import type { AdminFramePlan, FrameTarget } from './admin-frame.js'

export interface ReadyInput {
  readonly planKind: AdminFramePlan['kind'] | null
  readonly target: FrameTarget | null
  /** The path a search result asked for, still unspent. */
  readonly entryPath: string | null
  /** The path the page reported with `ready`. */
  readonly reportedPath: string
}

export interface ReadyNavigator {
  /** A new load of the frame: the next `ready` navigates again. */
  readonly reset: () => void
  /** The path to navigate to now, or `null`. */
  readonly onReady: (input: ReadyInput) => string | null
}

export function createReadyNavigator(): ReadyNavigator {
  let opened = false
  return {
    reset: () => {
      opened = false
    },
    onReady: ({ planKind, target, entryPath, reportedPath }) => {
      const page =
        !opened && planKind === 'webview-handoff' && target?.openAfterHandoff != null && reportedPath !== target.openAfterHandoff
          ? target.openAfterHandoff
          : null
      opened = true
      return entryPath ?? page
    },
  }
}
