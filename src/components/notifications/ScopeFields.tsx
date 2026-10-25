/**
 * The rule editor's scope axes as ONE field each (D641), all over
 * {@link RuleScopeField} — "the SAME control as Object classes" (operator,
 * 2026-10-01: one selection list, each item included or excluded, never both):
 *
 *  - {@link DeviceScopeField} — `devices` (Only) / `devicesExclude` (Except),
 *    the `DevicePicker` over the list the rule's KIND can target
 *    (`rule-device-source.ts`: cameras, or a sensor rule's sensors) with
 *    "Group by".
 *  - {@link ClassScopeField} — `classes` (Only) / `classesExclude` (Except),
 *    an `ItemPicker<string>` over the SHARED class taxonomy
 *    (`classPickerItems`, sounds left out), grouped by taxonomy category and
 *    with no "Group by" (the groups ARE the categories). A stored class the
 *    taxonomy does not list stays a removable chip, marked as such (D49). A
 *    hub with no taxonomy keeps the free-text input.
 *  - {@link ZoneScopeField} — `zones` / `zonesExclude`, every zone of the
 *    rule's cameras (all cameras while the device scope is All) named
 *    `camera:zone` and grouped by camera, in BOTH modes.
 *  - {@link IdentityScopeField} — `identities` / `identitiesExclude` over the
 *    face gallery (ids stored, names shown). An Only list left empty is "any
 *    known face" and says so; it never widens to everybody.
 *  - {@link LabelScopeField} — `labelEquals`, free text (Only: the hub has no
 *    label exclusion).
 *
 * A notice names an id through the list the picker already holds; an id no
 * answer names reads "Device #id", never "removed" (D315).
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCameras } from '../../data/use-cameras.js'
import { useDevicesByIds } from '../../data/use-devices-by-ids.js'
import { useIdentities } from '../../data/use-face-gallery.js'
import { useCameraZoneLists } from '../../data/use-zones.js'
import { zonePickerItems } from '../../data/zone-choices.js'
import type { NcTaxonomy } from '../../data/notification-center.js'
import { TagsInput } from './ConditionField.js'
import { DevicePicker, type DevicePickerSource } from './DevicePicker.js'
import type { PickerGroup } from './device-picker-model.js'
import { deviceListStateOf, offListSelections } from './device-selection.js'
import { ItemPicker } from './ItemPicker.js'
import { classPickerItems } from './rule-scope-form.js'
import { ruleScopeList, type RuleScopeDraft } from './rule-scope-model.js'
import { RuleScopeField } from './RuleScopeField.js'
import type { RuleDeviceSource } from './rule-device-source.js'

const SCOPE = 'v2.nc.rules.scope'

/** A camera rule's device scope picks among cameras (hidden ones included). */
const CAMERAS_SOURCE: RuleDeviceSource = { kind: 'cameras' }

/** One scope axis as the editor binds it. */
export interface RuleScopeBinding<Id extends number | string> {
  readonly draft: RuleScopeDraft<Id>
  readonly onChange: (next: RuleScopeDraft<Id>) => void
  /** The hub serves the exclusion for this rule's trigger and kind. */
  readonly exceptOffered: boolean
  /** The SAVED rule had ids on this axis — the widening warning survives a remount. */
  readonly savedHad?: boolean
}

/** The device axis as the editor binds it: the draft, and the list its kind offers. */
export interface DeviceScopeBinding extends RuleScopeBinding<number> {
  /** Where the picker's list comes from; absent = the camera list. */
  readonly source?: RuleDeviceSource
}

/**
 * The names the scope notices use: the camera list for a camera rule; for a
 * sensor rule, a TARGETED read of just the ids its two lists hold (never the
 * fleet). An id neither names reads "Device #id" (D315).
 */
function useScopeNames(source: RuleDeviceSource, draft: RuleScopeDraft<number>): ReadonlyMap<number, string> {
  const cameras = useCameras({ includeHidden: true })
  const byIds = useDevicesByIds(source.kind === 'caps' ? [...draft.include, ...draft.exclude] : [])
  return useMemo(
    () =>
      new Map(
        (source.kind === 'caps' ? (byIds.data ?? []) : (cameras.data ?? [])).map((row) => [row.id, row.name]),
      ),
    [source.kind, byIds.data, cameras.data],
  )
}

