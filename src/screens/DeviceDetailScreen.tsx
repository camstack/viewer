/**
 * DeviceDetailScreen — one device, full screen, from ONE slot template.
 *
 * A stacked route over the tabs (`/device/<deviceId>`), opened from a detail
 * button on an accessory row, with the same chrome as the remote
 * ({@link FullScreenFrame}, `ScreenHeader`). What it shows is decided by the
 * caps the device is bound to ({@link resolveDeviceSlots}), never by its type;
 * an empty slot is not drawn. History and Settings links are omitted: the
 * viewer has no per-device destination for either.
 */
import React from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { FullScreenFrame, fullScreenBottomPad } from '../components/FullScreenFrame.js'
import { EmptyState } from '../components/ui/EmptyState.js'
import { Section } from '../components/ui/Section.js'
import { Row } from '../components/ui/Row.js'
import { SlidersHorizontal } from '../lib/icons.js'
import { useCanActuate } from '../hooks/use-user-scope.js'
import { useDeviceBoundCaps } from '../data/use-device-bound-caps.js'
import { useDeviceIdentity } from '../data/device-detail-status.js'
import { hasTimedRun } from '../data/timed-run.js'
import { isActuatingControlKind } from '../components/camera/accessory-controls/control-registry.js'
import { PrimaryControl } from '../components/camera/accessory-controls/AccessoryControl.js'
import { MotionTriggerToggle } from '../components/camera/accessory-controls/MotionTriggerToggle.js'
import { SensorValueControl } from '../components/camera/accessory-controls/controls.js'
import {
  TimedRunArmedGroup,
  useTimedRunController,
} from '../components/camera/accessory-controls/TimedRunControl.js'
import { PillButton } from '../components/camera/accessory-controls/control-atoms.js'
import { Timer } from '../lib/icons.js'
import { BatteryBadge, LinkBadge, PowerBadge } from '../components/device-detail/DeviceBadges.js'
import { ContactStateLine, RunningStateLine } from '../components/device-detail/StatusLines.js'
import { ConsumablesList } from '../components/device-detail/ConsumablesList.js'
import { isGatedEntry, noAccessSlot, resolveDeviceSlots, type DeviceSlot, type SlotEntry } from './device-detail/device-slots.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../theme/tokens.js'

export interface DeviceDetailScreenProps {
  readonly deviceId: number
  readonly deviceName: string
  readonly deviceType: string
}

interface SlotContext {
  readonly deviceId: number
  readonly deviceName: string
  readonly deviceType: string
  readonly online: boolean
  readonly caps: readonly string[]
  readonly canActuate: boolean
}

function TimerWidget({ deviceId, online }: { readonly deviceId: number; readonly online: boolean }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { quickRun, left, busy, start, stop, restart } = useTimedRunController(deviceId, online)
  if (quickRun === null) return null
  if (left !== null) {
    return <TimedRunArmedGroup left={left} disabled={busy} onStop={() => void stop()} onRestart={() => void restart()} />
  }
  return (
    <PillButton
      label={t('v2.accessories.timedRun.quickRun', {
        duration: quickRun.duration,
        unit: t(`v2.accessories.timedRun.unit.${quickRun.unit}`),
      })}
      icon={Timer}
      disabled={busy}
      haptic="action"
      onPress={() => void start()}
    />
  )
}

function entryNode(entry: SlotEntry, ctx: SlotContext): React.JSX.Element | null {
  const common = { deviceId: ctx.deviceId, online: ctx.online }
  switch (entry.widget) {
    case 'battery':
      return <BatteryBadge key={entry.cap} deviceId={ctx.deviceId} enabled />
    case 'network-link':
      return <LinkBadge key={entry.cap} deviceId={ctx.deviceId} enabled />
    case 'power-draw':
      return <PowerBadge key={entry.cap} deviceId={ctx.deviceId} enabled />
    case 'running-state':
      return <RunningStateLine key={entry.cap} {...common} />
    case 'contact-state':
      return <ContactStateLine key={entry.cap} {...common} />
    case 'primary-control': {
      if (entry.pick === undefined) return null
      if (!ctx.canActuate && isActuatingControlKind(entry.pick.kind)) return null
      const device = { id: ctx.deviceId, name: ctx.deviceName, type: ctx.deviceType, online: ctx.online, features: ctx.caps }
      return <PrimaryControl key={entry.cap} device={device} pick={entry.pick} />
    }
    case 'main-reading':
    case 'reading':
      return <SensorValueControl key={entry.cap} {...common} feature={entry.cap} />
    case 'motion-trigger':
      return ctx.canActuate ? <MotionTriggerToggle key={entry.cap} {...common} /> : null
    case 'consumables':
      return <ConsumablesList key={entry.cap} {...common} />
    case 'timed-run':
      return ctx.canActuate && hasTimedRun(ctx.caps) ? <TimerWidget key={entry.cap} {...common} /> : null
  }
}

