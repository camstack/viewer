/**
 * wall-back — what "back" means while the wall is up (#700).
 *
 * The wall is built IN the camera screen's picture box, so it is not a place
 * the operator navigated to: leaving the screen from it would throw the whole
 * view away along with the camera. Back therefore takes ONE step first — it
 * collapses the wall to the single picture — and only a second back leaves the
 * camera. Every way out funnels through {@link createLeave}: the toolbar's back,
 * the one-finger swipe, the Android hardware back and Escape on the web.
 *
 * Pure, plus one hook that registers the two platform sources of "back" that do
 * not go through a button.
 */
import { useEffect } from 'react'
import { BackHandler, Platform } from 'react-native'

export interface LeaveActions {
  /** Is a wall up right now? Read at call time, so a stale closure cannot
   *  collapse a wall that is already gone. */
  readonly wallShowing: () => boolean
  /** Empty the view: back to the single picture. */
  readonly collapseWall: () => void
  /** Leave the camera (`backToCameras`). */
  readonly leaveCamera: () => void
}

/** The one "back": collapse the wall if there is one, else leave the camera. */
export function createLeave(actions: LeaveActions): () => void {
  return () => {
    if (actions.wallShowing()) {
      actions.collapseWall()
      return
    }
    actions.leaveCamera()
  }
}

/**
 * Should this keydown be read as "back"? Escape only, and never while the
 * operator is typing (an input, a textarea, a contenteditable) or a dialog /
 * sheet is open: those own Escape for themselves.
 */
export function isWallEscape(e: Pick<KeyboardEvent, 'key' | 'target' | 'defaultPrevented'>): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false
  const t = e.target
  if (t instanceof Element) {
    if (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false
  }
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"], [aria-modal="true"]')) return false
  return true
}

/**
 * Register the platform sources of "back" that bypass the screen's buttons,
 * ONLY while a wall is up — with none, the system's own back runs untouched.
 * Android's hardware back is consumed (`true`); on the web Escape does the same
 * step. `collapse` is the screen's `onLeave`, which re-checks the wall itself.
 */
export function useCollapseWallOnBack(wallShowing: boolean, collapse: () => void): void {
  useEffect(() => {
    if (!wallShowing) return undefined
    if (Platform.OS === 'web') {
      const onKey = (e: KeyboardEvent): void => {
        if (isWallEscape(e)) collapse()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      collapse()
      return true
    })
    return () => sub.remove()
  }, [wallShowing, collapse])
}