export function DeviceScopeField({
  draft,
  onChange,
  exceptOffered,
  savedHad = false,
  source = CAMERAS_SOURCE,
}: DeviceScopeBinding): React.JSX.Element {
  const { t } = useTranslation()
  const names = useScopeNames(source, draft)
  const pickerSource: DevicePickerSource = source
  return (
    <RuleScopeField<number>
      draft={draft}
      onChange={onChange}
      exceptOffered={exceptOffered}
      everyLabel={t(
        source.kind === 'caps' && source.subject === 'sensor'
          ? `${SCOPE}.everySensor`
          : `${SCOPE}.everyDevice`,
      )}
      describe={(id) => names.get(id) ?? t('v2.nc.rules.editor.deviceUnknown', { id })}
      testID="rule-device-scope"
      renderPicker={(value, change) => (
        <DevicePicker
          source={pickerSource}
          value={value}
          emptyMeansAll
          savedHadDevices={savedHad}
          onChange={change}
        />
      )}
    />
  )
}

export interface ClassScopeFieldProps extends RuleScopeBinding<string> {
  readonly taxonomy: NcTaxonomy | undefined
}

export function ClassScopeField({
  draft,
  onChange,
  exceptOffered,
  savedHad = false,
  taxonomy,
}: ClassScopeFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const picker = useMemo(() => classPickerItems(taxonomy), [taxonomy])
  const labels = useMemo(
    () => new Map((picker?.items ?? []).map((item) => [item.id, item.name])),
    [picker],
  )
  const groupTitle = (group: PickerGroup<string>): string => {
    const key = group.type ?? ''
    return t(`v2.nc.rules.editor.taxonomy.${key}`, {
      defaultValue: picker?.groupLabels.get(key) ?? t('v2.nc.rules.editor.taxonomy.custom'),
    })
  }
  return (
    <RuleScopeField<string>
      draft={draft}
      onChange={onChange}
      exceptOffered={exceptOffered}
      everyLabel={t(`${SCOPE}.everyClass`)}
      describe={(id) => labels.get(id) ?? id}
      testID="rule-class-scope"
      renderPicker={(value, change) =>
        picker === null ? (
          <TagsInput value={value} onChange={change} />
        ) : (
          <ItemPicker<string>
            items={picker.items}
            state="answered"
            // The taxonomy ANSWERED: a stored class it lacks is said so, and
            // stays a removable chip (D49).
            judged={offListSelections(value, picker.items, picker.items, 'answered')}
            value={value}
            onChange={change}
            emptyMeansAll
            savedHadDevices={savedHad}
            emptyLabel={t(`${SCOPE}.everyClass`)}
            title={t(`${SCOPE}.classTitle`)}
            widensLabel={t(`${SCOPE}.classesEmptyWidens`)}
            unavailableLabel={t(`${SCOPE}.classesUnavailable`)}
            searchLabel={t(`${SCOPE}.classSearch`)}
            noMatchesLabel={t(`${SCOPE}.classNoMatches`)}
            removedLabel={(id) => t(`${SCOPE}.classNotListed`, { name: id })}
            unknownLabel={(id) => id}
            groupTitle={groupTitle}
            testID="class-picker"
          />
        )
      }
    />
  )
}

/** The zone field also reads the device scope: its cameras are the zones' cameras. */
export interface ZoneScopeFieldProps extends RuleScopeBinding<string> {
  readonly deviceScope: RuleScopeDraft<number>
}

/**
 * The cameras whose zones the picker lists: an Only device scope's cameras;
 * otherwise every camera, minus an Except list's (their zones can never
 * match). Pure, so the choice is pinned in a spec.
 */
export function zoneScopeCameraIds(
  deviceScope: RuleScopeDraft<number>,
  allCameraIds: readonly number[],
): readonly number[] {
  const listed = ruleScopeList(deviceScope)
  if (deviceScope.mode === 'only' && listed.length > 0) return listed
  if (deviceScope.mode === 'except') return allCameraIds.filter((id) => !listed.includes(id))
  return allCameraIds
}

