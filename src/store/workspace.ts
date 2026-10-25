/**
 * workspace — the pure reducers over the multi-camera VIEW the operator builds
 * from the theater. The zustand glue is `workspace-store.ts`.
 *
 * ## What this is for
 *
 * "Add to view" collects cameras while the operator stays on one camera's
 * player. In this phase nothing renders the wall yet (that is Fase F of
 * `docs/2026-09-01-tablet-multi-camera-workspace-design.md`), so the buttons
 * only WRITE here — but they write the shape that phase reads, not a
 * placeholder: an ordered member list plus the primary camera, exactly the two
 * fields §4 of the design settled on.
 *
 * ## Three properties the design argued for, all of them enforced here
 *
 * 1. **It lives outside the tree.** `app/(app)/camera/[id].tsx` mounts
 *    `<CameraDetailScreen key={deviceId}>`, so every camera switch remounts the
 *    whole screen. A `useState` would lose the view on the one interaction the
 *    feature exists to make frictionless.
 * 2. **It is not a route parameter.** A `?devices=` that changes on every add
 *    is URL churn, and worse, it invites a remount.
 *    `grid/adhoc-devices.ts` stays the SHARING format, in and out.
 * 3. **It is not persisted.** A workspace restored at the next launch is a wall
 *    of six streams nobody asked for at that moment. Saved grids already exist
 *    for the durable case (`grid-store.ts`) and are already shareable.
 *
 * `members` is ordered and free of duplicates: the order IS the geometry, the
 * same rule a saved `Grid` lives by (`grid-store.ts`) — and `cells` is the only
 * thing that is allowed to say more than the order does.
 */

/**
 * How many TRACKS of the wall's grid one camera occupies. The unit is a track,
 * never a pixel and never an offset: this value travels to a surface the app
 * does not lay out (on iOS and web the cells live inside a WebView), and the one
 * rule that survives that crossing is that DIMENSIONS mean the same thing in
 * every box while POSITIONS do not. See `grid-embed/embed-messages.ts`.
 */
export interface CellSpan {
  readonly cw: number
  readonly ch: number
}

export interface WorkspaceState {
  /** The cameras in the view, in display order. Empty = no workspace. */
  readonly members: readonly number[]
  /**
   * The camera the per-camera controls act on — PTZ, export, capture and the
   * snapshot button are all singular, and in a wall of N they need to know
   * which one. `null` exactly when `members` is empty.
   */
  readonly primaryId: number | null
  /**
   * The sizes the operator gave individual cells, by camera. ABSENT means the
   * default 1×1, and an empty map means the evenly distributed wall that ships —
   * the distinction the whole compatibility story rests on, because a page too
   * old to know about spans draws exactly that wall and is not wrong.
   */
  readonly cells: Readonly<Record<number, CellSpan>>
}

const NO_CELLS: Readonly<Record<number, CellSpan>> = {}

export const EMPTY_WORKSPACE: WorkspaceState = { members: [], primaryId: null, cells: NO_CELLS }

/** Drop the spans of cameras that are no longer in the view. Returns the SAME
 *  object when there was nothing to drop, so the common path allocates nothing. */
function cellsFor(
  cells: Readonly<Record<number, CellSpan>>,
  members: readonly number[],
): Readonly<Record<number, CellSpan>> {
  const keys = Object.keys(cells)
  if (keys.length === 0) return cells
  const kept: Record<number, CellSpan> = {}
  let dropped = false
  for (const key of keys) {
    const id = Number(key)
    if (members.includes(id)) kept[id] = cells[id]
    else dropped = true
  }
  return dropped ? kept : cells
}

/**
 * Add a camera to the view.
 *
 * Idempotent: adding a member twice is the same view, and returns the SAME
 * object so a subscriber does not re-render for a no-op. The first member
 * becomes the primary — a populated view with no primary would leave every
 * singular control with nothing to act on.
 */
export function addMember(state: WorkspaceState, deviceId: number): WorkspaceState {
  if (!Number.isFinite(deviceId)) return state
  if (state.members.includes(deviceId)) return state
  return {
    members: [...state.members, deviceId],
    primaryId: state.primaryId ?? deviceId,
    cells: state.cells,
  }
}

