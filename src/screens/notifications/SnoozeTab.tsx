/**
 * SnoozeTab — "make it stop for a bit", and the proof that it will start again.
 *
 * A snooze is the one control here whose failure mode is SILENCE, so the panel
 * is built around making the silence visible:
 *
 *   • what is silenced right now is listed FIRST, each line saying when it ends;
 *   • every window can be ended immediately;
 *   • the summary switch is ON by default, mirroring the hub — someone silencing
 *     a security camera has to be told what they missed;
 *   • "for everyone" is only OFFERED where the hub would allow it (a rule that
 *     opted in, or an admin). The hub re-checks: this is a courtesy, not a gate.
 *
 * Personal by default. The intro line says so in one sentence, because the
 * difference between "I am asleep" and "nobody needs to know" is the whole
 * design and it is not discoverable from a switch.
 *
 * Two narrowings sit under the scope row, and both are OPTIONAL by
 * construction: a camera (scope `device`) and a set of object classes. Left
 * alone they mean "everything", which is the behaviour the panel had before
 * either existed — so the way to silence less is to say more, never to
 * remember to say something.
 */
import { BellOff, Clock } from '../../lib/icons.js'
import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { hapticAction, hapticTap } from '../../lib/haptics.js'
import { useTranslation } from 'react-i18next'
import { Section } from '../../components/ui/Section.js'
import { SelectRow } from '../../components/ui/SelectRow.js'
import { ToggleRow } from '../../components/ui/ToggleRow.js'
import type { NcSnooze, NcSnoozeScope, NcViewerRule } from '../../data/notification-center.js'
import { useCameras } from '../../data/use-cameras.js'
import { useIsAdmin } from '../../data/use-me.js'
import { useCanActuate } from '../../hooks/use-user-scope.js'
import {
  useNcCancelSnooze,
  useNcConditionTaxonomy,
  useNcCreateSnooze,
  useNcRules,
  useNcSnoozes,
} from '../../data/use-notification-center.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import {
  SNOOZE_DURATIONS,
  buildSnoozeInput,
  canOfferGlobal,
  isActive,
  isSnoozeTargetComplete,
  remainingLabel,
  scopeLabelKey,
  snoozeClassOptions,
  sortSnoozes,
  type SnoozeClassOption,
  type SnoozeTarget,
} from './snooze-options.js'
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.js'

