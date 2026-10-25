/**
 * use-alarm-setup — the read the admin alarm screen needs besides the alarm
 * config itself (`use-nc-alarm.ts`): which devices of the household are
 * OPENINGS (D636) — one ids-only `deviceManager.listDeviceIdsByCaps` read, and
 * the targeted rows of those ids. The sensor table offers every opening, never
 * a camera.
 *
 * Asked only by a CONFIRMED admin (the screen is admin-only), and a read that
 * failed THROWS — an unreadable answer is never "no openings" (D315).
 *
 * (The panel's own recipient list, and the target read that fed it, are gone:
 * who is told is decided by alarm rules only — D701/D706.)
 */
import type { UseQueryResult } from '@tanstack/react-query'
import { ALARM_OPENING_CAP_NAMES } from '../components/notifications/alarm-settings-model.js'
import type { PickerCandidate } from './linked-device-picker.js'
import { useDeviceIdsByCaps } from './use-device-ids-by-caps.js'
import { useDevicesByIds } from './use-devices-by-ids.js'
import { useAdminVerdict } from './use-me.js'

/** Every opening of the household, and the rows that name them. */
export interface HouseholdOpenings {
  /** The ids bound to `contact`, `cover` or `lock-control` (one targeted read). */
  readonly ids: UseQueryResult<readonly number[]>
  /** Those ids' rows (name, type, room) — a targeted `listAll({ deviceIds })`. */
  readonly rows: UseQueryResult<readonly PickerCandidate[]>
}

/**
 * Which devices of the household are openings (D636): ONE ids-only read,
 * `deviceManager.listDeviceIdsByCaps`, then the rows of just those ids. It
 * replaced the whole-fleet catalogue plus `getBindingsBatch` over ~900 ids.
 * Asked only by a confirmed admin.
 */
export function useHouseholdOpenings(): HouseholdOpenings {
  const verdict = useAdminVerdict()
  const ids = useDeviceIdsByCaps(ALARM_OPENING_CAP_NAMES, verdict === 'admin')
  const rows = useDevicesByIds(ids.data ?? [])
  return { ids, rows }
}
