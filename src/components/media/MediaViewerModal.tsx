/**
 * MediaViewerModal — the full-screen viewer for ONE piece of stored media, and
 * the only place this app plays one.
 *
 * Extracted from `ArtifactDetailModal` on 2026-09-13, when exports joined the
 * artifacts gallery: an export is an mp4 with a retention window and a download,
 * which is the artifact viewer's job description word for word. Writing a second
 * viewer for it would have been two components answering "show me this file",
 * and the one that fell behind would be the one an operator happened to open
 * (D62).
 *
 *   • `video` → `react-native-video` with native controls.
 *   • `image` → `expo-image`, contain-fitted (a mosaic is wide, a still is 16:9
 *     — cropping either loses the thing the operator opened it for).
 *   • `unavailable` → the CALLER'S OWN SENTENCE. A stage that simply stays black
 *     is indistinguishable from an app that hung, and only the caller knows
 *     whether the file expired, was deleted, or never rendered.
 *
 * Both sources carry whatever headers the caller's data plane needs; this
 * component invents no URL and no auth scheme of its own.
 */
import React, { memo, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import Video from 'react-native-video'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { log } from '../../lib/logger.js'

/** What the stage should draw. */
export type ViewerMedia =
  | { readonly kind: 'video'; readonly url: string; readonly headers?: Record<string, string> }
  | { readonly kind: 'image'; readonly url: string; readonly headers?: Record<string, string> }
  /** No bytes to show, and the REASON, in the caller's words. */
  | { readonly kind: 'unavailable'; readonly message: string; readonly severity: 'muted' | 'danger' }

/** One label → value line under the stage. */
export interface ViewerMetaRow {
  readonly key: string
  readonly label: string
  readonly value: string
}

export interface MediaViewerModalProps {
  readonly visible: boolean
  readonly title: string
  readonly media: ViewerMedia
  readonly metaRows: readonly ViewerMetaRow[]
  /** Buttons in the top bar, before Close (download, delete, …). */
  readonly actions?: ReactNode
  /** Anything between the stage and the metadata — a progress bar, a warning. */
  readonly beforeMeta?: ReactNode
  /** Small print under the metadata (a retention caveat). */
  readonly footerHint?: string
  /** Tints the stage background; the kind accent of whatever is being shown. */
  readonly accent: string
  /** For the log line when playback fails — a viewer that dies unnamed is the
   *  black stage this component exists to prevent. */
  readonly mediaId: string
  readonly onMediaError: () => void
  readonly closeLabel: string
  readonly onClose: () => void
}

export const MediaViewerModal = memo(function MediaViewerModal(props: MediaViewerModalProps) {
  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      {props.visible ? <MediaViewerBody {...props} /> : null}
    </Modal>
  )
})

function MediaViewerBody({
  title,
  media,
  metaRows,
  actions,
  beforeMeta,
  footerHint,
  accent,
  mediaId,
  onMediaError,
  closeLabel,
  onClose,
}: MediaViewerModalProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.bar, { borderBottomColor: colors.border }]}>
        <Text style={[styles.barTitle, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        {actions}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          hitSlop={8}
          style={styles.barBtn}
        >
          <X size={20} color={colors.foregroundMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SPACING.xl,
          paddingBottom: insets.bottom + SPACING['3xl'],
          gap: SPACING.xl,
        }}
      >
        <View style={[styles.stage, { backgroundColor: `${accent}14`, borderColor: colors.border }]}>
          {media.kind === 'unavailable' ? (
            <View style={[StyleSheet.absoluteFill, styles.stageCenter]}>
              <Text
                style={{
                  color: media.severity === 'danger' ? colors.danger : colors.foregroundMuted,
                  fontSize: 14,
                  textAlign: 'center',
                }}
              >
                {media.message}
              </Text>
            </View>
          ) : media.kind === 'video' ? (
            <Video
              source={media.headers === undefined ? { uri: media.url } : { uri: media.url, headers: media.headers }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              controls
              paused={false}
              onError={(e: unknown) => {
                // Named, never silent: a stage that simply stays black is
                // indistinguishable from an app that hung.
                log.warn('media-viewer', 'video playback failed', { mediaId, error: String(e) })
                onMediaError()
              }}
            />
          ) : (
            <Image
              source={media.headers === undefined ? { uri: media.url } : { uri: media.url, headers: media.headers }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={120}
              onError={() => {
                log.warn('media-viewer', 'image failed to load', { mediaId })
                onMediaError()
              }}
            />
          )}
        </View>

        {beforeMeta}

        <View style={[styles.metaCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {metaRows.map((row, index) => (
            <View
              key={row.key}
              style={[
                styles.metaRow,
                index < metaRows.length - 1
                  ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }
                  : null,
              ]}
            >
              <Text style={[styles.metaLabel, { color: colors.foregroundMuted }]} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]} numberOfLines={2}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {footerHint !== undefined ? (
          <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>{footerHint}</Text>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  barBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  stage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  stageCenter: { alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  metaCard: { borderWidth: 1, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.lg },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.lg,
    paddingVertical: SPACING.lg,
  },
  metaLabel: { fontSize: 13, flexShrink: 0 },
  metaValue: { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
  hint: { fontSize: 11, lineHeight: 16 },
})
