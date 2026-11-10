/**
 * An Action as `actions.list` serves it, cut to what a rule editor needs: the
 * id, the name the operator picks, and the steps the alarm and snooze
 * questions read. Anything else on the entry is the Actions page's.
 */
import type { ActionStep } from '@camstack/types'
import { z } from 'zod'

export interface NcListedAction {
  readonly id: string
  readonly name: string
  readonly steps: readonly ActionStep[]
}

/**
 * A hub step the alarm and snooze questions can read. Those questions look at
 * `kind`, `cap` and `method` only; a step that is neither a wait nor a cap
 * cannot answer them, so it is left out rather than guessed.
 */
function isActionStep(value: unknown): value is ActionStep {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  if (value.kind === 'wait') return true
  if (value.kind !== 'cap') return false
  return 'cap' in value && typeof value.cap === 'string' && 'method' in value && typeof value.method === 'string'
}

const ListedActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(z.unknown()).optional(),
})

/**
 * The answer of `actions.list`, or `null` when it is not that shape. A payload
 * we cannot read is "unknown", never "the hub has no Actions" (D315).
 */
export function parseListedActions(raw: unknown): readonly NcListedAction[] | null {
  const parsed = z.array(ListedActionSchema).safeParse(raw)
  if (!parsed.success) return null
  return parsed.data.map((entry) => ({
    id: entry.id,
    name: entry.name,
    steps: (entry.steps ?? []).filter(isActionStep),
  }))
}

/** An Action's steps by id — `undefined` for one the list does not carry. */
export function actionStepsResolver(
  actions: readonly NcListedAction[],
): (actionId: string) => readonly ActionStep[] | undefined {
  const byId = new Map(actions.map((action) => [action.id, action.steps]))
  return (actionId) => byId.get(actionId)
}
