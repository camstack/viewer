/**
 * Theater control: add the playhead frame to a named training collection.
 *
 * Collect-and-list for a session holding the `retrain` feature (an admin
 * holds it; named-training-collections.md). Annotation
 * stays on the admin Retrain page — this surface only freezes the playhead
 * instant, picks or creates a collection, and asks the hub to copy the still.
 *
 * Draws nothing without the feature or when `epochMs` is null. The parent shows
 * this only in recorded playback while paused; a button that 403s is worse
 * than no button.
 *
 * `appearance="bar"`: icon chip sized for {@link TimelinePlaybackBar}, placed
 * beside the Live / go-live control.
 */
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  trainingFrameRefusalText,
  useAddRetrainFrameFromRecording,
  useCreateRetrainCollection,
  useRetrainCollections,
} from '../../../data/use-retrain-collections.js'
import { useHasFeature } from '../../../data/use-me.js'
import { isForbiddenError, NOT_FOR_YOUR_ACCOUNT_KEY } from '../../../auth/forbidden.js'
import { GraduationCap, Plus } from '../../../lib/icons.js'
import { hapticResult, hapticTap } from '../../../lib/haptics.js'
import { useNotice } from '../../ui/confirm.js'
import { PickerSheet } from '../../ui/PickerSheet.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { useTimelineScale } from './TimelineScaleProvider.js'

export interface SendFrameToTrainingControlProps {
  readonly deviceId: number
  /** Playhead instant, or `null` while live / unknown. */
  readonly epochMs: number | null
  /** `bar` — playback bar icon chip; default compact strip (unused in product). */
  readonly appearance?: 'bar' | 'strip'
}

