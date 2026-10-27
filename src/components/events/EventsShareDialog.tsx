/**
 * EventsShareDialog — the URL builder for the events embed, and the Home
 * Assistant card for the same view.
 *
 * Mirrors `GridShareDialog`: pick what the link freezes, then the snippet —
 * the embed URL with the params in the query and a `{TOKEN}` placeholder in
 * the `#t=` fragment, which the token panel below resolves (a token minted
 * here for the link's cameras replaces it; an existing one covering every
 * camera keeps it, with a note), or the `camstack-events-card` YAML, which
 * needs no token because the integration injects its own.
 *
 * The token is an `events-view` share grant, NOT the grid's: the two are
 * deliberately disjoint — an events link cannot open a WebRTC session and a
 * grid link cannot read a track — and it is scoped to the SELECTED cameras,
 * or to all of them when the link says "every camera": never broader than the
 * view it froze.
 */
import React, { useMemo, useState } from 'react'
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { SheetModal } from '../ui/SheetModal.js'
import { KeyboardAwareScrollView } from '../ui/KeyboardInset.js'
import { ShareTokenPanel, type ShareTokenChoice } from '../tokens/ShareTokenPanel.js'
import { ShareSnippet } from '../tokens/ShareSnippet.js'
import { PanelText } from '../../screens/settings/sign-in/form-parts.js'
import { fillTokenPlaceholder, withTokenPlaceholder } from '../../data/account-tokens.js'
import { eventsCardYaml } from '../../data/share-snippets.js'
import { useServer } from '../../app/ServerProvider.js'
import { useCameras } from '../../data/use-cameras.js'
import { useSettings } from '../../data/use-settings.js'
import { deviceNamesFromCameras, pickDeviceNames } from '../../events/device-names.js'
import {
  buildEventsShareUrl,
  EVENTS_FIELD_KEYS,
  DEFAULT_EVENTS_FIELDS,
  type EventsColumns,
  type EventsFields,
  type EventsShareParams,
  type EventsTheme,
  type EventsThumb,
  type EventsView,
} from '../../../shared/events/events-share-url.js'
import { TILE_LABEL_MODES, type TileLabelMode } from '../../../shared/events/events-tile-display.js'
import { Button } from '../ui/Button.js'

export interface EventsShareDialogProps {
  readonly visible: boolean
  readonly onClose: () => void
}

/** Gallery column choices offered by the picker. */
type ColumnChoice = 'auto' | '2' | '3' | '4'
/** Reel row choices offered by the picker. */
type RowChoice = '1' | '2' | '3'
/** What the snippet is: the embed link, or the Home Assistant card. */
type SnippetFormat = 'link' | 'ha'

const LABEL_MODE_KEY: Readonly<Record<TileLabelMode, string>> = {
  off: 'v2.settings.tileLabelModeOff',
  icon: 'v2.settings.tileLabelModeIcon',
  label: 'v2.settings.tileLabelModeLabel',
}
/** The legacy text switches that are NOT the viewer's tile settings. */
const LINK_FIELD_KEYS: readonly (keyof EventsFields)[] = EVENTS_FIELD_KEYS.filter(
  (key) => key === 'time' || key === 'importance',
)

export function EventsShareDialog({ visible, onClose }: EventsShareDialogProps) {
  const { colors } = useTheme()
  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      testID="events-share-dialog"
      sheetStyle={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
    >
      {visible ? <EventsShareBody onClose={onClose} /> : null}
    </SheetModal>
  )
}

