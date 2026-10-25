/**
 * ActionsSection — what the rule RUNS, by hook edge, and the buttons its
 * notification carries (ADMIN-ONLY: `editorSectionsFor(kind, isAdmin)` offers
 * it to admins alone, and the save sends or clears `actions` only for an
 * admin). The admin's rule Actions tab, model for model: each hook binds to
 * SHARED sequences by id or authors one inline step; sequences themselves are
 * authored on the admin console (Notifications → Sequences) and only LISTED
 * here (`notificationRules.listSequences`).
 *
 * Everything is edited as form state (`NcActionsFormState`) in the shared
 * draft, so a half-typed argument survives leaving the sub-screen; the parse
 * happens at save (`formToActions`), and while it fails the problems are
 * listed here and the save is refused (`ruleFormProblems` → `actions`).
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from '../../../../lib/icons.js'
import { newButtonForm, removeAt, replaceAt } from '../../../../components/notifications/rule-action-edit.js'
import {
  NC_HOOK_KEYS,
  formToActions,
  unknownSequenceRefs,
  type NcActionsFormState,
} from '../../../../components/notifications/rule-action-form.js'
import { useSharedSequences } from '../../../../data/use-shared-sequences.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../../theme/tokens.js'
import { ActionButtonRow, ActionButtonsFooter } from './actions/ActionButtonsEditor.js'
import { ActionHookEditor } from './actions/ActionHookEditor.js'
import { ActionLinkButton } from './actions/action-controls.js'
import { Hint } from './SectionHint.js'
import type { RuleSectionProps } from './section-props.js'
import { SectionLabel } from '../../../../components/ui/SectionLabel.js'

const UI = 'v2.nc.rules.editor.actions'
const NOTE_ICON_SIZE = 16

export function ActionsSection({ draft, patch }: RuleSectionProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const form = draft.form.actions
  const set = (next: NcActionsFormState): void => patch({ actions: next })
  const { errors } = formToActions(form)
  const sequencesQuery = useSharedSequences()
  const sequences = sequencesQuery.data
  const unknown = sequences === undefined ? [] : unknownSequenceRefs(form, new Set(sequences.map((s) => s.id)))

  const sequencesState = (() => {
    if (sequencesQuery.isError) {
      return (
        <View style={{ paddingHorizontal: SPACING.xs }}>
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>
            {t(`${UI}.sequencesUnavailable`)}
          </Text>
          <ActionLinkButton kind="retry" label={t(`${UI}.sequencesRetry`)} onPress={() => void sequencesQuery.refetch()} />
        </View>
      )
    }
    if (sequences === undefined) return <Hint text={t(`${UI}.sequencesLoading`)} />
    return <Hint text={t(sequences.length === 0 ? `${UI}.sequencesNone` : `${UI}.sequencesHint`)} />
  })()

  return (
    <View style={{ gap: SPACING.xl }}>
      <View
        accessibilityRole="summary"
        style={{
          flexDirection: 'row',
          gap: SPACING.md,
          padding: SPACING.lg,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: colors.warning,
          backgroundColor: `${colors.warning}1a`,
        }}
      >
        <ShieldAlert size={NOTE_ICON_SIZE} color={colors.warning} />
        <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, flex: 1 }}>{t(`${UI}.securityNote`)}</Text>
      </View>

      {errors.length > 0 ? (
        <View accessibilityRole="alert" style={{ gap: SPACING.xs, paddingHorizontal: SPACING.xs }}>
          <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>{t(`${UI}.problemsTitle`)}</Text>
          {errors.map((key) => (
            <Text key={key} style={{ color: colors.danger, fontSize: 13 }}>
              {`• ${t(key)}`}
            </Text>
          ))}
        </View>
      ) : null}

      {unknown.length > 0 ? (
        <Text style={{ color: colors.warning, fontSize: 13, paddingHorizontal: SPACING.xs }}>
          {t(`${UI}.unknownSequences`, { count: unknown.length })}
        </Text>
      ) : null}

      {sequencesState}

      {NC_HOOK_KEYS.map((hook) => (
        <ActionHookEditor key={hook} hook={hook} form={form} sequences={sequences} onChange={set} />
      ))}

      <View style={{ gap: SPACING.md }}>
        <SectionLabel inset>{t(`${UI}.buttonsTitle`)}</SectionLabel>
        {form.buttons.map((button, index) => (
          <ActionButtonRow
            // Ids are generated unique; a stored duplicate (already a save error)
            // must still not collapse two rows into one React node.
            key={`${button.id}#${index}`}
            button={button}
            sequences={sequences}
            onChange={(next) => set({ ...form, buttons: replaceAt(form.buttons, index, next) })}
            onRemove={() => set({ ...form, buttons: removeAt(form.buttons, index) })}
          />
        ))}
        <ActionButtonsFooter
          count={form.buttons.length}
          noSequences={sequences === undefined || sequences.length === 0}
          onAdd={() =>
            set({
              ...form,
              buttons: [...form.buttons, newButtonForm(form, t(`${UI}.buttonDefaultLabel`), sequences?.[0]?.id ?? '')],
            })
          }
        />
      </View>
    </View>
  )
}
