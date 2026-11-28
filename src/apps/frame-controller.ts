/**
 * frame-controller — the shell's handle on the one framed app's own history.
 *
 * The frame registers how it goes back while it is mounted (an iframe's
 * `history.back()` on the web, the webview's `goBack()` natively), so the top
 * strip never holds a reference to a webview. `back` says whether a frame took it.
 */
type GoBack = () => void

let current: GoBack | null = null

export const frameController = {
  /** Register the frame's back; the returned function detaches it (only if it is still the current one). */
  attach(goBack: GoBack): () => void {
    current = goBack
    return () => {
      if (current === goBack) current = null
    }
  },
  back(): boolean {
    if (current === null) return false
    current()
    return true
  },
}
