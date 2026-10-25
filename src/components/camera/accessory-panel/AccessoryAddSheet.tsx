/**
 * AccessoryAddSheet — add devices to a camera's accessory panel, LOCALLY.
 *
 * ## What this is, and what it is not
 *
 * This is the viewer's "+" on the accessory panel. What it writes is the
 * operator's LOCAL additions (`accessory-prefs.ts`, in the camera-prefs
 * store) — never the hub's link set. The sheet that used to sit here wrote
 * `_linkedDeviceIds` through `applyDeviceSettingsPatch`; that made the viewer
 * a second authority over a set admin-ui owns, and it is gone. Because the
 * write is local and the catalogue read is a view procedure, the "+" is
 * offered to EVERY session, not only to admins.
 *
 * ## The offer (D356's ordering, kept)
 *
 * Same-location devices are SUGGESTED first, under their own heading; the
 * rest of the fleet answers a search. A container is never offered, its
 * children are, named after it — all of that is `data/linked-device-picker.ts`,
 * pure and unit-tested; this file decides nothing about it. Two things are
 * withheld on top: a device the hub ALREADY links to this camera (it is on
 * the panel; adding it again is a no-op the operator would read as broken),
 * and a device the panel would never draw (no actuating control — an
 * addition that produces nothing is the accept-then-drop branch D391 names).
 *
 * ## A session, like the pencil
 *
 * Opening seeds a DRAFT from the current additions; every tap moves the
 * draft; only ✓ writes. No confirmation on removal: a local addition is
 * reversible with one more tap, unlike the unlink the old sheet confirmed.
 *
 * The sheet itself — keyboard handling (padding on iOS, nothing on
 * Android/web; backdrop tap closes the keyboard before the sheet; no bottom
 * inset paid while the keyboard covers it), frame, header and search row — is
 * `ui/PickerSheet.tsx`, shared with the notification device picker (D636).
 * The operator's report "la tastiera copre la lista" is guarded in
 * `accessory-panel.spec.ts`.
 */
import React, { memo, useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Check, X } from '../../../lib/icons.js'
import { PickerSheet, PickerSheetButton } from '../../ui/PickerSheet.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { hapticTap } from '../../../lib/haptics.js'
import { SectionMultiselect } from '../../events/EventKindTree.js'
import {
  boundOptions,
  buildPickerGroups,
  filterPickerGroups,
  resolvePickedOptions,
  type PickerCandidate,
  type PickerGroups,
  type PickerOption,
} from '../../../data/linked-device-picker.js'
import { useDeviceCatalogue } from '../../../accessories/use-device-catalogue.js'
import { accessoryActuates } from '../../../accessories/use-accessory-panel.js'
import { KeyboardAwareScrollView } from '../../ui/KeyboardInset.js'

/**
 * How many catalogue matches are drawn at once. Sized against the live fleet:
 * the busiest room ("Hall", camera 104) suggests 53 devices out of 991, so
 * 50 would have truncated the SUGGESTIONS on a first open. 100 clears every
 * room on this hub and still bounds the search results. The cut is never
 * silent — `boundOptions` reports what it left out and the sheet says so.
 */
const MAX_RESULTS = 100

export interface AccessoryAddSheetProps {
  readonly deviceId: number
  readonly cameraName: string
  /** The camera's location — the room whose devices are suggested first. */
  readonly cameraLocation: string | null
  /** Ids the hub already links to this camera: on the panel, not offered. */
  readonly serverIds: readonly number[]
  /** The current local additions — the draft's seed. */
  readonly added: readonly number[]
  readonly onSave: (ids: readonly number[]) => void
  readonly onClose: () => void
}

/** Which candidates may be offered: not already on the panel, and drawable. */
function offerableIds(candidates: readonly PickerCandidate[], serverIds: readonly number[]): Set<number> {
  const server = new Set(serverIds)
  const out = new Set<number>()
  for (const c of candidates) {
    if (server.has(c.id)) continue
    if (!accessoryActuates({ ...c, online: true, features: c.features ?? [], role: null, displayIcon: null }))
      continue
    out.add(c.id)
  }
  return out
}

function keepOfferable(groups: PickerGroups, offerable: Set<number>): PickerGroups {
  return {
    suggested: groups.suggested.filter((o) => offerable.has(o.id)),
    others: groups.others.filter((o) => offerable.has(o.id)),
  }
}

