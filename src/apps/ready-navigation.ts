/**
 * ready-navigation — where a framed app is sent when it says `ready`.
 *
 * A handoff signs the frame in at the admin root, and the admin then redirects
 * `/` to the last page it showed (a remount that announces `ready` AGAIN, with
 * that page's path). So an addon page is reached by a navigate on EVERY `ready`
 * of a load until the page reports being at the target, bounded by
 * `MAX_ATTEMPTS`. A `web` entry and an iframe (the browser session is shared, the
 * URL already names the page) never need it. A path a search result asked for
 * belongs to the app itself and is more specific than the page root, so it wins
 * and spends the page navigation.
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

/** Navigates one load may spend before it stops fighting the page's own redirect. */
export const MAX_ATTEMPTS = 3

function isAt(reported: string, page: string): boolean {
  return reported === page || reported.startsWith(`${page}/`) || reported.startsWith(`${page}?`)
}

export function createReadyNavigator(): ReadyNavigator {
  let attempts = 0
  let arrived = false
  /** The more specific path a search result asked for: the retry target once the store has cleared it. */
  let asked: string | null = null
  return {
    reset: () => {
      attempts = 0
      arrived = false
      asked = null
    },
    onReady: ({ planKind, target, entryPath, reportedPath }) => {
      const wanted = planKind === 'webview-handoff' ? (target?.openAfterHandoff ?? null) : null
      if (wanted === null) return entryPath
      if (isAt(reportedPath, asked ?? wanted)) arrived = true
      if (entryPath !== null) asked = entryPath
      if (arrived && entryPath === null) return null
      if (entryPath === null && attempts >= MAX_ATTEMPTS) return null
      attempts += 1
      return entryPath ?? asked ?? wanted
    },
  }
}