export function SnoozeTab() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const isAdmin = useIsAdmin()
  /**
   * SCOPE GATE (`actuate`). Opening a snooze SILENCES a rule or a camera for
   * everyone downstream of it, so it needs the device-create reach; ending one
   * early is the same act in reverse.
   *
   * What stays for a session without it: the LISTS. "Nothing is notifying you
   * because someone muted the drive until 21:00" is information, and taking it
   * away would leave the operator to conclude the pipeline is broken.
   */
  const canActuate = useCanActuate()

  const snoozesQuery = useNcSnoozes()
  const rulesQuery = useNcRules()
  const camerasQuery = useCameras()
  const taxonomyQuery = useNcConditionTaxonomy()
  const createSnooze = useNcCreateSnooze()
  const cancelSnooze = useNcCancelSnooze()

  const [scope, setScope] = useState<NcSnoozeScope>('all')
  const [ruleId, setRuleId] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [global, setGlobal] = useState(false)
  const [summary, setSummary] = useState(true)
  const [classes, setClasses] = useState<readonly string[]>([])

  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data])
  const cameras = useMemo(() => camerasQuery.data ?? [], [camerasQuery.data])
  const now = Date.now()
  const snoozes = useMemo(
    () => sortSnoozes(snoozesQuery.data ?? [], now),
    [snoozesQuery.data, now],
  )
  const live = snoozes.filter((s) => isActive(s, now))
  const recent = snoozes.filter((s) => !isActive(s, now))

  const selectedRule: NcViewerRule | null =
    ruleId === null ? null : (rules.find((r) => r.id === ruleId) ?? null)

  const mayGoGlobal = canOfferGlobal({
    scope,
    ...(selectedRule?.snoozeAllowGlobal !== undefined
      ? { ruleAllowsGlobal: selectedRule.snoozeAllowGlobal }
      : {}),
    isAdmin,
  })

  const ruleOptions = useMemo(
    () => rules.map((rule) => ({ value: rule.id, label: rule.name })),
    [rules],
  )
  const cameraOptions = useMemo(
    () => cameras.map((camera) => ({ value: camera.id, label: camera.name })),
    [cameras],
  )
  const classOptions: readonly SnoozeClassOption[] = useMemo(
    () => snoozeClassOptions(taxonomyQuery.data),
    [taxonomyQuery.data],
  )

  const target: SnoozeTarget = { scope, ruleId, deviceId }
  // A scoped window with nothing to scope to matches nothing — the hub refuses
  // it, so the button refuses first rather than surfacing an error.
  const canOpen = isSnoozeTargetComplete(target)

  const open = (minutes: number): void => {
    if (!canOpen) return
    createSnooze.mutate(
      buildSnoozeInput({
        ...target,
        durationMinutes: minutes,
        // Only ever asked for where the hub would allow it; it re-checks anyway.
        global: mayGoGlobal && global,
        summary,
        classes,
      }),
    )
  }

  const toggleClass = (value: string): void =>
    setClasses((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )

  return (
    <View style={{ gap: SPACING.xl }}>
      <Text style={{ color: colors.foregroundSubtle, fontSize: 13, lineHeight: 19 }}>
        {t('v2.nc.snooze.intro')}
      </Text>

      {snoozesQuery.isLoading ? (
        <View style={{ paddingVertical: SPACING['2xl'], alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.foregroundSubtle} />
        </View>
      ) : snoozesQuery.isError ? (
        <ErrorState fill={false} title={t('v2.nc.snooze.loadError')} onRetry={() => { void snoozesQuery.refetch() }} />
      ) : live.length === 0 ? (
        <EmptyState fill={false} icon={BellOff} title={t('v2.nc.snooze.activeNone')} />
      ) : (
        <Section title={t('v2.nc.snooze.active')}>
          {live.map((snooze, index) => (
            <SnoozeRow
              key={snooze.id}
              snooze={snooze}
              nowMs={now}
              ruleName={rules.find((r) => r.id === snooze.ruleId)?.name}
              cameraName={cameras.find((c) => c.id === snooze.deviceId)?.name}
              last={index === live.length - 1}
              {...(canActuate
                ? { onEnd: () => cancelSnooze.mutate({ snoozeId: snooze.id }) }
                : {})}
            />
          ))}
        </Section>
      )}

      {recent.length > 0 ? (
        <Section title={t('v2.nc.snooze.past')}>
          {recent.slice(0, 5).map((snooze, index, shown) => (
            <SnoozeRow
              key={snooze.id}
              snooze={snooze}
              nowMs={now}
              ruleName={rules.find((r) => r.id === snooze.ruleId)?.name}
              cameraName={cameras.find((c) => c.id === snooze.deviceId)?.name}
              last={index === shown.length - 1}
            />
          ))}
        </Section>
      ) : null}

      {/* The COMPOSER — everything below opens a snooze. Hidden whole for a
          session that may not, rather than left standing with dead buttons,
          and replaced by one line that says why the tab is only a list. */}
      {!canActuate ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 13, lineHeight: 19 }}>
          {t('v2.nc.snooze.viewOnly')}
        </Text>
      ) : (
        <>
      <Section title={t('v2.nc.snooze.openTitle')}>
        <SelectRow<NcSnoozeScope>
          label={t('v2.nc.snooze.scopeLabel')}
          options={[
            { value: 'all', label: t('v2.nc.snooze.everything') },
            { value: 'rule', label: t('v2.nc.snooze.aRule') },
            { value: 'device', label: t('v2.nc.snooze.aCamera') },
          ]}
          value={scope}
          onChange={(next) => {
            setScope(next)
            // Leaving rule scope drops a global request with it: the permission
            // that allowed it belonged to the rule.
            if (next !== 'rule') setGlobal(false)
          }}
        />
        {scope === 'rule' && ruleOptions.length > 0 ? (
          <SelectRow<string>
            label={t('v2.nc.snooze.chooseRule')}
            options={ruleOptions}
            value={ruleId ?? ruleOptions[0].value}
            onChange={(next) => {
              setRuleId(next)
              setGlobal(false)
            }}
          />
        ) : null}
        {scope === 'device' ? (
          cameraOptions.length > 0 ? (
            <SelectRow<number>
              label={t('v2.nc.snooze.chooseCamera')}
              options={cameraOptions}
              value={deviceId ?? cameraOptions[0].value}
              onChange={setDeviceId}
            />
          ) : (
            // Never a dead end in silence: with no cameras to pick, every
            // duration button is disabled and nothing else would say why.
            <Text
              style={{
                color: colors.foregroundSubtle,
                fontSize: 13,
                paddingHorizontal: SPACING.xl,
                paddingVertical: SPACING.lg,
              }}
            >
              {t(camerasQuery.isLoading ? 'v2.nc.snooze.camerasLoading' : 'v2.nc.snooze.noCameras')}
            </Text>
          )
        ) : null}
        <ToggleRow
          label={t('v2.nc.snooze.summaryLabel')}
          description={t('v2.nc.snooze.summaryHelp')}
          value={summary}
          onValueChange={setSummary}
        />
        <ToggleRow
          label={t('v2.nc.snooze.globalLabel')}
          description={
            mayGoGlobal ? t('v2.nc.snooze.globalHelp') : t('v2.nc.snooze.globalNotAllowed')
          }
          value={mayGoGlobal && global}
          onValueChange={setGlobal}
          disabled={!mayGoGlobal}
          last
        />
      </Section>

      {classOptions.length > 0 ? (
        <Section title={t('v2.nc.snooze.classesTitle')}>
          <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
            <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17 }}>
              {t('v2.nc.snooze.classesHelp')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
              <ClassChip
                label={t('v2.nc.snooze.everyClass')}
                selected={classes.length === 0}
                onPress={() => { hapticTap(); setClasses([]) }}
              />
              {classOptions.map((option) => (
                <ClassChip
                  key={option.value}
                  label={option.label}
                  selected={classes.includes(option.value)}
                  onPress={() => { hapticTap(); toggleClass(option.value) }}
                />
              ))}
            </View>
          </View>
        </Section>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md }}>
        {SNOOZE_DURATIONS.map((duration) => (
          <Pressable
            key={duration.minutes}
            accessibilityRole="button"
            disabled={!canOpen || createSnooze.isPending}
            // Opening a snooze silences notifications for real — heavier than
            // a preference tap.
            onPress={() => { hapticAction(); open(duration.minutes) }}
            style={{
              flexGrow: 1,
              alignItems: 'center',
              paddingVertical: SPACING.lg,
              paddingHorizontal: SPACING.xl,
              borderRadius: RADIUS.lg,
              backgroundColor: canOpen ? colors.primary : colors.surface,
            }}
          >
            <Text
              style={{
                color: canOpen ? colors.primaryForeground : colors.foregroundDisabled,
                fontSize: 15,
                fontWeight: '600',
              }}
            >
              {t(`v2.nc.snooze.durations.${duration.labelKey}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      {createSnooze.isError ? (
        <Text style={{ color: colors.danger, fontSize: 13 }}>{t('v2.nc.snooze.createError')}</Text>
      ) : null}
        </>
      )}
    </View>
  )
}

interface ClassChipProps {
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
}

/** One class in the narrowing row. The same chip shape the occupancy scope
 *  picker uses — a class list is a dozen options, which a cycling row is not. */
function ClassChip({ label, selected, onPress }: ClassChipProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.xs,
        paddingHorizontal: SPACING.sm,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? `${colors.primary}1f` : colors.background,
      }}
    >
      <Text style={{ color: selected ? colors.primary : colors.foreground, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  )
}

interface SnoozeRowProps {
  readonly snooze: NcSnooze
  readonly nowMs: number
  readonly ruleName?: string
  readonly cameraName?: string
  readonly last?: boolean
  readonly onEnd?: () => void
}

/** One window: what it covers, when it ends, and the way out of it. */
function SnoozeRow({ snooze, nowMs, ruleName, cameraName, last = false, onEnd }: SnoozeRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const remaining = remainingLabel(snooze, nowMs)
  // Name the thing, not the scope: "Front door" says what is silent, "One
  // camera" only says how many. The scope label is the fallback for a target
  // this client cannot resolve — never a blank.
  const what = ruleName ?? cameraName ?? t(scopeLabelKey(snooze.scope))
  const Icon = isActive(snooze, nowMs) ? BellOff : Clock

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
        paddingVertical: SPACING.lg,
        paddingHorizontal: SPACING.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Icon size={18} color={colors.foregroundSubtle} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 15 }}>
          {what}
          {snooze.classes !== undefined && snooze.classes.length > 0
            ? ` · ${snooze.classes.join(', ')}`
            : ''}
          {snooze.global ? ` · ${t('v2.nc.snooze.everyone')}` : ''}
        </Text>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
          {t('v2.nc.snooze.endsIn', {
            label: t(`v2.nc.snooze.remaining.${remaining.key}`, remaining.params),
          })}
        </Text>
      </View>
      {onEnd ? (
        <Pressable accessibilityRole="button" onPress={() => { hapticAction(); onEnd() }}>
          <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>
            {t('v2.nc.snooze.endNow')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
