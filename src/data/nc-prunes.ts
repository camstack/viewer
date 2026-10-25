/**
 * nc-prunes — the viewer's mirror of `nc.listPrunes`: why a rule switched
 * itself off.
 *
 * When a device (or a delivery target) is DELETED, the hub's notification
 * centre removes it from every rule that names it. When it was a rule's LAST
 * one it cannot — removing it would widen the rule to every camera — so it
 * keeps the id (the picker shows it as "Device #id — removed") and switches
 * the rule off, recording why. Authority:
 * `addon-post-analysis/src/notification-center/device-prune-ledger.ts`
 * (`NcPruneRecordSchema`). The action is ADMIN-only; a non-admin's screen
 * simply shows nothing (D315: a refused read never claims "nothing pruned").
 */
import { z } from 'zod'

export const NcPruneRecordSchema = z.object({
  kind: z.enum(['rule', 'timelapse', 'summary']),
  ruleId: z.string().min(1),
  subjectKind: z.enum(['device', 'target']),
  /** Device id as a decimal string, or the target id. */
  subject: z.string().min(1),
  field: z.string().min(1),
  outcome: z.enum(['removed', 'kept-disabled', 'kept', 'sequence-removed']),
  at: z.number(),
  source: z.enum(['event', 'reconcile']),
})
export type NcPruneRecord = z.infer<typeof NcPruneRecordSchema>
export type NcPruneRuleKind = NcPruneRecord['kind']

export const NcListPrunesResultSchema = z.object({ prunes: z.array(NcPruneRecordSchema) })
export type NcListPrunesResult = z.infer<typeof NcListPrunesResultSchema>

/**
 * The prune that switched THIS rule off, while it is still off — else `null`.
 *
 * And only while the rule has not been touched since the LAST prune write of
 * any outcome (every prune write records a row stamped after it, so a later
 * removal on the still-disabled rule keeps the banner): a rule the operator
 * edited — re-enabled and switched off again — is off for their reason.
 *
 * Only `kept-disabled`: `kept` is a rule the operator had already switched off,
 * and blaming that on a deletion would be a false sentence. Never once the rule
 * is back on — that was the operator's explicit choice.
 */
export function pruneBannerFor(
  prunes: readonly NcPruneRecord[],
  kind: NcPruneRuleKind,
  ruleId: string,
  enabled: boolean,
  updatedAt: number,
): NcPruneRecord | null {
  if (enabled) return null
  const own = prunes.filter((p) => p.kind === kind && p.ruleId === ruleId)
  const lastWrite = own.reduce((max, p) => Math.max(max, p.at), Number.NEGATIVE_INFINITY)
  if (updatedAt > lastWrite) return null
  return own
    .filter((p) => p.outcome === 'kept-disabled')
    .reduce<NcPruneRecord | null>((best, p) => (best === null || p.at > best.at ? p : best), null)
}
