/**
 * RulesTab — the Rules panel of the Notification Center.
 *
 * ## The list is BY KIND
 *
 * A KIND STRIP tops the list: All · Detection · Sensor · Sound · Occupancy ·
 * Devices · System · Alarm · To recreate (`rule-kind-nav.ts`, over the shared
 * `ruleKindOf`; the three system-event families and `mixed` are D637). Every rule is ONE
 * kind, and its row carries that kind as a badge, so even under All nothing is
 * mixed anonymously. The operator: "le rules devono essere specifiche per il
 * tipo, occupancy detection etc, sul viewer sembra che adesso sia tutto
 * mischiato" — the old SECTION strip filed a sensor rule under detection.
 *
 * A system-family tab is shown to an admin, and to anyone such a rule targets;
 * an empty one is dropped only once the hub has SAID the caller is not an
 * admin (`useAdminVerdict`, D315) — not-yet-known must not read as absent.
 * "To recreate" (`mixed`) is shown only while it holds rules: nobody can
 * create one, and its rows say how to replace it (`RuleRow`).
 *
 * Within the chosen kind the rules are still split by ownership
 * (`partitionRules`):
 *
 *   • "My rules"    — the caller's PERSONAL rules (`readOnly === false`), each
 *     with ONE action row: Enabled switch (`useNcSetRuleEnabled`), Edit, Delete.
 *   • "Admin rules" — admin/global rules (`readOnly === true`): read-only, except
 *     that for each of the rule's targets the caller personally OWNS a per-target
 *     opt-out toggle lets them opt that target in/out (`setRuleTargetEnabled`).
 *
 * All server access is through the B1 `useNc*` hooks. Ownership + the `readOnly`
 * verdict are server-derived; this panel never decides them.
 *
 * ## The editor is a ROUTE
 *
 * Tapping a card — anywhere but its controls — pushes `/rule/[id]` (a summary
 * plus one sub-screen per section; read-only for an admin rule). Every list is
 * sorted by NAME (`sortRulesByName`), and Delete is confirmed through the
 * app's shared confirm dialog (`useConfirm`, `RuleActionRow`). "New rule" pushes the rule SEEDED as the
 * selected kind when the caller may create it, and the kind picker otherwise
 * (`createRuleHref`). A timelapse rule and a digest rule are routes too
 * (`/timelapse-rule/[id]`, `/summary-rule/[id]`).
 *
 * ## Two more tabs, and they are NOT kinds of this list
 *
 * `Timelapse` and `Summary` sit at the end of the strip and are backed by their
 * own stores and their own bridge actions — a timelapse rides no `NcDelivery`
 * member at all, and a digest rule's schema does not even live in
 * `@camstack/types`. So they are never passed through `rulesOfKind` /
 * `ruleKindOf` (which files anything it does not recognise as a detection
 * rule, and would therefore show the whole detection list under Timelapse);
 * their counts come from their own queries, and `NcRulesStripKey` keeps the
 * two kinds of key apart in the type system.
 *
 * ## The summary tab DEGRADES rather than erroring
 *
 * `nc.upsertSummaryRule` was `auth: 'admin'` until the operator closed that
 * decision, so a phone talking to an older hub must not offer a form whose only
 * feedback would be a 403 taken after it was filled in. The list response
 * carries `canAuthor`; absent means an older hub, and the tab then shows the
 * rules READ-ONLY with a note saying the hub has to be updated. Never an error,
 * and never a hidden tab — a digest the operator is receiving must stay visible
 * even where they cannot edit it.
 */
