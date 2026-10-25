/**
 * A single-choice picker's next value: the tapped id alone. Kept out of
 * `device-picker-model.ts`, which is shared byte-for-byte with the admin UI.
 */
import type { PickerId } from './device-picker-model.js'

export function pickSingle<Id extends PickerId>(id: Id): Id[] {
  return [id]
}
