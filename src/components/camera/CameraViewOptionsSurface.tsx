/**
 * CameraViewOptionsSurface — the per-camera configuration menu, WITHOUT a host.
 *
 * This is the body that used to be `TimelineViewOptionsPanel`'s. It was pulled
 * out on 2026-08-13 when a GRID CELL became the menu's second host: the
 * operator's requirement is one configuration surface with two hosts, not two
 * menus that happen to look alike — "a section added to the menu shows up in
 * both places" is the property being protected, and a copy loses it on the
 * first edit that only reaches one file.
 *
 * The split is strictly HOST vs CONTENT. The frame (title, close, scroll) is
 * the host's — `TimelinePanelHost` in the theater, the same host inside a card
 * over the wall in the grid. Everything below is here.
 *
 * What lives here is PER-CAMERA configuration only:
 *   • Everything drawn ON the picture — the overlay sections, inline.
 *   • Cluster-card label mode (per-camera).
 *   • The management entries, WHEN the host can route them.
 *
 * NOT here (since 2026-09-22): the per-camera function switches (D62). They
 * used to be mounted at the bottom of this menu AND in the cameras-list
 * sheet — two homes for one group. They now live in `CameraAccessoryPanel`,
 * the one composition every host mounts (the theater's linked-devices panel,
 * the wall's cell overlay, the cameras-list sheet), next to the linked
 * devices they act on.
 *
 * ## …and in a GRID CELL, less than that
 *
 * The wall has a menu of its own, and it had the same rows: the border
 * highlight, its triggers, the box scale and the cluster label were offered
 * BOTH by the control bar (writing the grid's document) and by this surface
 * (writing the camera's prefs). One picture, two controls, two documents —
 * whichever the operator touched last was the one that looked broken.
 *
 * So the surface takes a CONTEXT. In `'grid-cell'` it drops every row the grid
 * owns grid-wide plus every row no tile paints; in `'single'` it is complete, as
 * it always was. Which row is which is NOT decided here — it is
 * `grid/view-options-scope`, the same list `GridMenuPanel` renders from, so the
 * two menus cannot grow a row in common again.
 *
 * The management entries are the one host-conditional part, and they are
 * navigation rather than configuration: they hand the body on to a SIBLING
 * panel (storage, event store). A host with nowhere to hand it to omits the
 * openers and the rows are not drawn — the alternative, a row that opens
 * nothing, is the "dead button" the message contract on the other side of this
 * feature explicitly rejects.
 *
 * The GLOBAL timeline presentation — density presets, importance/class badges —
 * is edited in Settings → Timeline, not here: those write `settings.clusters`,
 * one document read by every camera, and a global value edited inside one
 * camera's panel reads as per-camera and is not.
 *
 * Presentational: every value + writer arrives from `useCameraViewOptions`,
 * which is what makes the two hosts edit the same document.
 */
