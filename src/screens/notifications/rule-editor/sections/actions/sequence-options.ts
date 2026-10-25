/**
 * The options a "runs this shared sequence" picker offers: the hub's sequences
 * BY ID, plus — never silently re-pointed — the id the binding already holds
 * when the hub's list does not carry it (marked missing) or when the list has
 * not answered (named by id). A blank id is offered as "choose".
 */
import type { SelectOption } from '../../../../../components/ui/SelectRow.js'
import type { NcSharedSequence } from '../../../../../data/notification-center.js'

const UI = 'v2.nc.rules.editor.actions'

/** The select's "nothing picked" value — never a real sequence id. */
export const UNSET_SEQUENCE = ''

export function sequenceOptions(
  sequences: readonly NcSharedSequence[] | undefined,
  current: string,
  t: (key: string, params?: Record<string, unknown>) => string,
): readonly SelectOption<string>[] {
  const listed = (sequences ?? []).map((sequence) => ({ value: sequence.id, label: sequence.name }))
  const id = current.trim()
  if (id === UNSET_SEQUENCE) return [{ value: UNSET_SEQUENCE, label: t(`${UI}.sequenceNone`) }, ...listed]
  if (listed.some((option) => option.value === id)) return listed
  const label =
    sequences === undefined ? t(`${UI}.sequenceById`, { id }) : t(`${UI}.sequenceMissing`, { id })
  return [{ value: id, label }, ...listed]
}