import React, { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Bell, Plus } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RuleRow } from '../../components/notifications/RuleRow.js'
import {
  NC_RULE_SNOOZE_NOW_MINUTES,
  partitionRules,
  ruleSnoozeSwitchFor,
  sortRulesByName,
  type RuleSnoozeSwitch,
} from '../../components/notifications/rule-row.js'
import {
  sectionCreateKey,
  sectionEmptyKey,
  sectionLabelKey,
} from '../../components/notifications/rule-sections.js'
import {
  creatableKinds,
  kindCreateKey,
  kindEmptyKey,
  rulesOfKind,
  viewerKindStrip,
  type NcRulesStripKey,
} from '../../components/notifications/rule-kind-nav.js'
import { FamilyRuleRow } from '../../components/notifications/FamilyRuleRow.js'
import {
  createRuleHref,
  ruleHistoryHref,
  ruleHref,
  summaryRuleHref,
  timelapseRuleHref,
} from '../../navigation/rule-routes.js'
import { useRuleLastRuns } from '../../data/use-rule-history.js'
import { ruleLastRunLine } from '../../components/notifications/rule-last-run.js'
import type { RuleTitleHistory } from '../../components/notifications/RuleTitle.js'
import { useMinuteClock } from '../../components/notifications/RuleLastRunRow.js'
import { useAdminVerdict } from '../../data/use-me.js'
import { useSharedSequences } from '../../data/use-shared-sequences.js'
import { useRulesStripKey } from './use-rules-strip-key.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import {
  useNcDeleteRule,
  useNcDeleteSummaryRule,
  useNcDeleteTimelapseRule,
  useNcRules,
  useNcSetRuleEnabled,
  useNcSetRuleSnooze,
  useNcSnoozes,
  useNcSetSummaryRuleEnabled,
  useNcSetTimelapseRuleEnabled,
  useNcSetRuleTargetEnabled,
  useNcSummaryRules,
  useNcTargets,
  useNcTimelapseRules,
} from '../../data/use-notification-center.js'
import type { NcViewerRule } from '../../data/notification-center.js'
import { targetsReadState } from '../../components/notifications/save-gate.js'
import { SectionLabel } from '../../components/ui/SectionLabel.js'
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.js'
import { FilterChip } from '../../components/ui/FilterChip.js'

/** One tab of the strip — a rule kind, or one of the two separate families. */
interface RulesStripTab {
  readonly key: NcRulesStripKey
  readonly labelKey: string
  readonly count: number
}

