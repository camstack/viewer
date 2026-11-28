/**
 * frame-history — how many screens deep the framed app is, from the `path`
 * events it reports. The shell's own back stack knows nothing about navigation
 * inside the frame, so Back asks this: while the frame has somewhere to go back
 * to, Back goes back INSIDE it; at the app's root it leaves to the Cameras tab.
 */

/** The paths the frame visited, oldest first; the last one is where it is now. */
export type FrameHistory = readonly string[]

export const EMPTY_FRAME_HISTORY: FrameHistory = Object.freeze([])

/**
 * The history after the frame reported `path`. A path equal to the one before the
 * current is the frame going back (pop); the current path again changes nothing;
 * anything else is a forward step (push).
 */
export function advanceFrameHistory(history: FrameHistory, path: string): FrameHistory {
  const current = history[history.length - 1]
  if (current === path) return history
  if (history.length >= 2 && history[history.length - 2] === path) return history.slice(0, -1)
  return [...history, path]
}

/** A fresh frame (first `ready`, a reload) starts a new history. */
export function startFrameHistory(path: string): FrameHistory {
  return [path]
}

export function frameCanGoBack(history: FrameHistory): boolean {
  return history.length > 1
}
