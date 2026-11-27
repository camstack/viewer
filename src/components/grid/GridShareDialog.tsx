/**
 * GridShareDialog — hands out a grid as a STANDALONE link, or as the Home
 * Assistant card for the same view (operator-approved layout, 2026-10-21).
 *
 * Opened from the grids-list per-card Share action and the grid runtime
 * toolbar's Share button. The dialog freezes a view configuration — quality,
 * layout, show-names, active-only, boxes, highlight triggers — seeded from the
 * grid's persisted settings, then shows the snippet:
 *
 *   Link   the embed URL (params in the query, the token in the `#t=`
 *          fragment, never the query), with a `{TOKEN}` placeholder until the
 *          token panel below resolves it: a token minted here for the grid's
 *          cameras replaces it; an existing token covering every camera keeps
 *          it (its secret is never shown again) with a note.
 *   Home Assistant   the `camstack-grid-card` YAML. It needs no token: the
 *          integration injects its own.
 *
 * Changing pickers here NEVER touches the grid's stored settings — the link is
 * a frozen snapshot.
 *
 * Seeding: the body is remounted per target grid (`key={grid.id}`) so every
 * `useState` initializer reads the grid's persisted settings — no
 * setState-in-effect re-seeding.
 */
import React, { useState } from 'react'
import { Platform, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Zap, Filter, Tag, SquareDashed } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import {
  resolveGridOptions,
  withHighlightDefaults,
  visibleGridCameraIds,
  type Grid,
  type GridHighlightSettings,
  type GridQuality,
} from '../../store/grid-store.js'
import { buildGridShareUrl, type GridShareParams, type ShareHighlight } from '../../grid-embed/share-url.js'
import { fillTokenPlaceholder, withTokenPlaceholder } from '../../data/account-tokens.js'
import { gridCardYaml } from '../../data/share-snippets.js'
import { useServer } from '../../app/ServerProvider.js'
import { useSettings } from '../../data/use-settings.js'
import {
  EMPTY_GRID_LOCAL,
  resolveGridLayout,
  resolveGridQuality,
  useGridLocalStore,
  type GridLocal,
} from '../../store/grid-local-store.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { SheetModal } from '../ui/SheetModal.js'
import { KeyboardAwareScrollView } from '../ui/KeyboardInset.js'
import { ShareTokenPanel, type ShareTokenChoice } from '../tokens/ShareTokenPanel.js'
import { ShareSnippet } from '../tokens/ShareSnippet.js'
import { PanelText } from '../../screens/settings/sign-in/form-parts.js'
import { HighlightTriggerRows, PanelToggleRow } from '../camera/HighlightTriggerRows.js'
import { QUALITY_ORDER, qualityLabelKey } from '../camera/stream-quality-labels.js'
import { Button } from '../ui/Button.js'

/** Layout choices as segmented-control string values ('auto' | column count). */
type LayoutChoice = 'auto' | '2' | '3' | '4'

/** What the snippet is: the embed link, or the Home Assistant card. */
type SnippetFormat = 'link' | 'ha'

interface GridShareDialogProps {
  /** The grid to share; the dialog is visible while non-null. */
  readonly grid: Grid | null
  /** This device's sound and tier for the grid. Omitted ⇒ read from
   *  `grid-local-store` by grid id; the ad-hoc wall passes its own, because it
   *  is held in screen state and never stored. */
  readonly local?: GridLocal
  readonly onClose: () => void
}

