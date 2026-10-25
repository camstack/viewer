/**
 * When may the app destroy its key and certificate? (D855 §7, D49)
 *
 * Only after `DEVICE_DEFINITIVE_REFUSALS_BEFORE_DELETE` CONSECUTIVE definitive
 * answers from the hub (`revoked`, `unknown-credential`, `user-gone`). A
 * network error, a timeout, a 5xx or any non-definitive reason is never a
 * reason to delete: one bad read must not destroy a credential. The counter
 * resets on a success and on a non-definitive answer (the hub spoke and did
 * not say "gone"); an unreachable hub leaves it where it was.
 */
import {
  DEFINITIVE_DEVICE_REFUSALS,
  DEVICE_DEFINITIVE_REFUSALS_BEFORE_DELETE,
} from '@camstack/types/client'

export type DeviceAnswer =
  | { readonly kind: 'success' }
  | { readonly kind: 'refusal'; readonly reason: string }
  | { readonly kind: 'unreachable' }

/** Is this reason one of the exported definitive ones? (The wire flag alone is not trusted.) */
export function isDefinitiveReason(reason: string): boolean {
  return DEFINITIVE_DEVICE_REFUSALS.some((definitive) => definitive === reason)
}

export interface RefusalVerdict {
  /** The counter to persist. */
  readonly count: number
  /** True when the credential must now be deleted. */
  readonly deleteCredential: boolean
}

export function judgeAnswer(currentCount: number, answer: DeviceAnswer): RefusalVerdict {
  switch (answer.kind) {
    case 'success':
      return { count: 0, deleteCredential: false }
    case 'unreachable':
      return { count: currentCount, deleteCredential: false }
    case 'refusal': {
      if (!isDefinitiveReason(answer.reason)) return { count: 0, deleteCredential: false }
      const count = currentCount + 1
      return { count, deleteCredential: count >= DEVICE_DEFINITIVE_REFUSALS_BEFORE_DELETE }
    }
  }
}