function EventsShareBody({ onClose }: { readonly onClose: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { server } = useServer()
  const { data: cameras } = useCameras()
  const serverUrl = server?.serverUrl ?? null

  const [view, setView] = useState<EventsView>('gallery')
  const [columnChoice, setColumnChoice] = useState<ColumnChoice>('auto')
  const [rowChoice, setRowChoice] = useState<RowChoice>('2')
  const [thumb, setThumb] = useState<EventsThumb>('medium')
  const [theme, setTheme] = useState<EventsTheme>('auto')
  const { settings } = useSettings()
  const [fields, setFields] = useState<EventsFields>(DEFAULT_EVENTS_FIELDS)
  // The link starts from the operator's OWN tile settings — the same three the
  // Events page's eye menu edits — so what they see is what the link renders.
  const [tileLabelMode, setTileLabelMode] = useState<TileLabelMode>(settings.events.tileLabelMode)
  const [tileDetailCamera, setTileDetailCamera] = useState<boolean>(settings.events.tileDetailCamera)
  const [tileDetailZone, setTileDetailZone] = useState<boolean>(settings.events.tileDetailZone)
  const [deviceIds, setDeviceIds] = useState<readonly number[]>([])
  const [format, setFormat] = useState<SnippetFormat>('link')
  const [tokenChoice, setTokenChoice] = useState<ShareTokenChoice | null>(null)

  const cameraList = useMemo(
    () => (cameras ?? []).map((c) => ({ id: c.id, name: c.name })),
    [cameras],
  )
  // The operator's own labels travel WITH the link, narrowed to the cameras it
  // actually shows: these are private names, and a link goes to someone else.
  // The recipient's hub does not know them — they are client-side here.
  const deviceNames = useMemo(
    () => pickDeviceNames(deviceNamesFromCameras(cameras ?? []), deviceIds),
    [cameras, deviceIds],
  )

  const params: EventsShareParams = useMemo(
    () => ({
      view,
      ...(view === 'reel' ? { rows: Number(rowChoice) } : {}),
      ...(view === 'gallery'
        ? { columns: (columnChoice === 'auto' ? 'auto' : Number(columnChoice)) as EventsColumns }
        : {}),
      thumb,
      deviceIds: [...deviceIds],
      fields,
      tileLabelMode,
      tileDetailCamera,
      tileDetailZone,
      deviceNames,
      theme,
    }),
    [view, rowChoice, columnChoice, thumb, deviceIds, fields, tileLabelMode, tileDetailCamera, tileDetailZone, deviceNames, theme],
  )

  // The token the link is scoped to: the selected cameras, or every camera.
  const scoped = deviceIds.length > 0 ? [...deviceIds] : cameraList.map((c) => c.id)
  const linkTemplate =
    serverUrl === null ? null : withTokenPlaceholder((token) => buildEventsShareUrl(serverUrl, params, token))
  const snippet =
    format === 'ha'
      ? eventsCardYaml(params)
      : linkTemplate === null
        ? null
        : tokenChoice?.kind === 'minted'
          ? fillTokenPlaceholder(linkTemplate, tokenChoice.token)
          : linkTemplate

  const toggleField = (key: keyof EventsFields): void => {
    setFields((cur) => ({ ...cur, [key]: !cur[key] }))
  }
  const toggleCamera = (id: number): void => {
    setDeviceIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
    // A token picked or minted for the old camera set may not cover the new one.
    setTokenChoice(null)
  }

  const viewOptions: readonly SegmentOption<EventsView>[] = [
    { value: 'reel', label: t('v2.eventsShare.viewReel') },
    { value: 'gallery', label: t('v2.eventsShare.viewGallery') },
  ]
  const labelModeOptions: readonly SegmentOption<TileLabelMode>[] = TILE_LABEL_MODES.map((m) => ({
    value: m,
    label: t(LABEL_MODE_KEY[m]),
  }))
  const thumbOptions: readonly SegmentOption<EventsThumb>[] = [
    { value: 'small', label: t('v2.eventsShare.thumbSmall') },
    { value: 'medium', label: t('v2.eventsShare.thumbMedium') },
    { value: 'large', label: t('v2.eventsShare.thumbLarge') },
  ]
  const themeOptions: readonly SegmentOption<EventsTheme>[] = [
    { value: 'auto', label: t('v2.eventsShare.themeAuto') },
    { value: 'dark', label: t('v2.eventsShare.themeDark') },
    { value: 'light', label: t('v2.eventsShare.themeLight') },
  ]
  const columnOptions: readonly SegmentOption<ColumnChoice>[] = [
    { value: 'auto', label: t('v2.eventsShare.auto') },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
  ]
  const rowOptions: readonly SegmentOption<RowChoice>[] = [
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
  ]
  const formatOptions: readonly SegmentOption<SnippetFormat>[] = [
    { value: 'link', label: t('v2.gridShare.formatLink') },
    { value: 'ha', label: t('v2.gridShare.formatHa') },
  ]

  return (
    <KeyboardAwareScrollView contentContainerStyle={{ gap: SPACING.md }}>
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '700' }}>
        {t('v2.eventsShare.title')}
      </Text>

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.eventsShare.view')}
          </Text>
          <SegmentedControl options={viewOptions} value={view} onChange={setView} />

          {view === 'gallery' ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
                {t('v2.eventsShare.columns')}
              </Text>
              <SegmentedControl
                options={columnOptions}
                value={columnChoice}
                onChange={setColumnChoice}
              />
            </>
          ) : (
            <>
              <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
                {t('v2.eventsShare.rows')}
              </Text>
              <SegmentedControl options={rowOptions} value={rowChoice} onChange={setRowChoice} />
            </>
          )}

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.eventsShare.thumb')}
          </Text>
          <SegmentedControl options={thumbOptions} value={thumb} onChange={setThumb} />

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.eventsShare.theme')}
          </Text>
          <SegmentedControl options={themeOptions} value={theme} onChange={setTheme} />

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.settings.tileLabelMode')}
          </Text>
          <SegmentedControl options={labelModeOptions} value={tileLabelMode} onChange={setTileLabelMode} />

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.settings.tileDetailsSection')}
          </Text>
          <View style={styles.chipWrap}>
            {[
              { id: 'camera', on: tileDetailCamera, set: setTileDetailCamera, label: t('v2.library.showCamera') },
              { id: 'zone', on: tileDetailZone, set: setTileDetailZone, label: t('v2.library.showZone') },
            ].map(({ id, on, set, label }) => (
              <Pressable
                key={id}
                onPress={() => set(!on)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface }]}
              >
                <Text style={[styles.chipText, { color: on ? colors.primaryForeground : colors.foregroundMuted }]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.eventsShare.fields')}
          </Text>
          <View style={styles.chipWrap}>
            {LINK_FIELD_KEYS.map((key) => {
              const on = fields[key]
              return (
                <Pressable
                  key={key}
                  onPress={() => toggleField(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.chip,
                    { backgroundColor: on ? colors.primary : colors.surface },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: on ? colors.primaryForeground : colors.foregroundMuted },
                    ]}
                  >
                    {t(`v2.eventsShare.field_${key}`)}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.eventsShare.cameras')}
          </Text>
          <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
            {deviceIds.length === 0
              ? t('v2.eventsShare.camerasAll')
              : t('v2.eventsShare.camerasCount', { count: deviceIds.length })}
          </Text>
          <View style={styles.chipWrap}>
            {cameraList.map((cam) => {
              const on = deviceIds.includes(cam.id)
              return (
                <Pressable
                  key={cam.id}
                  onPress={() => toggleCamera(cam.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface }]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: on ? colors.primaryForeground : colors.foregroundMuted },
                    ]}
                    numberOfLines={1}
                  >
                    {cam.name}
                  </Text>
                </Pressable>
              )
            })}
          </View>

      <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>{t('v2.gridShare.format')}</Text>
      <SegmentedControl options={formatOptions} value={format} onChange={setFormat} />

      {snippet === null ? (
        <PanelText tone="danger">{t('v2.gridShare.nothingToShare')}</PanelText>
      ) : (
        <ShareSnippet snippet={snippet} title={t('v2.eventsShare.title')} canShare={Platform.OS !== 'web'} />
      )}

          {/* Only when the link is narrowed: the CLIP query runs across every
              camera and is cut to the scope AFTERWARDS, so a few-camera link on
              a large cluster can spend its result budget elsewhere and come
              back sparse. Honest, and not a reason to block the link. */}
          {deviceIds.length > 0 ? (
            <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
              {t('v2.eventsShare.semanticScopeNotice')}
            </Text>
          ) : null}
      {format === 'ha' ? (
        <PanelText>{t('v2.gridShare.haNotice')}</PanelText>
      ) : scoped.length > 0 ? (
        <ShareTokenPanel
          kind="events-view"
          deviceIds={scoped}
          defaultLabel={t('v2.eventsShare.title')}
          choice={tokenChoice}
          onChoice={setTokenChoice}
        />
      ) : null}

      <Button label={t('v2.tokens.done')} kind="secondary" onPress={onClose} testID="events-share-close" />
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    maxHeight: '90%',
    maxWidth: 480,
    padding: SPACING.xl,
    width: '100%',
  },
  chip: {
    borderRadius: RADIUS.lg,
    maxWidth: 180,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
})
