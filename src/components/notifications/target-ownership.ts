/**
 * target-ownership — which delivery targets a save may send.
 *
 * The picker lists only the caller's OWN targets (`nc.listMyTargets`), but a
 * GLOBAL rule an admin edits may also deliver to other users' targets. Those
 * are invisible to him and not his to drop: a save that filtered the stored
 * list down to "mine" deleted every other user's target on every save, and the
 * hub let it through because an admin's target check returns early (review
 * I1, Task 12).
 *
 * So, FOR AN ADMIN, the ownership filter applies only to ids the operator
 * ADDED. A stored target not in his list rides through VERBATIM, in its stored
 * place — another user's, or one deleted since; either way a read must not
 * destroy it (D49). An own stored target stays while it is selected; an own id
 * not yet stored is appended.
 *
 * FOR A NON-ADMIN the old filter stands: the hub REFUSES his save when it
 * carries a target he does not own, and `nc.deleteMyTarget` leaves a deleted
 * id on his rules — keeping it would fail every later save of that rule, a
 * rename included (fix round 2, NB1). Unknown role = not admin: callers block
 * Save until the verdict answers rather than guessing.
 *
 * One authority for the rule, timelapse and digest editors.
 */

import type { AdminVerdict } from '../../data/use-me.js'

/** The one thing every editor's target shape has in common. */
export interface TargetRef {
  readonly targetId: string
}

/** Whether a stored target outside the caller's list is kept — admin only. */
export interface TargetOwnershipPolicy {
  readonly preserveUnlisted: boolean
}

/** The policy for a CONFIRMED role. */
export function targetOwnershipPolicy(isAdmin: boolean): TargetOwnershipPolicy {
  return { preserveUnlisted: isAdmin }
}

/**
 * @param build — how an OWN, selected id becomes a wire target, given what was
 *   stored for it (the rule editor re-reads its params from the form; the
 *   family editors keep the stored target as it was).
 */
export function ownershipSafeTargets<T extends TargetRef>(
  selected: readonly string[],
  stored: readonly T[],
  ownTargetIds: readonly string[],
  build: (id: string, stored: T | undefined) => T,
  policy: TargetOwnershipPolicy,
): T[] {
  const owned = new Set(ownTargetIds)
  const chosen = new Set(selected)
  const kept = stored
    .filter((target) =>
      owned.has(target.targetId) ? chosen.has(target.targetId) : policy.preserveUnlisted,
    )
    .map((target) => (owned.has(target.targetId) ? build(target.targetId, target) : target))
  const keptIds = new Set(kept.map((target) => target.targetId))
  const added = selected
    .filter((id) => owned.has(id) && !keptIds.has(id))
    .map((id) => build(id, undefined))
  return [...kept, ...added]
}

/**
 * How many stored targets are not in the caller's list — kept (admin) or
 * removed on save (non-admin), and said so either way.
 */
export function unlistedTargetCount(stored: readonly TargetRef[], ownTargetIds: readonly string[]): number {
  const owned = new Set(ownTargetIds)
  return stored.filter((target) => !owned.has(target.targetId)).length
}

/** What the target picker says about the stored targets it does not list. */
export interface UnlistedTargetNote {
  readonly count: number
  /** `kept` for an admin (saving never removes them); `removed` for anyone else. */
  readonly fate: 'kept' | 'removed'
}

/**
 * The note for the picker, or `undefined` when there is nothing to say — or
 * nothing KNOWN: an unanswered role or target list is never guessed (D315).
 */
export function unlistedTargetNote(
  stored: readonly TargetRef[],
  ownTargetIds: readonly string[] | undefined,
  verdict: AdminVerdict,
): UnlistedTargetNote | undefined {
  if (ownTargetIds === undefined || verdict === 'pending' || verdict === 'unknown') return undefined
  const count = unlistedTargetCount(stored, ownTargetIds)
  if (count === 0) return undefined
  return { count, fate: verdict === 'admin' ? 'kept' : 'removed' }
}

/**
 * What a save knows about the caller's targets once the role AND his own list
 * have answered — the inputs {@link ownershipSafeTargets} needs.
 */
export interface TargetSaveContext {
  readonly ownTargetIds: readonly string[]
  readonly stored: readonly TargetRef[]
  readonly isAdmin: boolean
}

/**
 * The context for a confirmed role and an answered list, else `undefined` —
 * an unanswered read is never guessed (D315); the save gate blocks meanwhile.
 */
export function targetSaveContext(
  verdict: AdminVerdict,
  ownTargetIds: readonly string[] | undefined,
  stored: readonly TargetRef[],
): TargetSaveContext | undefined {
  if (ownTargetIds === undefined || (verdict !== 'admin' && verdict !== 'not-admin')) return undefined
  return { ownTargetIds, stored, isAdmin: verdict === 'admin' }
}

/**
 * The target ids a save will actually SEND — what a form's validity must count
 * (final review m3). A non-admin's foreign ids are dropped by the save, so they
 * cannot make the form valid; without a context the selection is all there is.
 */
export function savedTargetIds(selected: readonly string[], context: TargetSaveContext | undefined): readonly string[] {
  if (context === undefined) return selected
  return ownershipSafeTargets<TargetRef>(
    selected,
    context.stored,
    context.ownTargetIds,
    (id) => ({ targetId: id }),
    targetOwnershipPolicy(context.isAdmin),
  ).map((target) => target.targetId)
}
