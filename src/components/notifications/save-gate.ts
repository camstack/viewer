/**
 * save-gate — when a notification editor's Save may run.
 *
 * Two reads decide which stored targets a save keeps (`target-ownership.ts`):
 * WHO is saving (`useAdminVerdict`) and WHICH targets are his
 * (`nc.listMyTargets`). Until both have answered, Save is blocked and the
 * screen says why — never a guess in either direction:
 *
 *  - an admin read as a user drops other users' targets (review I1);
 *  - a user read as an admin keeps a target the hub then refuses (NB1);
 *  - a list read as empty drops every target the caller owns.
 *
 * A FAILED read is named before a pending one, because it will not resolve on
 * its own and the operator has to act (go back, reopen).
 */
import type { AdminVerdict } from '../../data/use-me.js'

/** How far the caller's own target list has got. */
export type TargetsReadState = 'answered' | 'pending' | 'failed'

export type SaveBlockReason = 'role-unknown' | 'targets-failed' | 'role-pending' | 'targets-pending'

/** The slice of the targets query this reads. */
export interface TargetsQuerySlice {
  readonly data: readonly unknown[] | undefined
  readonly isError: boolean
}

export function targetsReadState(query: TargetsQuerySlice): TargetsReadState {
  if (query.data !== undefined) return 'answered'
  return query.isError ? 'failed' : 'pending'
}

export function saveBlockReason(verdict: AdminVerdict, targets: TargetsReadState): SaveBlockReason | undefined {
  if (verdict === 'unknown') return 'role-unknown'
  if (targets === 'failed') return 'targets-failed'
  if (verdict === 'pending') return 'role-pending'
  if (targets === 'pending') return 'targets-pending'
  return undefined
}

/** The i18n key that explains a block to the operator. */
export function saveBlockKey(reason: SaveBlockReason): string {
  switch (reason) {
    case 'role-unknown':
      return 'v2.nc.rules.editor.saveBlocked.roleUnknown'
    case 'targets-failed':
      return 'v2.nc.rules.editor.saveBlocked.targetsFailed'
    case 'role-pending':
      return 'v2.nc.rules.editor.saveBlocked.rolePending'
    case 'targets-pending':
      return 'v2.nc.rules.editor.saveBlocked.targetsPending'
  }
}