export function ZoneScopeField({
  draft,
  onChange,
  exceptOffered,
  savedHad = false,
  deviceScope,
}: ZoneScopeFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const cameras = useCameras({ includeHidden: true })
  const cameraIds = useMemo(
    () => zoneScopeCameraIds(deviceScope, (cameras.data ?? []).map((cam) => cam.id)),
    [deviceScope, cameras.data],
  )
  const cameraNames = useMemo(
    () => new Map((cameras.data ?? []).map((cam) => [cam.id, cam.name])),
    [cameras.data],
  )
  // Read only while a list mode is shown — All draws no picker.
  const lists = useCameraZoneLists(cameraIds, draft.mode !== 'all')
  // No camera to read (an answered empty camera list, or every camera
  // excluded) is an answered empty zone list — the query never runs for it.
  const noCameras = cameras.data !== undefined && cameraIds.length === 0
  const items = useMemo(
    () =>
      lists.data !== undefined ? zonePickerItems(lists.data, cameraNames) : noCameras ? [] : undefined,
    [lists.data, cameraNames, noCameras],
  )
  const state = cameras.isError ? 'failed' : deviceListStateOf({ data: items, isError: lists.isError })
  const names = useMemo(() => new Map((items ?? []).map((item) => [item.id, item.name])), [items])
  return (
    <RuleScopeField<string>
      draft={draft}
      onChange={onChange}
      exceptOffered={exceptOffered}
      everyLabel={t(`${SCOPE}.everyZone`)}
      describe={(id) => names.get(id) ?? id}
      testID="rule-zone-scope"
      renderPicker={(value, change) => (
        <ItemPicker<string>
          items={items}
          state={state}
          judged={offListSelections(value, items, items, state)}
          value={value}
          onChange={change}
          emptyMeansAll
          savedHadDevices={savedHad}
          emptyLabel={t(`${SCOPE}.everyZone`)}
          title={t(`${SCOPE}.zoneTitle`)}
          widensLabel={t(`${SCOPE}.zonesEmptyWidens`)}
          unavailableLabel={t(`${SCOPE}.zonesUnavailable`)}
          searchLabel={t(`${SCOPE}.zoneSearch`)}
          noMatchesLabel={t(`${SCOPE}.zoneNoMatches`)}
          removedLabel={(id) => t(`${SCOPE}.zoneNotListed`, { name: id })}
          unknownLabel={(id) => id}
          groupTitle={(group) => group.type ?? ''}
          testID="zone-picker"
        />
      )}
    />
  )
}

export function IdentityScopeField({
  draft,
  onChange,
  exceptOffered,
}: RuleScopeBinding<string>): React.JSX.Element {
  const { t } = useTranslation()
  // The gallery is read only while a list mode is shown.
  const gallery = useIdentities(draft.mode !== 'all')
  const items = useMemo(
    () => gallery.data?.map((person) => ({ id: person.id, name: person.name })),
    [gallery.data],
  )
  const state = deviceListStateOf({ data: items, isError: gallery.isError })
  const names = useMemo(() => new Map((items ?? []).map((item) => [item.id, item.name])), [items])
  return (
    <RuleScopeField<string>
      draft={draft}
      onChange={onChange}
      exceptOffered={exceptOffered}
      everyLabel={t(`${SCOPE}.everyPerson`)}
      describe={(id) => names.get(id) ?? id}
      testID="rule-identity-scope"
      renderPicker={(value, change, mode) => (
        <ItemPicker<string>
          items={items}
          state={state}
          judged={offListSelections(value, items, items, state)}
          value={value}
          onChange={change}
          // Only + nobody picked is "any known face" — a narrowing, never a
          // widening to everybody, so no widening warning either.
          emptyMeansAll={mode === 'except'}
          emptyLabel={t(mode === 'only' ? `${SCOPE}.anyKnownFace` : `${SCOPE}.noFaceExcluded`)}
          title={t(`${SCOPE}.faceTitle`)}
          unavailableLabel={t(`${SCOPE}.facesUnavailable`)}
          searchLabel={t(`${SCOPE}.faceSearch`)}
          noMatchesLabel={t(`${SCOPE}.faceNoMatches`)}
          removedLabel={(id) => t(`${SCOPE}.faceNotListed`, { name: id })}
          unknownLabel={(id) => id}
          groupTitle={() => t(`${SCOPE}.faceTitle`)}
          testID="face-picker"
        />
      )}
    />
  )
}

export function LabelScopeField({
  draft,
  onChange,
  exceptOffered,
}: RuleScopeBinding<string>): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <RuleScopeField<string>
      draft={draft}
      onChange={onChange}
      exceptOffered={exceptOffered}
      everyLabel={t(`${SCOPE}.everyLabel`)}
      describe={(id) => id}
      testID="rule-label-scope"
      renderPicker={(value, change) => <TagsInput value={value} onChange={change} />}
    />
  )
}