import React from 'react'
import { Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { HardDrive, ListTree, HelpCircle, ChevronRight } from '../../lib/icons.js'
import type { LucideIcon } from '../../lib/icons.js'

import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { ClusterLabelRow } from './HighlightTriggerRows.js'
import { ClipSourceRow } from './ClipSourceRow.js'
import { RecordingSourceRow } from './RecordingSourceRow.js'
import { OverlaySettingsSections } from './theater/TimelineOverlayPanel.js'
import type { CameraOverlayConfig } from './overlay/overlay-config.js'
import type { GridHighlightSettings } from '../../store/grid-store.js'
import { useCanDelete } from '../../hooks/use-user-scope.js'
import {
  GROUP_HEADER_KEY,
  isRowVisible,
  type ViewOptionsContext,
} from '../../grid/view-options-scope.js'

export interface CameraViewOptionsSurfaceProps {
  /** The camera this surface is configuring — the switch group's target. */
  readonly deviceId: number
  /** WHERE the surface is mounted. Required, with no default: a new host that
   *  forgets it would silently get the complete menu, which is exactly the
   *  duplication this prop exists to end. */
  readonly context: ViewOptionsContext
  /** The per-camera overlay document + its writer — edited by the inline
   *  overlay sections. */
  readonly overlayConfig: CameraOverlayConfig
  readonly onChangeOverlay: (next: CameraOverlayConfig) => void
  /** Per-camera highlight settings + patcher. The border triggers are edited
   *  by the inline overlay sections; the `clusterLabel` member by this
   *  surface's own timeline section. One document, one patcher, two sections. */
  readonly highlight: GridHighlightSettings
  readonly onSetHighlight: (patch: Partial<GridHighlightSettings>) => void
  /** Hand the body to the recordings-storage panel. Omitted by hosts that have
   *  no sibling panel to hand it to (the grid cell). */
  readonly onOpenStorage?: () => void
  /** Hand the body to the event-store panel. Omitted as above. */
  readonly onOpenEventStore?: () => void
  /** Hand the body to the timeline legend panel. Omitted where there is no
   *  timeline body (the grid cell) — the row is then not rendered. */
  readonly onOpenLegend?: () => void
}

export function CameraViewOptionsSurface({
  deviceId,
  context,
  overlayConfig,
  onChangeOverlay,
  highlight,
  onSetHighlight,
  onOpenStorage,
  onOpenEventStore,
  onOpenLegend,
}: CameraViewOptionsSurfaceProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const canDelete = useCanDelete()

  return (
    <>
      {/* Say WHERE the missing rows went. A menu that is simply shorter here
          reads as a menu missing something; the wall's own menu is one tap
          away, and it is the only place those rows now live. */}
      {context === 'grid-cell' ? (
        <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
          {t('v2.cameraMenu.gridCommonHint')}
        </Text>
      ) : null}

      {/* Everything painted on the picture, inline — ONE per-camera document,
          ONE editor. The sections stay a single component so the border switch
          can never drift apart from its triggers again. */}
      <OverlaySettingsSections
        deviceId={deviceId}
        context={context}
        config={overlayConfig}
        onChange={onChangeOverlay}
        highlight={highlight}
        onSetHighlight={onSetHighlight}
      />

      {/* Cluster-card label mode: shares the per-camera highlight DOCUMENT with
          the border triggers, but it styles the timeline's cards — so it sits
          in its own timeline section, apart from the border it does not gate.
          In a grid the timeline is the WALL's (one band for every camera) and
          the bar's menu owns this row. */}
      {isRowVisible('clusterLabel', context) ||
      isRowVisible('clipSource', context) ||
      isRowVisible('recordingSource', context) ? (
        <>
          <Text style={[styles.sectionLabel, { color: colors.foregroundMuted }]}>
            {t(GROUP_HEADER_KEY.timeline)}
          </Text>
          {isRowVisible('clusterLabel', context) ? (
            <ClusterLabelRow
              value={highlight.clusterLabel}
              onChange={(mode) => onSetHighlight({ clusterLabel: mode })}
            />
          ) : null}
          {/* WHICH of this camera's clip sources the clips list reads. Here and
              not under a heading of its own: the clips list IS the timeline in
              clips mode, and a second heading would split one question in two —
              the mistake D557 § 1 corrected on the admin side by folding its
              clips tab back into Recording. Renders nothing when the camera has
              fewer than two sources. */}
          {isRowVisible('clipSource', context) ? <ClipSourceRow deviceId={deviceId} /> : null}
          {/* WHICH of this camera's RECORDING sources paints the continuous
              bar. Beside the clip source and not folded into it: a camera whose
              clips come from the card may still be recorded by us, and one
              control answering both questions would make that unsayable.
              Renders nothing when the camera has fewer than two sources. */}
          {isRowVisible('recordingSource', context) ? (
            <RecordingSourceRow deviceId={deviceId} />
          ) : null}
        </>
      ) : null}

      {/* SCOPE GATE (`delete`). Both entries lead to a panel whose buttons
          permanently destroy stored media — retention prune and "delete every
          recording / every event for this camera". A session without the
          delete reach never sees the doors, because the panels behind them
          have nothing else in them: unlike the linked-device rows, there is no
          read-only half worth keeping. */}
      {canDelete && onOpenStorage !== undefined && onOpenEventStore !== undefined ? (
        <>
          <Text style={[styles.sectionLabel, { color: colors.foregroundMuted }]}>
            {t(GROUP_HEADER_KEY.management)}
          </Text>
          <MenuActionRow icon={HardDrive} label={t('v2.storage.title')} onPress={onOpenStorage} />
          <MenuActionRow icon={ListTree} label={t('v2.eventsMgmt.title')} onPress={onOpenEventStore} />
        </>
      ) : null}

      {onOpenLegend !== undefined ? (
        <MenuActionRow icon={HelpCircle} label={t('v2.cameraMenu.timelineLegend')} onPress={onOpenLegend} />
      ) : null}
    </>
  )
}

interface MenuActionRowProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly onPress: () => void
}

/** A pressable icon + label + chevron row for the surface's action entries. */
function MenuActionRow({ icon: Icon, label, onPress }: MenuActionRowProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.actionRow}>
      <Icon size={18} color={colors.foregroundMuted} />
      <Text style={[styles.actionLabel, { color: colors.foreground }]}>{label}</Text>
      <ChevronRight size={18} color={colors.foregroundSubtle} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Denser groups: the view-options surface has grown, so section headers and
  // action rows use tighter vertical rhythm.
  sectionLabel: { fontSize: 12, fontWeight: '600', paddingTop: SPACING.sm, paddingBottom: SPACING.xs },
  hint: { fontSize: 11, paddingBottom: SPACING.xs },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.xs },
  actionLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
})
