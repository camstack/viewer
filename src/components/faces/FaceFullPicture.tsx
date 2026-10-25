/**
 * FaceFullPicture — the frame a face crop was cut from, inside the face
 * detail, with the face's box drawn on it, and the door to that track.
 *
 * The rule (which frame, and why only that one) is `data/face-full-picture.ts`.
 * This component draws it: the native key frame `contain`-fitted in a 16:9
 * stage, the box projected through the SAME `BoundingBoxOverlay` the theater
 * detail uses (the frame's intrinsic size comes from the image's own load
 * event, as the admin face detail reads it), and an "Open event" button that
 * hands the face's track to the caller.
 *
 * A face whose hub kept no key frame says so in one line — it does not borrow
 * another frame of the track to look complete.
 */
import React, { memo, useCallback, useState } from 'react'
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Image, type ImageLoadEventData } from 'expo-image'
import { ImageOff } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { SectionLabel } from '../ui/SectionLabel.js'
import { Button } from '../ui/Button.js'
import { BoundingBoxOverlay } from '../camera/theater/detail/BoundingBoxOverlay.js'
import type { DetailDetection } from '../camera/theater/detail/cluster-detail.js'
import { mediaImageSource } from '../../data/track-media-uri.js'
import type { FaceFullPicture as FullPicture } from '../../data/face-full-picture.js'

export interface FaceFullPictureProps {
  /** `null` ⇒ the hub kept no full picture for this face. */
  readonly picture: FullPicture | null
  readonly mediaHeaders: Record<string, string> | undefined
  /** Absent ⇒ no "Open event" button. */
  readonly onOpenTrack?: () => void
}

interface Size {
  readonly width: number
  readonly height: number
}

export const FaceFullPicture = memo(function FaceFullPicture({
  picture,
  mediaHeaders,
  onOpenTrack,
}: FaceFullPictureProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [stage, setStage] = useState<Size | null>(null)
  const [frame, setFrame] = useState<Size | null>(null)
  const [failedUri, setFailedUri] = useState<string | null>(null)

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setStage({ width, height })
  }, [])
  const onLoad = useCallback((event: ImageLoadEventData) => {
    setFrame({ width: event.source.width, height: event.source.height })
  }, [])

  const failed = picture !== null && failedUri === picture.uri
  const box = picture?.box
  const detections: readonly DetailDetection[] =
    box !== undefined && frame !== null
      ? [{ id: 'face', timestamp: 0, className: 'face', zones: [], bbox: box, frameWidth: frame.width, frameHeight: frame.height }]
      : []

  return (
    <View testID="face-full-picture">
      <SectionLabel style={styles.label}>{t('v2.faceReview.fullPicture')}</SectionLabel>
      {picture === null ? (
        <Text testID="face-full-picture-absent" style={[styles.absent, { color: colors.foregroundMuted }]}>
          {t('v2.faceReview.fullPictureAbsent')}
        </Text>
      ) : (
        <View onLayout={onLayout} style={[styles.stage, { backgroundColor: colors.surface }]}>
          {failed ? (
            <View style={styles.placeholder}>
              <ImageOff size={28} color={colors.foregroundSubtle} />
            </View>
          ) : (
            <Image
              source={mediaImageSource(picture.uri, mediaHeaders)}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              onLoad={onLoad}
              onError={() => setFailedUri(picture.uri)}
              accessibilityLabel={t('v2.faceReview.fullPicture')}
            />
          )}
          {!failed && stage !== null ? (
            <BoundingBoxOverlay detections={detections} width={stage.width} height={stage.height} />
          ) : null}
        </View>
      )}
      {onOpenTrack !== undefined ? (
        <View style={styles.action}>
          <Button
            label={t('v2.faceReview.openEvent')}
            kind="secondary"
            onPress={onOpenTrack}
            testID="face-open-track"
          />
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  label: { paddingTop: SPACING.md },
  stage: { width: '100%', aspectRatio: 16 / 9, borderRadius: RADIUS.lg, overflow: 'hidden', marginTop: SPACING.xs },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  absent: { fontSize: 13, paddingVertical: SPACING.sm },
  action: { paddingTop: SPACING.sm },
})
