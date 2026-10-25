/**
 * AlarmSettingsScreen — the admin's alarm configuration on the phone (D630,
 * Task 12): the panel now (with the arm / Arm anyway / disarm flow), what each
 * mode covers and which of its openings may be open, who hears about it, and
 * its three durations. The same content as the admin UI's Alarm tab.
 *
 * Each mode's card is a SENSOR TABLE (D697): a row per opening with its state,
 * whether the arm check reads it, and a switch. The switch is not part of the
 * draft below - it writes ONE `nonBlockingEdit` at once, one write at a time
 * (`useNcAlarmSwitch`), and says when it did not land.
 *
 * Shown as the Notification Center's Alarm section (`AlarmSettingsSection`,
 * offered only to a CONFIRMED admin), and as the stacked `/settings/alarm`
 * route a rule's alarm field and old links open. A deep link
 * gets an honest state, never a blank form:
 *  - role pending → a spinner; role unknown (`auth.me` failed) → say so, retry;
 *  - not an admin → the hub's answer: only an administrator configures it
 *    (every `nc.*Alarm*` action is admin-only, so it is not asked);
 *  - config pending → a spinner; failed → the error, retry; a hub with no
 *    panel → a statement, not an editor whose Save goes nowhere.
 *
 * The form is a draft of CHANGES (typed delays) laid over the hub's LATEST answer — re-read at Save
 * (`useFetchFreshAlarmConfig`), never the cache: Save sends only the
 * fields that then differ (`alarmSettingsPatch`), never reverts a list another
 * admin changed meanwhile, and says when that happened. Nothing is written
 * until an answer exists. The answer must carry what was sent (`alarmPatchLanded`)
 * or the draft stays, said. Leaving with unsaved changes asks first
 * (`usePreventRemove`, as the rule editors do). `useNcSetAlarmConfig` shows
 * what the hub settled on and re-reads config and status when it settles.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useIsFocused, useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { alarmPatchLanded } from '@camstack/types/client'
import type { AlarmArmMode, NcAlarmConfig, NcAlarmSettings } from '@camstack/types'
import { useMe, useAdminVerdict } from '../../data/use-me.js'
import {
  useFetchFreshAlarmConfig,
  useNcAlarmConfig,
  useNcAlarmSensors,
  useNcAlarmSwitch,
  useNcSetAlarmConfig,
  type NcAlarmSwitchNotice,
} from '../../data/use-nc-alarm.js'
import { NC_ALARM_FAST_POLL_MS, ncAlarmPollMs } from '../../data/nc-alarm.js'
import { useHouseholdOpenings } from '../../data/use-alarm-setup.js'
import { usePickerZonesRead } from '../../data/use-site-zones.js'
import type { PickerDevice } from '../../components/notifications/device-picker-model.js'
import {
  alarmSensorRows,
  alarmSensorsHubTooOld,
  type AlarmSensorRow,
  type AlarmSensorsRead,
} from '../../components/notifications/alarm-sensor-table-model.js'
import { useDevicesByIds } from '../../data/use-devices-by-ids.js'
import { deviceListStateOf, resolveSelectedDevices } from '../../components/notifications/device-selection.js'
import {
  alarmDeviceLabel,
  alarmEditsEmpty,
  commitDelay,
  commitModeDelay,
  modeDelayView,
  setModeDelayDefault,
  typeModeDelay,
  draftVisiblyDiffers,
  alarmCoverageIds,
  alarmSettingsChanged,
  alarmSettingsPatch,
  EMPTY_ALARM_EDITS,
  effectiveAlarmSettings,
  alarmMembershipLists,
  blockingFor,
  nonBlockingFor,
  nonBlockingOptions,
  secureOnArmOffFor,
  typeDelay,
  type AlarmSettingsEdits,
} from '../../components/notifications/alarm-settings-model.js'
import { useNcErrorText } from '../../components/notifications/use-nc-error-text.js'
import { useConfirm } from '../../components/ui/confirm.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { EditorScroll } from './rule-editor/EditorScroll.js'
import { EditorNotice } from './rule-editor/EditorNotice.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import {
  AlarmNote,
  DelaysSection,
  ModeCard,
  SensorsFailedNote,
  RetryNote,
  StateSection,
  labelText,
  type AlarmNameOf,
  type AlarmReadState,
} from './AlarmSettingsSections.js'
import { ConfirmFooter } from '../../components/ui/Button.js'

interface QueryStateSource {
  readonly data: unknown
  readonly isError: boolean
}

function readStateOf(query: QueryStateSource): AlarmReadState {
  if (query.data !== undefined) return 'answered'
  return query.isError ? 'failed' : 'pending'
}

export function AlarmSettingsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const onBack = (): void => router.back()
  return (
    <EditorScroll title={t('v2.nc.alarm.title')} onBack={onBack}>
      <AlarmSettingsSection />
    </EditorScroll>
  )
}

export interface AlarmSettingsSectionProps {
  /**
   * Ask before a route carrying an unsaved draft is removed (default). The
   * Notification Center's Alarm section passes `false`: a tab is never removed
   * by switching away, the section stays mounted once visited so the draft
   * survives, and a guard there would intercept the removal of the whole tab
   * navigator instead (sign-out).
   */
  readonly guardLeave?: boolean
}

