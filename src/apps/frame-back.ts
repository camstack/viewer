/**
 * frame-back — go back inside a same-origin iframe and say whether it really moved.
 *
 * The frame's page history is the truth (redirects, replaces and revisits all count
 * as the browser counts them), so this asks the browser: where the Navigation API
 * says there is nothing to go back to, nothing is called; otherwise `history.back()`
 * runs and the frame has {@link FRAME_BACK_WAIT_MS} to show a `popstate` or a new
 * location. A frame that stayed, or that refuses access, did not move.
 */
export const FRAME_BACK_WAIT_MS = 400

interface NavigationLike {
  readonly canGoBack?: boolean
}

export function goBackInFrame(frame: Window | null): Promise<boolean> {
  if (frame === null) return Promise.resolve(false)
  try {
    const navigation: NavigationLike | undefined = Reflect.get(frame, 'navigation')
    if (navigation?.canGoBack === false) return Promise.resolve(false)
    const before = frame.location.href
    return new Promise<boolean>((resolve) => {
      const settle = (moved: boolean): void => {
        clearTimeout(timer)
        try {
          frame.removeEventListener('popstate', onPop)
        } catch {
          // the frame went cross-origin or away: nothing to detach
        }
        resolve(moved)
      }
      const onPop = (): void => settle(true)
      const timer = setTimeout(() => {
        let moved = false
        try {
          moved = frame.location.href !== before
        } catch {
          moved = false
        }
        settle(moved)
      }, FRAME_BACK_WAIT_MS)
      frame.addEventListener('popstate', onPop)
      frame.history.back()
    })
  } catch {
    return Promise.resolve(false)
  }
}