function SlotView({
  slot,
  ctx,
  showNoAccess,
}: {
  readonly slot: DeviceSlot
  readonly ctx: SlotContext
  readonly showNoAccess: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (!ctx.canActuate && slot.entries.length > 0 && slot.entries.every(isGatedEntry)) {
    return showNoAccess ? (
      <Text testID="device-no-access" style={[styles.note, { color: colors.foregroundMuted }]}>
        {t('v2.deviceDetail.noAccess')}
      </Text>
    ) : null
  }
  const nodes = slot.entries.map((entry) => entryNode(entry, ctx))
  switch (slot.slot) {
    case 'header':
      return nodes.some((n) => n !== null) ? <View style={styles.badges} testID="device-slot-header">{nodes}</View> : null
    case 'status':
      return <View testID="device-slot-status">{nodes}</View>
    case 'consumables':
      return <View testID="device-slot-consumables">{nodes}</View>
    case 'primary':
      return <View style={styles.primary} testID="device-slot-primary">{nodes}</View>
    case 'secondary':
    case 'readings':
    case 'timer': {
      const rowNodes = slot.slot === 'readings'
        ? slot.entries.map((entry, i) => (
            <Row key={entry.cap} label={t(`v2.deviceDetail.reading.${entry.cap}`)} right={nodes[i]} last={i === nodes.length - 1} />
          ))
        : nodes
      return slot.slot === 'timer' ? (
        <View style={styles.primary} testID="device-slot-timer">{nodes}</View>
      ) : (
        <Section title={t(`v2.deviceDetail.sections.${slot.slot}`)} testID={`device-slot-${slot.slot}`}>
          {slot.slot === 'secondary' ? <View style={styles.primary}>{nodes}</View> : rowNodes}
        </Section>
      )
    }
  }
}

export function DeviceDetailScreen({ deviceId, deviceName, deviceType }: DeviceDetailScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const canActuate = useCanActuate()
  const identity = useDeviceIdentity(deviceId)
  const bound = useDeviceBoundCaps(deviceId)
  const device = identity.data
  const caps = bound.data ?? device?.features ?? []
  const name = device?.name ?? (deviceName === '' ? `#${deviceId}` : deviceName)
  // Unanswered identity is not "online": no subtitle, and controls stay disabled (D315).
  const online = device?.online === true
  const type = device?.type ?? deviceType
  const waiting = (identity.isLoading || bound.isLoading) && device == null && bound.data == null
  const failed = !waiting && device == null && bound.data == null

  let body: React.JSX.Element
  if (waiting) {
    body = <ActivityIndicator color={colors.foregroundMuted} testID="device-loading" />
  } else if (failed) {
    body = <EmptyState icon={SlidersHorizontal} tone="danger" title={t('v2.deviceDetail.unavailable')} testID="device-error" />
  } else {
    const ctx: SlotContext = { deviceId, deviceName: name, deviceType: type, online, caps, canActuate }
    const slots = resolveDeviceSlots({ type, caps })
    const lockedAt = canActuate ? null : noAccessSlot(slots)
    body = (
      <>
        {slots.map((slot) => (
          <SlotView key={slot.slot} slot={slot} ctx={ctx} showNoAccess={slot.slot === lockedAt} />
        ))}
      </>
    )
  }

  return (
    <FullScreenFrame testID="device-screen">
      <ScreenHeader
        title={name}
        subtitle={device == null ? undefined : online ? t('v2.deviceDetail.online') : t('v2.deviceDetail.offline')}
        onBack={() => router.back()}
        bordered
      />
      <ScrollView testID="device-body" contentContainerStyle={[styles.body, { paddingBottom: fullScreenBottomPad(insets.bottom) }]}>
        {body}
      </ScrollView>
    </FullScreenFrame>
  )
}

const styles = StyleSheet.create({
  body: { padding: SPACING.xl, gap: SPACING.xl },
  note: { fontSize: TYPOGRAPHY.size.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  primary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.md },
})