export function SendFrameToTrainingControl({
  deviceId,
  epochMs,
  appearance = 'strip',
}: SendFrameToTrainingControlProps): React.JSX.Element | null {
  const canRetrain = useHasFeature('retrain')
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const notice = useNotice()
  const collections = useRetrainCollections()
  const create = useCreateRetrainCollection()
  const send = useAddRetrainFrameFromRecording()

  const [open, setOpen] = useState(false)
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [instant, setInstant] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const list = collections.data ?? []
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (q.length === 0) return list
    return list.filter((c) => c.name.toLowerCase().includes(q))
  }, [list, filter])

  const close = useCallback(() => {
    if (send.isPending || create.isPending) return
    setOpen(false)
  }, [send.isPending, create.isPending])

  const onOpen = useCallback(() => {
    if (epochMs === null) return
    hapticTap()
    setInstant(epochMs)
    setCollectionId(null)
    setNewName('')
    setCreateError(null)
    setFilter('')
    setOpen(true)
  }, [epochMs])

  const onCreate = useCallback(async () => {
    setCreateError(null)
    const result = await create.mutateAsync(newName)
    if (result.kind === 'refused') {
      setCreateError(
        result.reason === 'empty-name'
          ? t('v2.theater.training.emptyName', 'Give the collection a name.')
          : t('v2.theater.training.duplicateName', 'A collection with that name already exists.'),
      )
      return
    }
    setNewName('')
    setCollectionId(result.collection.id)
  }, [create, newName, t])

  const onSend = useCallback(async () => {
    if (collectionId === null || instant === null) return
    try {
      const result = await send.mutateAsync({ collectionId, deviceId, epochMs: instant })
      const name = list.find((c) => c.id === collectionId)?.name ?? collectionId
      if (result.kind === 'added') {
        hapticResult(true)
        notice({
          title: t('v2.theater.training.addedTitle', 'Frame added'),
          message: result.reused
            ? t(
                'v2.theater.training.reusedBody',
                'That moment was already in the dataset; it is now in {{name}}.',
                { name },
              )
            : t('v2.theater.training.addedBody', 'Added to {{name}}. Annotate it on Retrain.', {
                name,
              }),
        })
        setOpen(false)
        return
      }
      hapticResult(false)
      notice({
        title: t('v2.theater.training.refusedTitle', 'Could not add frame'),
        message: trainingFrameRefusalText(result.reason, result.detail),
      })
    } catch (err) {
      hapticResult(false)
      notice({
        title: t('v2.theater.training.refusedTitle', 'Could not add frame'),
        message: isForbiddenError(err)
          ? t(NOT_FOR_YOUR_ACCOUNT_KEY)
          : err instanceof Error ? err.message : String(err),
      })
    }
  }, [collectionId, instant, send, deviceId, list, notice, t])

  if (!canRetrain) return null
  if (epochMs === null) return null

  const busy = send.isPending || create.isPending
  const addLabel = t('v2.theater.training.addFrame', 'Add frame to collection')

  const trigger =
    appearance === 'bar' ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={addLabel}
        disabled={busy}
        onPress={onOpen}
        testID="theater-send-frame-to-training"
        hitSlop={4}
        style={[
          styles.barChip,
          {
            width: ui.control.button,
            height: ui.control.button,
            borderRadius: ui.radius.lg,
            backgroundColor: colors.surfaceHover,
            borderColor: colors.border,
            opacity: busy ? 0.45 : 1,
          },
        ]}
      >
        <GraduationCap size={ui.px(15)} color={colors.foreground} />
      </Pressable>
    ) : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={addLabel}
        disabled={busy}
        onPress={onOpen}
        testID="theater-send-frame-to-training"
        style={[
          styles.chip,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: busy ? 0.45 : 1,
          },
        ]}
      >
        <GraduationCap size={14} color={colors.foregroundMuted} />
        <Text style={[styles.chipLabel, { color: colors.foreground }]}>{addLabel}</Text>
      </Pressable>
    )

  return (
    <>
      {trigger}

      {open && instant !== null ? (
        <PickerSheet
          title={t('v2.theater.training.sheetTitle', 'Send this frame to training')}
          subtitle={t('v2.theater.training.sheetSubtitle', '{{when}}', {
            when: new Date(instant).toLocaleString(),
          })}
          onClose={close}
          testID="theater-send-frame-sheet"
          headerRight={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('v2.common.close', 'Close')}
              onPress={close}
              disabled={busy}
              hitSlop={8}
            >
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                {t('v2.common.close', 'Close')}
              </Text>
            </Pressable>
          }
          search={
            list.length > 4
              ? {
                  value: filter,
                  onChange: setFilter,
                  placeholder: t('v2.theater.training.search', 'Search collections'),
                }
              : undefined
          }
        >
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {collections.isLoading ? (
              <ActivityIndicator color={colors.primary} style={styles.pad} />
            ) : null}
            {!collections.isLoading && filtered.length === 0 ? (
              <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
                {t('v2.theater.training.emptyList', 'No collection yet — create one below.')}
              </Text>
            ) : null}
            {filtered.map((c) => {
              const selected = c.id === collectionId
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    hapticTap()
                    setCollectionId(c.id)
                  }}
                  style={[
                    styles.row,
                    {
                      backgroundColor: colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                      borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                    {t('v2.theater.training.frameCount', '{{count}} frames', {
                      count: c.frameCount,
                    })}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>

          <View style={[styles.createRow, { borderTopColor: colors.border }]}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder={t(
                'v2.theater.training.newPlaceholder',
                'New collection (e.g. missed at night)',
              )}
              placeholderTextColor={colors.foregroundSubtle}
              accessibilityLabel={t('v2.theater.training.newPlaceholder')}
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('v2.theater.training.create', 'Create')}
              disabled={create.isPending || newName.trim() === ''}
              onPress={() => void onCreate()}
              style={[
                styles.createBtn,
                { backgroundColor: colors.surface, borderColor: colors.border, opacity: newName.trim() === '' ? 0.45 : 1 },
              ]}
            >
              {create.isPending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Plus size={14} color={colors.foreground} />
              )}
            </Pressable>
          </View>
          {createError !== null ? (
            <Text style={[styles.error, { color: colors.danger }]}>{createError}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('v2.theater.training.send', 'Add to collection')}
            disabled={busy || collectionId === null}
            onPress={() => void onSend()}
            style={[
              styles.send,
              {
                backgroundColor: colors.primary,
                opacity: busy || collectionId === null ? 0.45 : 1,
              },
            ]}
          >
            {send.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.sendLabel, { color: colors.primaryForeground }]}>
                {t('v2.theater.training.send', 'Add to collection')}
              </Text>
            )}
          </Pressable>
        </PickerSheet>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  barChip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
    marginHorizontal: SPACING.sm,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  list: {
    maxHeight: 220,
    marginTop: SPACING.sm,
  },
  pad: { marginVertical: SPACING.md },
  hint: { fontSize: 12, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.md },
  row: {
    marginHorizontal: SPACING.sm,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    fontSize: 14,
  },
  createBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { fontSize: 12, paddingHorizontal: SPACING.sm, marginTop: SPACING.xs },
  send: {
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  sendLabel: { fontSize: 14, fontWeight: '700' },
})
