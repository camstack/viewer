/**
 * tile-action — the lock's "Open door" action and the caption a row shows while
 * a confirmed action is armed ("Tap again to …").
 */
import type { HeroCall, HeroConfirm } from '@dominevo/types'

/** The `DeviceFeature.LockOpen` wire value: the lock has a latch that can be released apart from the bolt. */
export const LOCK_OPEN_FEATURE = 'lock-open'

/** The call a press sends, named by the hero action id it stands for. */
export interface TileAction {
  readonly id: string
  readonly call: HeroCall
  /** `unlock` for a lock: the press arms, the second one sends. `null` = send at once. */
  readonly confirm: HeroConfirm | null
}

/**
 * Does the lock offer "Open door" (release the latch)? Only a lock that has
 * the feature AND is at rest, locked or unlocked — the hero's own condition for
 * `lock.open`. `state` is the cap's lock state, `null` while it is not known.
 */
export function lockOpenAvailable(features: readonly string[], state: string | null): boolean {
  return features.includes(LOCK_OPEN_FEATURE) && (state === 'locked' || state === 'unlocked')
}

/** The `lock.open` call, double-tap confirmed like an unlock. */
export const LOCK_OPEN_ACTION: TileAction = {
  id: 'lock.open',
  call: { cap: 'lock-control', method: 'open', args: {} },
  confirm: 'unlock',
}

/** The i18n key of the caption a row shows while the action `id` is armed ("Tap again to …"). */
export function armCaptionKey(id: string): string {
  if (id === 'lock.open') return 'v2.hero.tapAgain.open'
  return id === 'lock.unlock' ? 'v2.hero.tapAgain.unlock' : 'v2.hero.tapAgain.confirm'
}