/**
 * The alarm's configuration without a frame of its own: the stacked route
 * wraps it in an `EditorScroll`, the Notification Center's Alarm section in its
 * own scroll under the `ScopeBar`. Both say the same states.
 */
export function AlarmSettingsSection({ guardLeave = true }: AlarmSettingsSectionProps) {
  const { t } = useTranslation()
  const verdict = useAdminVerdict()
  const me = useMe()
  return (
    <>
      {verdict === 'pending' ? <EditorNotice /> : null}
      {verdict === 'not-admin' ? <EditorNotice message={t('v2.nc.alarm.notAdmin')} /> : null}
      {verdict === 'unknown' ? (
        <RetryNote text={t('v2.nc.alarm.verdictUnknown')} onRetry={() => void me.refetch()} />
      ) : null}
      {verdict === 'admin' ? <AlarmSettingsBody guardLeave={guardLeave} /> : null}
    </>
  )
}

function AlarmSettingsBody({ guardLeave }: { readonly guardLeave: boolean }) {
  const { t } = useTranslation()
  const errorText = useNcErrorText()
  const config = useNcAlarmConfig()
  if (config.data === undefined) {
    if (!config.isError) return <EditorNotice />
    return (
      <RetryNote
        text={t('v2.nc.alarm.loadFailed', { error: errorText(config.error) ?? '' })}
        onRetry={() => void config.refetch()}
      />
    )
  }
  if (config.data.deviceId === null) return <EditorNotice message={t('v2.nc.alarm.noPanel')} />
  return <AlarmSettingsForm config={config.data} panelId={config.data.deviceId} guardLeave={guardLeave} />
}

const NO_IDS: readonly number[] = []

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface SwitchNoticeLineProps {
  readonly notice: NcAlarmSwitchNotice
}

/** What the screen says about the switch write it just made, or refused to make. */
function SwitchNoticeLine({ notice }: SwitchNoticeLineProps) {
  const { t } = useTranslation()
  const modeName = (mode: AlarmArmMode): string => t(`v2.accessories.armMode.${mode}`)
  switch (notice.kind) {
    case 'refused':
      return (
        <AlarmNote
          tone="warning"
          testID="alarm-switch-refused"
          text={t('v2.nc.alarm.table.notice.refused', {
            name: notice.inFlight.name,
            mode: modeName(notice.inFlight.mode),
          })}
        />
      )
    case 'not-landed':
      return (
        <AlarmNote
          tone="warning"
          testID="alarm-switch-not-landed"
          text={t('v2.nc.alarm.table.notice.notLanded', {
            name: notice.write.name,
            mode: modeName(notice.write.mode),
          })}
        />
      )
    case 'failed':
      return (
        <AlarmNote
          tone="danger"
          testID="alarm-switch-failed"
          text={t('v2.nc.alarm.table.notice.failed', {
            name: notice.write.name,
            mode: modeName(notice.write.mode),
            error: notice.error,
          })}
        />
      )
  }
}

interface AlarmSettingsFormProps {
  readonly config: NcAlarmConfig
  readonly panelId: number
  readonly guardLeave: boolean
}

/** Every device id the screen names: covered, excluded (D641), listed, skipped, unreadable. */
function referencedIds(config: NcAlarmConfig): number[] {
  const ids = new Set<number>()
  for (const row of config.coverage) for (const id of alarmCoverageIds(row)) ids.add(id)
  const membership = alarmMembershipLists(config.settings)
  for (const list of membership.nonBlocking) for (const id of list.deviceIds) ids.add(id)
  for (const list of membership.blocking) for (const id of list.deviceIds) ids.add(id)
  for (const list of membership.secureOnArmOff) for (const id of list.deviceIds) ids.add(id)
  for (const row of config.live?.openings ?? []) for (const id of row.unknown) ids.add(id)
  return [...ids]
}

