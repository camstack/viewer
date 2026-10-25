/**
 * What every rule-editor sub-screen receives. The draft is the store's; a
 * section edits it only through `patch`, so its edits survive the pop.
 */
import type { NcRuleKind } from '@camstack/types'
import type { NcRuleFormState } from '../../../../components/notifications/rule-editor.js'
import type { NcConditionDescriptor, NcViewerRule } from '../../../../data/notification-center.js'
import type { NcRuleDraft } from '../../../../store/nc-rule-draft-store.js'

export interface RuleSectionProps {
  readonly draft: NcRuleDraft
  readonly patch: (p: Partial<NcRuleFormState>) => void
  readonly kind: NcRuleKind
  readonly catalog: readonly NcConditionDescriptor[]
  /** The stored rule, `null` for a new one — what a dry-run preserves across the edit. */
  readonly rule: NcViewerRule | null
}
