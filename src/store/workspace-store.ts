/**
 * The zustand holder for the session workspace. Thin by design: every mutation
 * is a pure reducer in `workspace.ts`, tested by value there.
 *
 * NOT persisted, and there is no `hydrate()` — see `workspace.ts` for why a
 * workspace restored at launch is the wrong feature. `grid-store.ts` is where a
 * view goes when the operator wants to keep it.
 *
 * `wallOptions` is what the wall's control bar set (quality, layout, highlight,
 * layers, active-only) — session-only, like the view it belongs to, and dropped
 * with it: any write that leaves the view EMPTY clears it, so the next view
 * starts from the primary's documents again
 * (`screens/camera-detail/workspace-wall-options.ts`).
 */
import { create } from 'zustand'
import {
  EMPTY_WORKSPACE,
  addMember,
  reconcileMembers,
  removeMember,
  resizeMember,
  setMembers,
  setPrimary,
  type CellSpan,
  type WorkspaceState,
} from './workspace.js'
import {
  NO_WALL_OPTIONS,
  type WorkspaceWallOptions,
} from '../screens/camera-detail/workspace-wall-options.js'

export interface WorkspaceStore {
  readonly workspace: WorkspaceState
  /** The wall bar's session choices. Absent field ⇒ follow the primary. */
  readonly wallOptions: WorkspaceWallOptions
  /** Merge the bar's change over what it set before. */
  readonly setWallOptions: (patch: WorkspaceWallOptions) => void
  readonly add: (deviceId: number) => void
  /** These cameras BECOME the view — the camera panel's confirm, which is the
   *  only control that states a whole view. See `workspace.ts`. */
  readonly setMembers: (deviceIds: readonly number[]) => void
  readonly remove: (deviceId: number) => void
  readonly setPrimaryCamera: (deviceId: number) => void
  /** Give one cell a size in TRACKS. `1×1` clears it back to the default. */
  readonly resize: (deviceId: number, span: CellSpan) => void
  readonly reconcile: (knownIds: readonly number[]) => void
  readonly clear: () => void
}

/** A write that leaves the view empty ends it, and the bar's choices with it. */
function withWorkspace(
  s: WorkspaceStore,
  workspace: WorkspaceState,
): Pick<WorkspaceStore, 'workspace' | 'wallOptions'> {
  return {
    workspace,
    wallOptions: workspace.members.length === 0 ? NO_WALL_OPTIONS : s.wallOptions,
  }
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspace: EMPTY_WORKSPACE,
  wallOptions: NO_WALL_OPTIONS,
  setWallOptions: (patch) => set((s) => ({ wallOptions: { ...s.wallOptions, ...patch } })),
  add: (deviceId) => set((s) => withWorkspace(s, addMember(s.workspace, deviceId))),
  setMembers: (deviceIds) => set((s) => withWorkspace(s, setMembers(s.workspace, deviceIds))),
  remove: (deviceId) => set((s) => withWorkspace(s, removeMember(s.workspace, deviceId))),
  setPrimaryCamera: (deviceId) => set((s) => ({ workspace: setPrimary(s.workspace, deviceId) })),
  resize: (deviceId, span) => set((s) => ({ workspace: resizeMember(s.workspace, deviceId, span) })),
  reconcile: (knownIds) => set((s) => withWorkspace(s, reconcileMembers(s.workspace, knownIds))),
  clear: () => set({ workspace: EMPTY_WORKSPACE, wallOptions: NO_WALL_OPTIONS }),
}))