function AlarmSettingsForm({ config, panelId, guardLeave }: AlarmSettingsFormProps) {
  const [modeTab, setModeTab] = useState<AlarmArmMode | null>(null)
  const { t } = useTranslation()
  const errorText = useNcErrorText()
  const navigation = useNavigation()
  const confirm = useConfirm()
  const [edits, setEdits] = useState<AlarmSettingsEdits>(EMPTY_ALARM_EDITS)
  // The settings as they were at the first edit: a later answer that differs
  // means somebody else changed them, and the draft says it was laid on top.
  const [origin, setOrigin] = useState<NcAlarmSettings | null>(null)
  const [notLanded, setNotLanded] = useState(false)
  // Save re-reads the config first; these are that read's state and verdict.
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<Error | null>(null)
  const [mergedElsewhere, setMergedElsewhere] = useState(false)
  const fetchFresh = useFetchFreshAlarmConfig()
  const leavingRef = useRef(false)
  // A re-read that answers after the screen is gone must not send its draft.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const save = useNcSetAlarmConfig()
  const referenced = useMemo(() => referencedIds(config), [config])
  // EVERY opening of the household (D636): the fleet plus one bounded,
  // batched bindings read over its non-camera devices.
  const household = useHouseholdOpenings()
  const openingIds = useMemo(
    (): ReadonlySet<number> | null => (household.ids.data === undefined ? null : new Set(household.ids.data)),
    [household.ids.data],
  )
  const openingsState: AlarmReadState = readStateOf(household.ids)
  const retryOpenings = (): void => {
    void household.ids.refetch()
  }
  const names = useDevicesByIds(referenced)
  const zones = usePickerZonesRead(true)
  const focused = useIsFocused()

  const nameOf = useMemo<AlarmNameOf>(() => {
    const rows = new Map(
      resolveSelectedDevices(referenced, names.data, deviceListStateOf(names)).map((row) => [row.id, row]),
    )
    const openNames = new Map<number, string>()
    for (const row of config.live?.openings ?? []) for (const d of row.devices) openNames.set(d.deviceId, d.name)
    return (id: number) => alarmDeviceLabel(id, rows, openNames)
  }, [config, names, referenced])

  // What each opening IS (type, room): the household scan's rows, then the
  // targeted name lookup's - the same two reads the screen already makes.
  const factsById = useMemo(
    () => new Map([...(names.data ?? []), ...(household.rows.data ?? [])].map((d) => [d.id, d])),
    [names.data, household.rows.data],
  )
  // The hub's name wins; an opening nothing else names (the scan found it, no
  // alarm line mentions it) is named by the fleet it was found in.
  const candidateName = (id: number): string => {
    const label = nameOf(id)
    const fleetName = factsById.get(id)?.name ?? ''
    if (label.kind !== 'named' && fleetName !== '') return fleetName
    return labelText(label, id, t)
  }

  const latest = config.settings
  // Every mode's candidate openings (D636: every opening of the household plus
  // every id already listed, D49). A removed id is a row but is never read.
  const optionsByMode = useMemo(
    () =>
      new Map(
        config.coverage.map((row) => [
          row.mode,
          nonBlockingOptions({
            live: config.live,
            listed: nonBlockingFor(latest.nonBlocking, row.mode),
            openingIds,
          }),
        ]),
      ),
    [config.coverage, config.live, latest.nonBlocking, openingIds],
  )
  const sensorIds = useMemo((): readonly number[] => {
    const all = new Set<number>()
    for (const options of optionsByMode.values()) {
      for (const id of options.ids) if (nameOf(id).kind !== 'removed') all.add(id)
    }
    return [...all].sort((a, b) => a - b)
  }, [optionsByMode, nameOf])
  const alarmActive = ncAlarmPollMs(config.live?.state) === NC_ALARM_FAST_POLL_MS
  // Ask for the states once the candidates are SETTLED: the household scan and
  // the name lookup have answered (or failed), so a first read does not name
  // half the openings and a second one the rest, and an id the lookup is about
  // to call removed is not read (D315, D49).
  const candidatesSettled = openingsState !== 'pending' && !names.isLoading
  const sensors = useNcAlarmSensors(candidatesSettled ? sensorIds : NO_IDS, alarmActive, focused)
  const sensorsRead: AlarmSensorsRead = sensors.isError
    ? { status: 'failed', error: errorMessage(sensors.error) }
    : sensors.data !== undefined
      ? { status: 'answered', sensors: sensors.data.sensors }
      : { status: 'pending' }
  const sensorsRetry =
    sensorsRead.status === 'failed' && !alarmSensorsHubTooOld(sensorsRead.error)
      ? (): void => void sensors.refetch()
      : null
  const alarmSwitch = useNcAlarmSwitch()
  const rowsFor = (mode: AlarmArmMode, coverage: NcAlarmConfig['coverage'][number]): readonly AlarmSensorRow[] => {
    const ids = optionsByMode.get(mode)?.ids ?? []
    const membership = alarmMembershipLists(latest)
    return alarmSensorRows({
      candidates: ids.map((id): PickerDevice => {
        const facts = factsById.get(id)
        return {
          id,
          name: candidateName(id),
          ...(facts !== undefined ? { type: facts.type, location: facts.location } : {}),
        }
      }),
      removedIds: new Set(ids.filter((id) => nameOf(id).kind === 'removed')),
      coverage,
      nonBlocking: nonBlockingFor(membership.nonBlocking, mode),
      blocking: blockingFor(membership.blocking, mode),
      secureOnArmOff: secureOnArmOffFor(membership.secureOnArmOff, mode),
      sensors: sensorsRead,
    })
  }

  const view = effectiveAlarmSettings(latest, edits)
  const patch = alarmSettingsPatch(latest, edits)
  const dirty = patch !== null
  const changedElsewhere = origin !== null && !alarmEditsEmpty(edits) && alarmSettingsChanged(origin, latest)
  const busy = save.isPending || refreshing

  usePreventRemove(dirty && guardLeave, ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action)
      return
    }
    void confirm({
      title: t('v2.nc.alarm.leave.title'),
      message: t('v2.nc.alarm.leave.body'),
      confirmLabel: t('v2.nc.alarm.leave.discard'),
      cancelLabel: t('v2.nc.alarm.leave.keep'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      leavingRef.current = true
      navigation.dispatch(data.action)
    })
  })

  const edit = (change: (prev: AlarmSettingsEdits) => AlarmSettingsEdits): void => {
    setOrigin((prev) => prev ?? latest)
    setNotLanded(false)
    setRefreshError(null)
    setMergedElsewhere(false)
    setEdits(change)
  }
  const reset = (): void => {
    setEdits(EMPTY_ALARM_EDITS)
    setOrigin(null)
    setNotLanded(false)
  }
  const send = (fresh: NcAlarmConfig): void => {
    // The operator left (and discarded) or the screen unmounted while the
    // re-read ran: that draft was thrown away, and is never sent.
    if (leavingRef.current || !mountedRef.current) return
    setRefreshing(false)
    // Somebody else changed it since the first edit: still saved (the draft
    // is changes, laid over THIS answer), and said.
    setMergedElsewhere(origin !== null && alarmSettingsChanged(origin, fresh.settings))
    const freshPatch = alarmSettingsPatch(fresh.settings, edits)
    if (freshPatch === null) {
      // The hub already holds everything the draft asks for.
      reset()
      return
    }
    save.mutate(freshPatch, {
      // The hub's answer must carry what was sent: an older hub strips a key
      // it does not know and still answers success — the draft stays then.
      onSuccess: (answer) => (alarmPatchLanded(freshPatch, answer.settings) ? reset() : setNotLanded(true)),
    })
  }
  /**
   * Save merges onto the hub's CURRENT config, re-read now: the cached one is
   * not refreshed while this screen is open. A re-read that fails sends
   * nothing — a merge onto an unknown base could revert someone's change.
   */
  const onSave = (): void => {
    if (patch === null || busy) return
    setRefreshing(true)
    setRefreshError(null)
    setNotLanded(false)
    fetchFresh().then(send, (error: unknown) => {
      if (!mountedRef.current) return
      setRefreshing(false)
      setRefreshError(error instanceof Error ? error : new Error(String(error)))
    })
  }
  const refreshErrorText = errorText(refreshError)
  const saveError = errorText(save.error)

  // One mode at a time; until the operator picks one, the first mode that checks a sensor.
  const activeRow =
    config.coverage.find((c) => c.mode === modeTab) ??
    config.coverage.find((c) => rowsFor(c.mode, c).length > 0) ??
    config.coverage[0]

  return (
    <View style={{ gap: SPACING.xl }}>
      <StateSection panelId={panelId} live={config.live} />

      {activeRow !== undefined ? (
        <SegmentedControl<AlarmArmMode>
          options={config.coverage.map((row) => ({
            value: row.mode,
            label: `${t(`v2.accessories.armMode.${row.mode}`)} ${rowsFor(row.mode, row).length}`,
          }))}
          value={activeRow.mode}
          onChange={setModeTab}
        />
      ) : null}
      {sensorsRetry !== null ? <SensorsFailedNote onRetry={sensorsRetry} /> : null}
      {alarmSwitch.notice !== null ? <SwitchNoticeLine notice={alarmSwitch.notice} /> : null}
      {activeRow === undefined ? null : (
      <ModeCard
        key={activeRow.mode}
        coverage={activeRow}
        live={config.live}
        options={optionsByMode.get(activeRow.mode) ?? { ids: [], unresolved: true }}
        openingsState={openingsState}
        onRetryOpenings={retryOpenings}
        nameOf={nameOf}
        rows={rowsFor(activeRow.mode, activeRow)}
        inFlight={alarmSwitch.inFlight}
        onSwitch={(r, kind, next) => alarmSwitch.press(activeRow.mode, r, kind, next)}
        zones={zones}
        delays={{
          exitDelaySec: modeDelayView(latest, edits, activeRow.mode, 'exitDelaySec'),
          entryDelaySec: modeDelayView(latest, edits, activeRow.mode, 'entryDelaySec'),
          triggeredDurationSec: modeDelayView(latest, edits, activeRow.mode, 'triggeredDurationSec'),
        }}
        onDelayType={(field, raw) => edit((prev) => typeModeDelay(prev, activeRow.mode, field, raw))}
        onDelayCommit={(field) => setEdits((prev) => commitModeDelay(prev, activeRow.mode, field))}
        onDelayDefault={(field) => edit((prev) => setModeDelayDefault(prev, activeRow.mode, field))}
        disabled={busy}
      />
      )}

      <DelaysSection
        values={view}
        raw={edits.delays}
        disabled={busy}
        onType={(field, raw) => edit((prev) => typeDelay(prev, field, raw))}
        onCommit={(field) => setEdits((prev) => commitDelay(prev, field))}
      />

      {refreshErrorText !== null ? (
        <AlarmNote
          text={t('v2.nc.alarm.refreshFailed', { error: refreshErrorText })}
          tone="danger"
          testID="alarm-refresh-failed"
        />
      ) : null}
      {changedElsewhere || mergedElsewhere ? <AlarmNote text={t('v2.nc.alarm.changedElsewhere')} tone="warning" testID="alarm-changed-elsewhere" /> : null}
      {saveError !== null ? (
        <AlarmNote text={t('v2.nc.alarm.saveFailed', { error: saveError })} tone="danger" />
      ) : null}
      {notLanded ? <AlarmNote text={t('v2.nc.alarm.saveNotLanded')} tone="danger" testID="alarm-save-not-landed" /> : null}
      {dirty ? <AlarmNote text={t('v2.nc.alarm.unsaved')} tone="warning" /> : null}
      <SaveBar
        dirty={dirty}
        discardable={draftVisiblyDiffers(latest, edits)}
        busy={busy}
        onSave={onSave}
        onDiscard={reset}
      />
    </View>
  )
}

interface SaveBarProps {
  /** A real edit: something to send. */
  readonly dirty: boolean
  /** Anything shown that differs from the stored settings (an emptied box too). */
  readonly discardable: boolean
  readonly busy: boolean
  readonly onSave: () => void
  readonly onDiscard: () => void
}

function SaveBar({ dirty, discardable, busy, onSave, onDiscard }: SaveBarProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <ConfirmFooter
      cancelLabel={t('v2.nc.alarm.discard')}
      onCancel={onDiscard}
      cancelDisabled={!discardable || busy}
      confirmLabel={t('v2.nc.alarm.save')}
      onConfirm={onSave}
      confirmDisabled={!dirty}
      busy={busy}
    />
  )
}