export function GridShareDialog({ grid, local, onClose }: GridShareDialogProps) {
  const { colors } = useTheme()
  return (
    <SheetModal
      visible={grid !== null}
      onClose={onClose}
      testID="grid-share-dialog"
      sheetStyle={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
    >
      {grid ? <ShareDialogBody key={grid.id} grid={grid} local={local} onClose={onClose} /> : null}
    </SheetModal>
  )
}

/** Modal body, remounted per grid so useState initializers do the seeding. */
interface ShareDialogBodyProps {
  readonly grid: Grid
  readonly local: GridLocal | undefined
  readonly onClose: () => void
}

function ShareDialogBody({ grid, local, onClose }: ShareDialogBodyProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { server } = useServer()
  const { settings } = useSettings()
  const serverUrl = server?.serverUrl ?? null

  const storedLocal = useGridLocalStore((s) => s.local.byId[grid.id])
  const gridLocal = local ?? storedLocal ?? EMPTY_GRID_LOCAL
  const seed = resolveGridOptions(grid.options, resolveGridLayout(gridLocal))

  // Share-time view snapshot, seeded from the grid's persisted settings.
  // Edits here never write back to the grid.
  const [quality, setQuality] = useState<GridQuality>(resolveGridQuality(gridLocal))
  const [layoutChoice, setLayoutChoice] = useState<LayoutChoice>(layoutToChoice(seed.layout))
  const [showName, setShowName] = useState(seed.showName)
  const [activeOnly, setActiveOnly] = useState(seed.activeOnly)
  // The share target is the hosted embed, which draws SURVIVORS only — it has
  // neither a discarded nor a parked layer. So the wall's set degrades to the
  // one boolean the link can carry, seeded from the layer that maps onto it.
  const [showBoxes, setShowBoxes] = useState(seed.layers.includes('objects'))
  const [highlightOn, setHighlightOn] = useState(seed.highlightOn)
  const [triggers, setTriggers] = useState<GridHighlightSettings>(() =>
    withHighlightDefaults(grid.highlight),
  )
  const [format, setFormat] = useState<SnippetFormat>('link')
  const [tokenChoice, setTokenChoice] = useState<ShareTokenChoice | null>(null)

  const devices = [...visibleGridCameraIds(grid)]
  const memberSet = new Set(devices)
  const audioOnIds = (gridLocal.audioOnIds ?? []).filter((id) => memberSet.has(id))

  // The tiers and their order come from the shared scale, and their names from
  // the shared label map — the same two the wall's bar and the single-camera
  // picker read. This dialog used to carry its own list, which is why it could
  // freeze a `medium` into a link nothing else in the system spelled.
  const qualityOptions: readonly SegmentOption<GridQuality>[] = QUALITY_ORDER.map((tier) => ({
    value: tier,
    label: t(qualityLabelKey(tier)),
  }))
  const layoutOptions: readonly SegmentOption<LayoutChoice>[] = [
    { value: 'auto', label: t('v2.gridShare.optionAuto') },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
  ]
  const formatOptions: readonly SegmentOption<SnippetFormat>[] = [
    { value: 'link', label: t('v2.gridShare.formatLink') },
    { value: 'ha', label: t('v2.gridShare.formatHa') },
  ]

  const highlight: ShareHighlight | undefined = highlightOn
    ? {
        enabled: true,
        motion: triggers.motion,
        audio: triggers.audio,
        audioDb: triggers.audioDb,
        audioHoldSec: triggers.audioHoldSec,
        detection: triggers.detection,
        detectionHoldSec: triggers.detectionHoldSec,
        detectionClasses: [...triggers.detectionClasses],
        appearance: { ...settings.highlight },
      }
    : undefined
  const params: GridShareParams = {
    devices,
    layout: choiceToLayout(layoutChoice),
    quality,
    showName,
    ...(audioOnIds.length > 0 ? { audioOnIds } : {}),
    ...(activeOnly ? { activeOnly: true } : {}),
    ...(showBoxes ? { boxes: true } : {}),
    ...(highlight !== undefined ? { highlight } : {}),
  }
  const linkTemplate =
    serverUrl === null || devices.length === 0
      ? null
      : withTokenPlaceholder((token) => buildGridShareUrl(serverUrl, params, token))
  const snippet =
    format === 'ha'
      ? devices.length === 0
        ? null
        : gridCardYaml(grid.name, params)
      : linkTemplate === null
        ? null
        : tokenChoice?.kind === 'minted'
          ? fillTokenPlaceholder(linkTemplate, tokenChoice.token)
          : linkTemplate

  return (
    <KeyboardAwareScrollView contentContainerStyle={{ gap: SPACING.md }}>
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '700' }}>
        {t('v2.gridShare.title', { name: grid.name })}
      </Text>

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.gridShare.quality')}
          </Text>
          <SegmentedControl options={qualityOptions} value={quality} onChange={setQuality} />

          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
            {t('v2.gridShare.layout')}
          </Text>
          <SegmentedControl options={layoutOptions} value={layoutChoice} onChange={setLayoutChoice} />

          <PanelToggleRow
            icon={Tag}
            label={t('v2.gridShare.showNames')}
            value={showName}
            onValueChange={() => setShowName((v) => !v)}
          />
          <PanelToggleRow
            icon={Filter}
            label={t('v2.gridShare.activeOnly')}
            value={activeOnly}
            onValueChange={() => setActiveOnly((v) => !v)}
          />
          <PanelToggleRow
            icon={SquareDashed}
            label={t('v2.gridShare.boxes')}
            value={showBoxes}
            onValueChange={() => setShowBoxes((v) => !v)}
          />
          <PanelToggleRow
            icon={Zap}
            label={t('v2.gridShare.highlightEnable')}
            value={highlightOn}
            onValueChange={() => setHighlightOn((v) => !v)}
          />
          {/* The triggers only: the timeline-label row is not offered here —
              neither the link nor the Home Assistant card mounts a timeline,
              so it would change nothing in the snippet. */}
          {highlightOn ? (
            <HighlightTriggerRows
              highlight={triggers}
              onSetHighlight={(patch) => setTriggers((cur) => ({ ...cur, ...patch }))}
            />
          ) : null}

          {audioOnIds.length > 0 ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              {t('v2.gridShare.audioSummary', { count: audioOnIds.length })}
            </Text>
          ) : null}

      <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>{t('v2.gridShare.format')}</Text>
      <SegmentedControl options={formatOptions} value={format} onChange={setFormat} />

      {snippet === null ? (
        <PanelText tone="danger">{t('v2.gridShare.nothingToShare')}</PanelText>
      ) : (
        <ShareSnippet snippet={snippet} title={grid.name} canShare={Platform.OS !== 'web'} />
      )}

      {format === 'ha' ? (
        <PanelText>{t('v2.gridShare.haNotice')}</PanelText>
      ) : devices.length > 0 ? (
        <ShareTokenPanel
          kind="grid-view"
          deviceIds={devices}
          defaultLabel={grid.name}
          choice={tokenChoice}
          onChoice={setTokenChoice}
        />
      ) : null}

      <Button label={t('v2.tokens.done')} kind="secondary" onPress={onClose} testID="grid-share-close" />
    </KeyboardAwareScrollView>
  )
}

function layoutToChoice(layout: 'auto' | number): LayoutChoice {
  if (layout === 2) return '2'
  if (layout === 3) return '3'
  if (layout === 4) return '4'
  return 'auto'
}

function choiceToLayout(choice: LayoutChoice): 'auto' | number {
  return choice === 'auto' ? 'auto' : Number(choice)
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    borderWidth: 1,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
  },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
})
