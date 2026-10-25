/**
 * ExportCard — one export in the Library's merged gallery, drawn as the shared
 * `LibraryTile` (2026-10-21; it was a full-width row of its own).
 *
 * An export has no picture of its own, so its image area is the placeholder
 * with the clapperboard glyph; the range and the camera ride on it, a render in
 * progress is the bar on its bottom edge, and the row is what was exported,
 * its state, and the one action that state allows (cancel while rendering,
 * download when ready). Delete lives in the detail viewer the tile opens.
 *
 * Moved out of the deleted `ExportsScreen` on 2026-09-13 so exports and
 * artifacts are two card components in ONE list; which actions it offers come
 * from {@link libraryItemActions} — the same function the card's detail viewer
 * and the artifact tiles ask. Everything textual comes from `export-format.ts`
 * through the injected `t`.
 */
import React, { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Clapperboard, Download, XCircle } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { Badge } from '../ui/Badge.js'
import type { BadgeTone } from '../ui/badge-colors.js'
import { LibraryTile, type LibraryTileAction } from '../ui/LibraryTile.js'
import { withAlpha } from '../../theme/tokens.js'
import {
  effectiveProgress,
  rangeLabel,
  stateLabel,
  variantLabel,
  type Translate,
} from '../../data/export-format.js'
import type { ExportRecord } from '../../data/use-exports.js'
import { exportItem, libraryItemActions } from '../../screens/artifacts/library-items.js'

export interface ExportCardProps {
  readonly rec: ExportRecord
  /** Fixed tile width (pt) from the Library column rule. */
  readonly width: number
  readonly cameraName: string
  readonly nowMs: number
  readonly livePct: number | null | undefined
  readonly t: Translate
  readonly onPress: () => void
  readonly onDownload: () => void
  readonly onCancel: () => void
}

function stateTone(rec: ExportRecord): BadgeTone {
  switch (rec.state) {
    case 'ready':
      return 'success'
    case 'failed':
      return 'danger'
    case 'rendering':
    case 'queued':
      return 'info'
    default:
      return 'neutral'
  }
}

export const ExportCard = memo(function ExportCard(props: ExportCardProps) {
  const { rec, t } = props
  const { colors } = useTheme()
  const pct = effectiveProgress(rec, props.livePct)
  const actions = libraryItemActions(exportItem(rec), props.nowMs)
  const failed = rec.state === 'failed' && rec.error !== null
  const title = failed && rec.error !== null ? rec.error : variantLabel(rec.options, t)
  const when = rangeLabel(rec.fromMs, rec.toMs)

  const tileActions: LibraryTileAction[] = []
  if (actions.cancel) {
    tileActions.push({ id: 'cancel', icon: XCircle, label: t('v2.exports.cancelAction'), tone: 'danger', onPress: props.onCancel })
  }
  if (actions.download) {
    tileActions.push({ id: 'download', icon: Download, label: t('v2.exports.downloadAction'), onPress: props.onDownload })
  }

  return (
    <LibraryTile
      width={props.width}
      source={null}
      placeholderIcon={Clapperboard}
      when={when}
      where={props.cameraName}
      bar={
        pct !== null ? (
          <View style={[styles.track, { backgroundColor: withAlpha(colors.foregroundMuted, 0.2) }]}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.info }]} />
          </View>
        ) : undefined
      }
      title={title}
      titleMuted={failed}
      badge={<Badge label={stateLabel(rec.state, t)} size="sm" tone={stateTone(rec)} look="tint" />}
      actions={tileActions}
      faded={rec.state === 'deleted'}
      onPress={props.onPress}
      accessibilityLabel={`${props.cameraName} · ${when} · ${stateLabel(rec.state, t)}`}
      testID={`export-tile-${rec.id}`}
    />
  )
})

const styles = StyleSheet.create({
  track: { height: 3, width: '100%', overflow: 'hidden' },
  fill: { height: '100%' },
})
