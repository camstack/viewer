/**
 * cameras-arrange — the state of ONE "arrange the list" session.
 *
 * The device list is not draggable by default. A long-press that reorders a
 * live camera list by accident is a worse failure than one extra tap, so the
 * drag lives behind a small pencil in the header corner: pencil opens a
 * session, drags land in the session's DRAFT, and only the confirm (✓) writes
 * the local order through `setOrder`. Nothing is persisted mid-gesture.
 *
 * That is also what makes CANCEL (✕) mean something. The session carries the
 * BASELINE — the order that was on screen when the pencil was pressed — and
 * cancel restores exactly that. Restoring "whatever is persisted" would be a
 * different list the moment an earlier session confirmed something, and would
 * silently keep half of an abandoned rearrangement.
 *
 * Pure and platform-free: ids in, ids out. The screen holds one of these in
 * state and the tests drive it directly.
 */

/** One open arrange session. Immutable — every drag returns a new one. */
export interface ArrangeSession {
  /** Device ids in the order shown when the session opened. Cancel restores it. */
  readonly baseline: readonly number[]
  /** Device ids in the order the operator has dragged them into so far. */
  readonly draft: readonly number[]
}

/** Open a session over the ids currently on screen. */
export function beginArrange(ids: readonly number[]): ArrangeSession {
  // Copy: the caller's array is usually derived from a live query result and
  // must not be able to rewrite the baseline after the fact.
  const snapshot: readonly number[] = [...ids]
  return { baseline: snapshot, draft: snapshot }
}

/** Fold one completed drag into the session. Only the draft moves. */
export function applyArrangeDrag(
  session: ArrangeSession,
  ids: readonly number[],
): ArrangeSession {
  return { baseline: session.baseline, draft: [...ids] }
}

/**
 * Has the operator actually changed anything? A confirm on a clean session
 * writes nothing — otherwise merely opening and closing the pencil would stamp
 * the whole current device set into storage as an explicit arrangement, and
 * every camera added later would be pinned to the end by a list the operator
 * never authored.
 */
export function arrangeIsDirty(session: ArrangeSession): boolean {
  if (session.draft.length !== session.baseline.length) return true
  return session.draft.some((id, i) => id !== session.baseline[i])
}
