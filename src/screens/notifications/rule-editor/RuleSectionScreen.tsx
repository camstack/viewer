/**
 * RuleSectionScreen — one section of the rule editor (`/rule/[id]/[section]`).
 *
 * Edits the shared draft through `patch` and pops; the summary reads the
 * edits back. It never prompts on back — nothing is lost by leaving it. A
 * section this rule does not have (an unknown key, Actions for a non-admin,
 * Cameras on a system rule) is SAID, never rendered as an empty page — and
 * only once `auth.me` has answered, since unanswered is not "not an admin".
 * A read-only rule (an admin rule, for a non-admin) opens no editable body.
 *
 * Reached COLD (a deep link, a reload) there is nothing below to go back to,
 * so back opens the rule's summary; and a draft no summary holds is dropped
 * when the section leaves.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import type { NcRuleEditorSectionKey } from '@camstack/types'
import { useAdminVerdict } from '../../../data/use-me.js'
import { useNcConditionCatalog } from '../../../data/use-notification-center.js'
import { editorSectionsFor, parseSectionKey } from '../../../components/notifications/rule-editor-sections.js'
import { EditorNotice } from './EditorNotice.js'
import { EditorScroll } from './EditorScroll.js'
import { ruleHref } from '../../../navigation/rule-routes.js'
import { useDiscardOrphanDraft, useRuleDraft } from './use-rule-draft.js'
import type { RuleSectionProps } from './sections/section-props.js'
import { ActionsSection } from './sections/ActionsSection.js'
import { AdvancedSection } from './sections/AdvancedSection.js'
import { ConditionsSection } from './sections/ConditionsSection.js'
import { DevicesSection } from './sections/DevicesSection.js'
import { NotificationSection } from './sections/NotificationSection.js'
import { RuleSection } from './sections/RuleSection.js'

export interface RuleSectionScreenProps {
  readonly id: string
  readonly section?: string
  readonly kind?: string
}

const SECTION_COMPONENTS: Readonly<Record<NcRuleEditorSectionKey, React.ComponentType<RuleSectionProps>>> = {
  rule: RuleSection,
  devices: DevicesSection,
  conditions: ConditionsSection,
  notification: NotificationSection,
  actions: ActionsSection,
  advanced: AdvancedSection,
}

/** Sections that render the condition catalog wait for it. */
const NEEDS_CATALOG: ReadonlySet<NcRuleEditorSectionKey> = new Set(['devices', 'conditions'])

export function RuleSectionScreen({ id, section, kind: kindParam }: RuleSectionScreenProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const verdict = useAdminVerdict()
  const catalogQuery = useNcConditionCatalog()
  const editor = useRuleDraft({ id, kind: kindParam })
  const handOffDraft = useDiscardOrphanDraft(editor.draftKey)
  const back = (): void => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    // Cold: nothing under this screen. The summary replacing it adopts the
    // draft, so keep it while that route loads.
    handOffDraft()
    router.replace(ruleHref(id, editor.kind))
  }

  const key = parseSectionKey(section)
  const { draft, kind } = editor
  const entry =
    key !== undefined && kind !== undefined && verdict !== 'pending'
      ? editorSectionsFor(kind, verdict === 'admin').find((candidate) => candidate.key === key)
      : undefined
  const title = entry ? t(entry.titleKey) : ''

  if (editor.status === 'missing' || editor.status === 'failed') {
    return (
      <EditorScroll title={title} onBack={back}>
        <EditorNotice
          message={t(editor.status === 'missing' ? 'v2.nc.rules.editor.missing' : 'v2.nc.rules.editor.loadError')}
        />
      </EditorScroll>
    )
  }
  if (editor.status !== 'ready' || draft === undefined || kind === undefined || verdict === 'pending') {
    return (
      <EditorScroll title={title} onBack={back}>
        <EditorNotice />
      </EditorScroll>
    )
  }
  if (key === undefined || entry === undefined) {
    return (
      <EditorScroll title={title} onBack={back}>
        <EditorNotice message={t('v2.nc.rules.editor.unknownSection')} />
      </EditorScroll>
    )
  }

  if (editor.readOnly) {
    return (
      <EditorScroll title={title} onBack={back}>
        <EditorNotice message={t('v2.nc.rules.editor.readOnly')} />
      </EditorScroll>
    )
  }

  const Body = SECTION_COMPONENTS[key]
  const waiting = NEEDS_CATALOG.has(key) && catalogQuery.isLoading
  return (
    <EditorScroll title={title} onBack={back}>
      {waiting ? (
        <EditorNotice />
      ) : (
        <Body
          draft={draft}
          patch={editor.patch}
          kind={kind}
          catalog={catalogQuery.data ?? []}
          rule={editor.rule}
        />
      )}
    </EditorScroll>
  )
}