/**
 * State the WHOLE view at once: these cameras, in this order, and no others.
 *
 * The camera panel's confirm is the one control that can say this — a shelf
 * card adds one camera and reports that it is in, but nothing there can take a
 * camera out of a view it cannot show you. See `camera-selection.ts` for why
 * that makes the confirm a replacement rather than a bulk add.
 *
 * ONE write, deliberately: clearing and re-adding would let a subscriber
 * observe an empty view in between, and on iOS the empty view is a device set
 * of zero reaching a WebView that would tear its peers down and rebuild them
 * for a frame. The whole point of the feature is that the cameras already
 * playing keep playing.
 *
 * The primary is kept when it survived — re-stating a view that still contains
 * it is not a request to move what the singular controls act on.
 */
export function setMembers(state: WorkspaceState, ids: readonly number[]): WorkspaceState {
  const members: number[] = []
  for (const id of ids) {
    if (!Number.isFinite(id)) continue
    if (members.includes(id)) continue
    members.push(id)
  }
  if (members.length === 0) return EMPTY_WORKSPACE
  if (
    members.length === state.members.length &&
    members.every((id, i) => state.members[i] === id)
  ) {
    return state
  }
  return {
    members,
    primaryId:
      state.primaryId !== null && members.includes(state.primaryId) ? state.primaryId : members[0],
    cells: cellsFor(state.cells, members),
  }
}

/** Remove a camera. The primary moves to the first survivor rather than going
 *  `null` under a still-populated view. */
export function removeMember(state: WorkspaceState, deviceId: number): WorkspaceState {
  if (!state.members.includes(deviceId)) return state
  const members = state.members.filter((id) => id !== deviceId)
  if (members.length === 0) return EMPTY_WORKSPACE
  return {
    members,
    primaryId: state.primaryId === deviceId ? members[0] : state.primaryId,
    // A span that outlived its camera would restore itself the next time the
    // operator added that camera back — a size they have no memory of choosing,
    // on a wall they built fresh.
    cells: cellsFor(state.cells, members),
  }
}

/** Point the singular controls at another member. A camera that is not in the
 *  view cannot be the primary — that pair must never disagree. */
export function setPrimary(state: WorkspaceState, deviceId: number): WorkspaceState {
  if (!state.members.includes(deviceId)) return state
  if (state.primaryId === deviceId) return state
  return { members: state.members, primaryId: deviceId, cells: state.cells }
}

/**
 * Drop members that are no longer cameras we know about.
 *
 * The camera list moves under a workspace — a device removed, a permission
 * narrowed, a hidden camera. Returns the SAME object when nothing changed.
 */
export function reconcileMembers(
  state: WorkspaceState,
  knownIds: readonly number[],
): WorkspaceState {
  const known = new Set(knownIds)
  const members = state.members.filter((id) => known.has(id))
  if (members.length === state.members.length) return state
  if (members.length === 0) return EMPTY_WORKSPACE
  return {
    members,
    primaryId: state.primaryId !== null && known.has(state.primaryId) ? state.primaryId : members[0],
    cells: cellsFor(state.cells, members),
  }
}

/**
 * Give one cell a size, in tracks.
 *
 * The default is stored as ABSENCE: `1×1` deletes the entry rather than writing
 * it, so "the operator arranged nothing" stays expressible and an untouched view
 * keeps sending no spans at all. A nonsense value is clamped rather than
 * refused — the caller is a drag, and a drag that produced a fraction still
 * means something.
 *
 * Returns the SAME object when nothing changed: this runs on every frame of a
 * resize gesture, and each new object is a re-render of the surface being
 * dragged.
 */
export function resizeMember(
  state: WorkspaceState,
  deviceId: number,
  span: CellSpan,
): WorkspaceState {
  if (!state.members.includes(deviceId)) return state
  const cw = Number.isFinite(span.cw) ? Math.max(1, Math.round(span.cw)) : 1
  const ch = Number.isFinite(span.ch) ? Math.max(1, Math.round(span.ch)) : 1
  const current = state.cells[deviceId]

  if (cw === 1 && ch === 1) {
    if (current === undefined) return state
    const cells: Record<number, CellSpan> = { ...state.cells }
    delete cells[deviceId]
    return { members: state.members, primaryId: state.primaryId, cells }
  }
  if (current !== undefined && current.cw === cw && current.ch === ch) return state
  return {
    members: state.members,
    primaryId: state.primaryId,
    cells: { ...state.cells, [deviceId]: { cw, ch } },
  }
}

/** Is this camera already in the view? Drives the shelf button's state. */
export function isMember(state: WorkspaceState, deviceId: number): boolean {
  return state.members.includes(deviceId)
}