export const AccessoryAddSheet = memo(function AccessoryAddSheet({
  deviceId,
  cameraName,
  cameraLocation,
  serverIds,
  added,
  onSave,
  onClose,
}: AccessoryAddSheetProps): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useTranslation()

  const catalogueQuery = useDeviceCatalogue(true)
  const [query, setQuery] = useState('')
  // Seeded from the LOCAL document, which is always known — no null state.
  const [draft, setDraft] = useState<readonly number[]>(added)

  const toggle = useCallback((id: number) => {
    hapticTap()
    setDraft((current) => (current.includes(id) ? current.filter((v) => v !== id) : [...current, id]))
  }, [])

  const candidates = catalogueQuery.data ?? null

  const groups = useMemo(() => {
    if (candidates === null) return null
    // The FULL catalogue goes into the picker so a container child is named
    // after its parent; what may be OFFERED is decided on the result.
    const built = buildPickerGroups(
      candidates,
      { excludeDeviceId: deviceId, excludeTypes: ['camera'] },
      cameraLocation,
    )
    return keepOfferable(built, offerableIds(candidates, serverIds))
  }, [candidates, deviceId, cameraLocation, serverIds])

  const searched = useMemo(
    () => (groups === null ? null : filterPickerGroups(groups, query)),
    [groups, query],
  )
  const draftSet = useMemo(() => new Set(draft), [draft])
  const pickedRows = useMemo(
    () => (candidates === null ? [] : resolvePickedOptions(candidates, draft)),
    [candidates, draft],
  )

  const typing = query.trim().length > 0
  const suggested = useMemo(() => boundOptions(searched?.suggested ?? [], MAX_RESULTS), [searched])
  const others = useMemo(
    () => boundOptions(typing ? (searched?.others ?? []) : [], MAX_RESULTS),
    [searched, typing],
  )

  const dirty = draft.length !== added.length || draft.some((id) => !added.includes(id))

  const handleSave = (): void => {
    onSave(draft)
    onClose()
  }

  const loaded = !catalogueQuery.isError && groups !== null
  return (
    <PickerSheet
      title={t('v2.accessoryPanel.addTitle')}
      subtitle={cameraName}
      onClose={onClose}
      headerRight={
        <>
          <PickerSheetButton onPress={onClose} label={t('v2.accessoryPanel.cancel')}>
            <X size={18} color={colors.foreground} />
          </PickerSheetButton>
          <PickerSheetButton
            onPress={handleSave}
            label={t('v2.accessoryPanel.save')}
            primary
            disabled={!dirty}
          >
            <Check size={18} color={colors.primaryForeground} />
          </PickerSheetButton>
        </>
      }
      {...(loaded
        ? {
            search: {
              value: query,
              onChange: setQuery,
              placeholder: t('v2.accessoryPanel.searchPlaceholder'),
            },
          }
        : {})}
    >
      {catalogueQuery.isError ? (
        <View style={styles.centered}>
          <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
            {t('v2.accessoryPanel.loadFailed')}
          </Text>
        </View>
      ) : groups === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
            {t('v2.accessoryPanel.addHint')}
          </Text>

          <SectionMultiselect
            title={t('v2.accessoryPanel.picked')}
            items={pickedRows.map((option) => toItem(option, true))}
            onToggle={(key) => toggle(Number(key))}
            emptyLabel={t('v2.accessoryPanel.pickedNone')}
          />

          {cameraLocation !== null ? (
            <>
              <SectionMultiselect
                title={t('v2.accessoryPanel.suggested', { location: cameraLocation })}
                items={suggested.shown.map((option) => toItem(option, draftSet.has(option.id)))}
                onToggle={(key) => toggle(Number(key))}
                emptyLabel={t('v2.accessoryPanel.suggestedNone')}
              />
              <Truncation hidden={suggested.hidden} />
            </>
          ) : null}

          <SectionMultiselect
            title={t('v2.accessoryPanel.allDevices')}
            items={others.shown.map((option) => toItem(option, draftSet.has(option.id)))}
            onToggle={(key) => toggle(Number(key))}
            emptyLabel={
              typing ? t('v2.accessoryPanel.noMatches') : t('v2.accessoryPanel.searchToSee')
            }
          />
          <Truncation hidden={others.hidden} />
        </KeyboardAwareScrollView>
      )}
    </PickerSheet>
  )
})

interface MultiselectRow {
  readonly key: string
  readonly label: string
  readonly selected: boolean
}

/** One picker option as a `SectionMultiselect` row. The description carries the
 *  container name, which is the whole reason a container child is tellable
 *  apart from its twin. */
function toItem(option: PickerOption, selected: boolean): MultiselectRow {
  return {
    key: String(option.id),
    label: option.description.length > 0 ? `${option.label} · ${option.description}` : option.label,
    selected,
  }
}

/** "There are more matches than this" — said out loud, or not said at all. */
const Truncation = memo(function Truncation({ hidden }: { readonly hidden: number }) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  if (hidden === 0) return null
  return (
    <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
      {t('v2.accessoryPanel.truncated', { count: hidden })}
    </Text>
  )
})

const styles = StyleSheet.create({
  body: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl, gap: SPACING.sm },
  centered: { paddingVertical: SPACING['2xl'] * 2, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 14, textAlign: 'center', paddingHorizontal: SPACING.xl },
  hint: { fontSize: 12, lineHeight: 17, paddingHorizontal: SPACING.sm },
})
