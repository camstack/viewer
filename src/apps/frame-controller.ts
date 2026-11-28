/**
 * frame-controller — the shell's handle on the one framed app's own history.
 *
 * The frame registers how it goes back while it is mounted (the same-origin iframe's
 * `history.back()` on the web, the webview's `goBack()` natively), so the top strip
 * never holds a reference to a webview. `back` answers whether the frame REALLY
 * moved: `false` (nothing to go back to, no frame, access refused) lets the caller
 * fall back to the shell's own back.
 */
/** What the frame is told: whether the page navigated at all since it loaded. */
export interface BackContext {
  readonly navigatedSinceLoad: boolean
}
type GoBack = (context: BackContext) => Promise<boolean>

let current: GoBack | null = null
let navigations = 0

export const frameController = {
  /** Register the frame's back; the returned function detaches it (only if it is still the current one). */
  attach(goBack: GoBack): () => void {
    current = goBack
    navigations = 0
    return () => {
      if (current === goBack) current = null
    }
  },
  /** The page (re)loaded: it has not navigated yet. */
  markLoaded(): void {
    navigations = 0
  },
  /** The page moved to another path after its load. */
  markNavigated(): void {
    navigations += 1
  },
  async back(): Promise<boolean> {
    if (current === null) return false
    try {
      return await current({ navigatedSinceLoad: navigations > 0 })
    } catch {
      return false
    }
  },
}