export function RulesTab() {
  const { t } = useTranslation()
  const router = useRouter()
  const { colors } = useTheme()

  const rulesQuery = useNcRules()
  const targetsQuery = useNcTargets()
  const timelapseQuery = useNcTimelapseRules()
  const summaryQuery = useNcSummaryRules()
  const deleteRule = useNcDeleteRule()
  const deleteTimelapse = useNcDeleteTimelapseRule()
  const deleteSummary = useNcDeleteSummaryRule()
  const setRuleTargetEnabled = useNcSetRuleTargetEnabled()
  const setRuleEnabled = useNcSetRuleEnabled()
  const setRuleSnooze = useNcSetRuleSnooze()
  const snoozesQuery = useNcSnoozes()
  const setTimelapseEnabled = useNcSetTimelapseRuleEnabled()
  const setSummaryEnabled = useNcSetSummaryRuleEnabled()

  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data])
  const ownTargets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const ownTargetsState = targetsReadState(targetsQuery)
  const timelapseRules = useMemo(() => sortRulesByName(timelapseQuery.data ?? []), [timelapseQuery.data])
  const summaryRules = useMemo(() => sortRulesByName(summaryQuery.data?.rules ?? []), [summaryQuery.data])
  // ABSENT is the answer that matters: an older hub says nothing, and the app
  // reads that as "this hub still refuses your write" rather than trying it.
  const canAuthorSummary = summaryQuery.data?.canAuthor === true
  const verdict = useAdminVerdict()
  // The shared sequences a rule's bindings point at — only for an admin (the
  // method is admin-only); the snooze switch resolves alarm steps through it.
  const sharedSequences = useSharedSequences(verdict === 'admin').data
  // ONE read for every card of every kind — never a per-card call. `hidden`
  // for a viewer the hub has not confirmed as an admin: the method is admin,
  // and a refusal must never read as "not in the last N days" (D315).
  const lastRuns = useRuleLastRuns()
  const nowMs = useMinuteClock()
  const [remembered, setSection] = useRulesStripKey()
  // The kinds are counted from the SAME predicate that fills the list, so a
  // badge reading 3 over a list showing 2 is not expressible; the two FAMILY
  // counts come from their own queries, because those rules are not a
  // partition of this list at all.
  const tabs = useMemo<readonly RulesStripTab[]>(
    () => [
      ...viewerKindStrip(rules, verdict),
      { key: 'timelapse', labelKey: sectionLabelKey('timelapse'), count: timelapseRules.length },
      { key: 'summary', labelKey: sectionLabelKey('summary'), count: summaryRules.length },
    ],
    [rules, verdict, timelapseRules.length, summaryRules.length],
  )
  // A remembered tab the strip no longer offers (an empty System tab for a
  // caller the hub just called not-admin) falls back to All, never to a list
  // with no tab lit.
  const section: NcRulesStripKey = tabs.some((tab) => tab.key === remembered) ? remembered : 'all'
  const kindRules = useMemo(
    () => (section === 'timelapse' || section === 'summary' ? [] : sortRulesByName(rulesOfKind(rules, section))),
    [rules, section],
  )
  const sections = useMemo(() => partitionRules(kindRules), [kindRules])
  const personalRules = sections.personal
  const adminRules = sections.admin
  const systemRules = sections.system

  const openRule = (rule: NcViewerRule): void => router.push(ruleHref(rule.id))
  /** The last-run line of one card, and its door to the rule's history. */
  const historyFor = (ruleId: string, name: string): RuleTitleHistory | undefined => {
    const line = ruleLastRunLine(lastRuns, ruleId)
    return line === undefined
      ? undefined
      : { line, nowMs, onOpen: () => router.push(ruleHistoryHref(ruleId, name)) }
  }
  /** The row's Enabled switch: resolves once the hub's answer is in the list,
   *  rejects when it was refused or not applied (the row says why). */
  const switchRule = (rule: NcViewerRule, enabled: boolean): Promise<unknown> =>
    setRuleEnabled.mutateAsync({ ruleId: rule.id, enabled })

  /** The card's Snooze switch — snooze THIS rule for 30 minutes, or end its windows. */
  const snoozeRule = (rule: NcViewerRule, snoozed: boolean, state: RuleSnoozeSwitch): Promise<unknown> =>
    setRuleSnooze.mutateAsync({
      ruleId: rule.id,
      snoozed,
      durationMinutes: NC_RULE_SNOOZE_NOW_MINUTES,
      activeIds: state.activeIds,
    })
  /**
   * The windows the switches read — `undefined` until the hub answered (D315).
   * Judged at the later of the minute clock and the list's own fetch time: a
   * window the switch just opened starts after the clock's last tick, but
   * never after the re-read that listed it; the clock then ends it on time.
   */
  const snoozeNowMs = Math.max(nowMs, snoozesQuery.dataUpdatedAt)
  const snoozeOf = (rule: NcViewerRule): RuleSnoozeSwitch =>
    ruleSnoozeSwitchFor(rule, snoozesQuery.data, snoozeNowMs)

  /** Delete — the card's popover has already asked. */
  const deleteOne = (rule: NcViewerRule): void => {
    deleteRule.mutate({ ruleId: rule.id })
  }

  if (section === 'timelapse') {
    return (
      <View style={{ gap: SPACING.xl }}>
        <SectionStrip tabs={tabs} selected={section} onSelect={setSection} />
        <CreateButton
          label={t(sectionCreateKey('timelapse'))}
          onPress={() => router.push(timelapseRuleHref('new'))}
        />
        <FamilyList
          loading={timelapseQuery.isLoading}
          error={timelapseQuery.isError}
          empty={timelapseRules.length === 0}
          emptyMessage={t(sectionEmptyKey('timelapse'))}
        >
          {timelapseRules.map((rule) => (
            <FamilyRuleRow
              key={rule.id}
              ruleId={rule.id}
              family="timelapse"
              name={rule.name}
              readOnly={rule.readOnly}
              enabled={rule.enabled}
              deviceCount={rule.deviceIds.length}
              generatedAt={rule.lastGeneratedAt}
              history={historyFor(rule.id, rule.name)}
              onEdit={() => router.push(timelapseRuleHref(rule.id))}
              onSetEnabled={(enabled) => setTimelapseEnabled.mutateAsync({ ruleId: rule.id, enabled })}
              onDelete={() => deleteTimelapse.mutate({ ruleId: rule.id })}
            />
          ))}
        </FamilyList>
      </View>
    )
  }

  if (section === 'summary') {
    return (
      <View style={{ gap: SPACING.xl }}>
        <SectionStrip tabs={tabs} selected={section} onSelect={setSection} />
        {/* The degrade, stated rather than hidden: an older hub keeps the
            upsert admin-only, so the list is shown READ-ONLY with a note. A
            "New summary" button here would produce a 403 the operator can do
            nothing about, after they had filled the form in. */}
        {canAuthorSummary ? (
          <CreateButton
            label={t(sectionCreateKey('summary'))}
            onPress={() => router.push(summaryRuleHref('new'))}
          />
        ) : summaryQuery.isSuccess ? (
          <Note text={t('v2.nc.summary.hubTooOld')} />
        ) : null}
        <FamilyList
          loading={summaryQuery.isLoading}
          error={summaryQuery.isError}
          empty={summaryRules.length === 0}
          emptyMessage={t(sectionEmptyKey('summary'))}
        >
          {summaryRules.map((rule) => (
            <FamilyRuleRow
              key={rule.id}
              ruleId={rule.id}
              family="summary"
              name={rule.name}
              // Two independent reasons a row is not editable, and both have to
              // hold for Edit, Delete or the switch to appear: the server's per-row verdict, and
              // whether this hub accepts the write at all.
              readOnly={rule.readOnly || !canAuthorSummary}
              enabled={rule.enabled}
              deviceCount={rule.deviceIds.length}
              generatedAt={rule.generatedAt}
              history={historyFor(rule.id, rule.name)}
              onEdit={() => router.push(summaryRuleHref(rule.id))}
              onSetEnabled={(enabled) => setSummaryEnabled.mutateAsync({ ruleId: rule.id, enabled })}
              onDelete={() => deleteSummary.mutate({ ruleId: rule.id })}
            />
          ))}
        </FamilyList>
      </View>
    )
  }

  // A kind the caller may not create (System, for a non-admin) opens the
  // picker rather than a seed the hub would refuse — and its button says so.
  const creatable = creatableKinds(verdict === 'admin')
  const createsSelected = section === 'all' || creatable.includes(section)
  return (
    <View style={{ gap: SPACING.xl }}>
      <SectionStrip tabs={tabs} selected={section} onSelect={setSection} />

      <CreateButton
        label={t(kindCreateKey(createsSelected ? section : 'all'))}
        onPress={() => router.push(createRuleHref(section, creatable))}
      />

      {rulesQuery.isLoading ? (
        <View style={{ paddingVertical: SPACING['3xl'], alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.foregroundSubtle} />
        </View>
      ) : rulesQuery.isError ? (
        <ErrorState fill={false} title={t('v2.nc.rules.loadError')} onRetry={() => { void rulesQuery.refetch() }} />
      ) : kindRules.length === 0 ? (
        <EmptyState fill={false} icon={Bell} title={t(kindEmptyKey(section))} />
      ) : (
        <>
          {personalRules.length > 0 ? (
            <View style={{ gap: SPACING.lg }}>
              <SectionLabel inset>{t('v2.nc.rules.mine')}</SectionLabel>
              {personalRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  ownTargets={ownTargets}
                  ownTargetsState={ownTargetsState}
                  history={historyFor(rule.id, rule.name)}
                  sequences={sharedSequences}
                  onEdit={openRule}
                  onDelete={deleteOne}
                  onSetEnabled={switchRule}
                  onSetSnooze={snoozeRule}
                  snooze={snoozeOf(rule)}
                  onSetTargetEnabled={(ruleId, targetId, enabled) =>
                    setRuleTargetEnabled.mutate({ ruleId, targetId, enabled })
                  }
                />
              ))}
            </View>
          ) : null}

          {adminRules.length > 0 ? (
            <View style={{ gap: SPACING.lg }}>
              <SectionLabel inset>{t('v2.nc.rules.admin')}</SectionLabel>
              {adminRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  ownTargets={ownTargets}
                  ownTargetsState={ownTargetsState}
                  history={historyFor(rule.id, rule.name)}
                  sequences={sharedSequences}
                  onEdit={openRule}
                  onDelete={deleteOne}
                  onSetEnabled={switchRule}
                  onSetSnooze={snoozeRule}
                  snooze={snoozeOf(rule)}
                  onSetTargetEnabled={(ruleId, targetId, enabled) =>
                    setRuleTargetEnabled.mutate({ ruleId, targetId, enabled })
                  }
                />
              ))}
            </View>
          ) : null}

          {systemRules.length > 0 ? (
            <View style={{ gap: SPACING.lg }}>
              <SectionLabel inset>{t('v2.nc.rules.system')}</SectionLabel>
              {systemRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  ownTargets={ownTargets}
                  ownTargetsState={ownTargetsState}
                  history={historyFor(rule.id, rule.name)}
                  sequences={sharedSequences}
                  onEdit={openRule}
                  onDelete={deleteOne}
                  onSetEnabled={switchRule}
                  onSetSnooze={snoozeRule}
                  snooze={snoozeOf(rule)}
                  onSetTargetEnabled={(ruleId, targetId, enabled) =>
                    setRuleTargetEnabled.mutate({ ruleId, targetId, enabled })
                  }
                />
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  )
}

/** The one primary action on this screen, whatever the tab authors. */
function CreateButton({
  label,
  onPress,
}: {
  readonly label: string
  readonly onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: SPACING.sm,
        paddingVertical: SPACING.lg,
        borderRadius: RADIUS.lg,
        backgroundColor: colors.primary,
      }}
    >
      <Plus size={18} color={colors.primaryForeground} />
      <Text style={{ color: colors.primaryForeground, fontSize: 15, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * The load / error / empty ladder for a family tab.
 *
 * An ERROR is shown as an error and never as an empty list: these two families
 * produce hours after the fact, so "no rules" is a perfectly plausible screen
 * and an operator shown one instead of a failure concludes their rules were
 * deleted. That is the same reasoning behind the hub REFUSING these actions on
 * a node that hosts no producer rather than answering an empty list.
 */
function FamilyList({
  loading,
  error,
  empty,
  emptyMessage,
  children,
}: {
  readonly loading: boolean
  readonly error: boolean
  readonly empty: boolean
  readonly emptyMessage: string
  readonly children: React.ReactNode
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (loading) {
    return (
      <View style={{ paddingVertical: SPACING['3xl'], alignItems: 'center' }}>
        <ActivityIndicator size="small" color={colors.foregroundSubtle} />
      </View>
    )
  }
  if (error) return <ErrorState fill={false} title={t('v2.nc.rules.loadError')} />
  if (empty) return <EmptyState fill={false} icon={Bell} title={emptyMessage} />
  return <View style={{ gap: SPACING.lg }}>{children}</View>
}

/** A neutral explanation above a list — not a failure, not a call to action. */
function Note({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: RADIUS.md,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
      }}
    >
      <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17 }}>{text}</Text>
    </View>
  )
}

interface SectionStripProps {
  readonly tabs: readonly RulesStripTab[]
  readonly selected: NcRulesStripKey
  readonly onSelect: (next: NcRulesStripKey) => void
}

/**
 * The kind strip, with live counts — the Library's `FilterChip`s, wrapped
 * rather than scrolled: a strip the operator has to scroll to discover hides
 * the kinds it exists to reveal. A kind with no rules reads as just its name.
 */
function SectionStrip({ tabs, selected, onSelect }: SectionStripProps) {
  const { t } = useTranslation()
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
      {tabs.map((tab) => (
        <FilterChip
          key={tab.key}
          label={t(tab.labelKey)}
          count={tab.count}
          role="tab"
          active={tab.key === selected}
          onPress={() => onSelect(tab.key)}
        />
      ))}
    </View>
  )
}
