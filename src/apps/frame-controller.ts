/**
 * frame-controller — the shell's handle on the one framed app's own history.
 *
 * The frame registers how it goes back while it is mounted (the same-origin iframe's
 * `history.back()` on the web, the webview's `goBack()` natively), so the top strip
 * never holds a reference to a webview. `back` answers whether the frame REALLY
 * moved: `false` (nothing to go back to, no frame, access refused) lets the caller
 * fall back to the shell's own back.
 */
type GoBack = () => Promise<boolean>

let current: GoBack | null = null

export const frameController = {
  /** Register the frame's back; the returned function detaches it (only if it is still the current one). */
  attach(goBack: GoBack): () => void {
    current = goBack
    return () => {
      if (current === goBack) current = null
    }
  },
  async back(): Promise<boolean> {
    if (current === null) return false
    try {
      return await current()
    } catch {
      return false
    }
  },
}
