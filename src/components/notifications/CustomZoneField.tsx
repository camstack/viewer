/**
 * CustomZoneField — the `polygonDraw` valueType widget (task B6): the real
 * replacement for the disabled B5 `PolygonDrawStub`. It edits the personal-rule
 * `conditions.customZones` array of {@link NcMaskPolygonShape} — each a free
 * polygon normalised 0..1 to the FRAME (A1's `customZones` element, evaluated by
 * the server ZoneEngine).
 *
 * Flow: pick a camera to draw over (any camera — `customZones` is device-agnostic;
 * the rule's `devices` condition scopes which cameras it applies to), tap
 * "Disegna zona" to open the full-screen {@link CustomZoneDrawOverlay} over that
 * camera's snapshot, author a polygon, and Conferma appends it. Stored zones show
 * as removable chips. No server call happens here — the polygons ride the normal
 * `formToInput` → `conditions.customZones` serialize path (already end-to-end).
 */
import React, { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from '../../lib/icons.js'
import Svg, { Polygon } from 'react-native-svg'

import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { useCameras } from '../../data/use-cameras.js'
import { CustomZoneDrawOverlay } from '../camera/CustomZoneDrawOverlay.js'
import type { NcMaskPolygonShape } from '../../data/notification-center.js'

interface CustomZoneFieldProps {
  readonly value: readonly NcMaskPolygonShape[]
  readonly onChange: (next: NcMaskPolygonShape[]) => void
}

export function CustomZoneField({ value, onChange }: CustomZoneFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const camerasQuery = useCameras()
  const cameras = useMemo(() => (camerasQuery.data ?? []).filter((cam) => cam.online), [camerasQuery.data])

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [drawing, setDrawing] = useState(false)

  const effectiveId = selectedId ?? cameras[0]?.id ?? null
  const selectedCamera = cameras.find((cam) => cam.id === effectiveId) ?? null

  const openDraw = (): void => {
    if (effectiveId === null) return
    setDrawing(true)
  }
  const confirmZone = (poly: NcMaskPolygonShape): void => {
    if (poly.points.length >= 3) onChange([...value, poly])
    setDrawing(false)
  }
  const removeAt = (index: number): void => onChange(value.filter((_, i) => i !== index))

  return (
    <View style={{ gap: SPACING.md }}>
      {/* Stored zones as removable chips. */}
      {value.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
          {value.map((zone, index) => (
            <View
              key={index}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.xs,
                backgroundColor: colors.surfaceHover,
                borderRadius: RADIUS.md,
                paddingVertical: SPACING.xs,
                paddingHorizontal: SPACING.sm,
              }}
            >
              <ZoneThumb zone={zone} />
              <Text style={{ color: colors.foreground, fontSize: 13 }}>
                {t('v2.nc.rules.editor.customZones.zoneLabel', {
                  index: index + 1,
                  count: zone.points.length,
                })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('v2.nc.rules.editor.customZones.remove', { index: index + 1 })}
                onPress={() => removeAt(index)}
                hitSlop={6}
              >
                <Trash2 size={14} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>
          {t('v2.nc.rules.editor.customZones.empty')}
        </Text>
      )}

      {/* Camera picker (backdrop for drawing). */}
      {cameras.length === 0 ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
          {t('v2.nc.rules.editor.customZones.noCameras')}
        </Text>
      ) : (
        <View style={{ gap: SPACING.sm }}>
          <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
            {t('v2.nc.rules.editor.customZones.pickCamera')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: SPACING.sm, paddingVertical: 2 }}
          >
            {cameras.map((cam) => {
              const on = cam.id === effectiveId
              return (
                <Pressable
                  key={cam.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setSelectedId(cam.id)}
                  style={{
                    paddingVertical: SPACING.xs + 1,
                    paddingHorizontal: SPACING.md,
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? `${colors.primary}1f` : 'transparent',
                  }}
                >
                  <Text
                    style={{ color: on ? colors.primary : colors.foreground, fontSize: 13, fontWeight: on ? '700' : '500' }}
                    numberOfLines={1}
                  >
                    {cam.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            disabled={effectiveId === null}
            onPress={openDraw}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: SPACING.sm,
              paddingVertical: SPACING.md,
              borderRadius: RADIUS.md,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: colors.primary,
              opacity: effectiveId === null ? 0.5 : 1,
            }}
          >
            <Plus size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>
              {t('v2.nc.rules.editor.customZones.draw')}
            </Text>
          </Pressable>
        </View>
      )}

      <Modal
        visible={drawing && effectiveId !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setDrawing(false)}
      >
        {drawing && effectiveId !== null ? (
          <CustomZoneDrawOverlay
            deviceId={effectiveId}
            deviceName={selectedCamera?.name ?? ''}
            initial={null}
            onConfirm={confirmZone}
            onCancel={() => setDrawing(false)}
          />
        ) : null}
      </Modal>
    </View>
  )
}

/** A tiny normalised-polygon preview for a stored-zone chip. Points are already
 *  0..1, so the SVG viewBox is 0..1 and the shape scales to the swatch. */
function ZoneThumb({ zone }: { readonly zone: NcMaskPolygonShape }) {
  const { colors } = useTheme()
  const points = zone.points.map((p) => `${p.x},${p.y}`).join(' ')
  return (
    <Svg width={18} height={18} viewBox="0 0 1 1">
      <Polygon points={points} fill={`${colors.primary}40`} stroke={colors.primary} strokeWidth={0.06} />
    </Svg>
  )
}
