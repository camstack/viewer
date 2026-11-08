/**
 * Compact lifecycle-actuator accessory controls ported from admin-ui's
 * HeroRegistry: media-player transport, robot vacuum, robotic lawn-mower and
 * smart pet-feeder. Each mirrors the row philosophy of the core controls — a
 * compact cluster of icon buttons on the row's right edge, state-aware, disabled
 * while a mutation is in-flight (`useCapMutator`) or the row is offline.
 *
 * Cap method names are read verbatim from the server cap defs:
 *   - media-player: play / pause / stop / next / previous / turnOn / turnOff / volumeUp / volumeDown
 *   - vacuum-control: start / pause / returnToBase / locate
 *   - lawn-mower-control: startMowing / pause / dock
 *   - pet-feeder: feed({ grams }) / cancelFeed
 */
import React, { useCallback, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Play, Pause, Square, SkipBack, SkipForward, House, MapPin, Utensils, Power, PowerOff, RemoteControl, Minus, Plus } from '../../../lib/icons.js'
import { SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { useRemoteCommands } from '../../../data/use-remote.js'
import { RemoteSheet } from '../remote/RemoteSheet.js'
import {
  isPlaying, mediaPlayerFeatureFlags, powerOf, titleText, volumeLevelText, volumeViewOf,
} from './media-player-model.js'
import { useCapMutator } from '../../../data/use-accessory-controls.js'
import {
  useMediaPlayerStatus, useVacuumStatus, useLawnMowerStatus, usePetFeederStatus,
} from '../../../data/use-accessory-controls-ext.js'
import { IconButton, PillButton, ControlSpinner } from './control-atoms.js'
import type { AccessoryControlProps } from './controls.js'

/** Default manual-feed portion (grams) — mid-range of the 4–200 g hardware
 *  window; a single tap dispenses one sensible portion. */
const FEED_PORTION_GRAMS = 10

// ── Media player (transport: prev / play-pause / stop / next) ─────────────────
//
// An infrared TV (a media player the `remote` extension drives, no feedback)
// swaps the transport for what a TV remote has: power, volume steps and the
// Remote sheet. Every other player keeps the transport cluster as it was; a
// player that declares volume steps and no level gains the two step buttons.

export interface MediaPlayerControlProps extends AccessoryControlProps {
  /** The device's wire `features` (kebab-case `DeviceFeature` values). */
  readonly features?: readonly string[]
  /** The device's name, for the Remote sheet title. */
  readonly deviceName?: string
}

type TransportMethod = 'play' | 'pause' | 'stop' | 'next' | 'previous'
type MediaMethod = TransportMethod | 'turnOn' | 'turnOff' | 'volumeUp' | 'volumeDown'

export function MediaPlayerControl({ deviceId, online, features, deviceName }: MediaPlayerControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const status = useMediaPlayerStatus(deviceId, online)
  const remote = useRemoteCommands(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const flags = mediaPlayerFeatureFlags(features)
  const infrared = (remote.data?.roles.length ?? 0) > 0
  const state = status.data?.state
  const playing = isPlaying(state)
  const power = powerOf(state)
  const stepVolume = volumeViewOf(flags) === 'steps'
  const run = useCallback(
    async (method: MediaMethod) => {
      const args = method === 'volumeUp' || method === 'volumeDown' ? { steps: 1 } : {}
      await mutator.run('mediaPlayer', method, args)
      void status.refetch()
    },
    [mutator, status],
  )
  if (status.isLoading && !status.data) return <ControlSpinner />
  const disabled = !online || mutator.pending
  const volumeButtons = stepVolume ? (
    <>
      <IconButton icon={Minus} label={t('v2.accessories.volumeDown')} disabled={disabled} onPress={() => void run('volumeDown')} />
      <IconButton icon={Plus} label={t('v2.accessories.volumeUp')} disabled={disabled} onPress={() => void run('volumeUp')} />
    </>
  ) : null
  if (!infrared) {
    return (
      <View style={styles.cluster}>
        <IconButton icon={SkipBack} label={t('v2.accessories.previous')} disabled={disabled} onPress={() => void run('previous')} />
        <IconButton
          icon={playing ? Pause : Play}
          label={playing ? t('v2.accessories.pause') : t('v2.accessories.play')}
          active={playing}
          disabled={disabled}
          onPress={() => void run(playing ? 'pause' : 'play')}
        />
        <IconButton icon={Square} label={t('v2.accessories.stop')} disabled={disabled} onPress={() => void run('stop')} />
        <IconButton icon={SkipForward} label={t('v2.accessories.next')} disabled={disabled} onPress={() => void run('next')} />
        {volumeButtons}
      </View>
    )
  }
  const volume = volumeLevelText(status.data)
  const title = titleText(status.data)
  return (
    <View style={styles.cluster}>
      <View style={styles.readout}>
        <Text numberOfLines={1} style={[styles.stateText, { color: state === undefined ? colors.foregroundSubtle : colors.foreground }]}>
          {state === undefined ? t('v2.accessories.stateUnknown') : t(`v2.accessories.mediaState.${state}`)}
        </Text>
        {title !== null ? <Text numberOfLines={1} style={[styles.stateText, { color: colors.foregroundMuted }]}>{title}</Text> : null}
        {volume !== null ? <Text style={[styles.stateText, { color: colors.foregroundMuted }]}>{volume}</Text> : null}
      </View>
      {flags.power && power !== 'off' && power !== 'standby' ? (
        <IconButton icon={PowerOff} label={t('v2.accessories.powerOff')} disabled={disabled} onPress={() => void run('turnOff')} />
      ) : null}
      {flags.power && power !== 'on' ? (
        <IconButton icon={Power} label={t('v2.accessories.powerOn')} disabled={disabled} onPress={() => void run('turnOn')} />
      ) : null}
      {volumeButtons}
      <IconButton icon={RemoteControl} label={t('v2.accessories.remote')} disabled={!online} onPress={() => setRemoteOpen(true)} />
      {remoteOpen ? (
        <RemoteSheet deviceId={deviceId} deviceName={deviceName ?? ''} onClose={() => setRemoteOpen(false)} />
      ) : null}
    </View>
  )
}

// ── Vacuum (start-pause / dock / locate) ──────────────────────────────────────

export function VacuumControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const status = useVacuumStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const state = status.data?.state ?? 'idle'
  const cleaning = state === 'cleaning'
  const run = useCallback(
    async (method: 'start' | 'pause' | 'returnToBase' | 'locate') => {
      await mutator.run('vacuumControl', method, {})
      void status.refetch()
    },
    [mutator, status],
  )
  if (status.isLoading && !status.data) return <ControlSpinner />
  const disabled = !online || mutator.pending
  return (
    <View style={styles.cluster}>
      <IconButton
        icon={cleaning ? Pause : Play}
        label={cleaning ? t('v2.accessories.pause') : t('v2.accessories.start')}
        active={cleaning}
        disabled={disabled}
        onPress={() => void run(cleaning ? 'pause' : 'start')}
      />
      <IconButton icon={House} label={t('v2.accessories.dock')} active={state === 'returning' || state === 'docked'} disabled={disabled} onPress={() => void run('returnToBase')} />
      <IconButton icon={MapPin} label={t('v2.accessories.locate')} disabled={disabled} onPress={() => void run('locate')} />
    </View>
  )
}

// ── Lawn mower (start-pause / dock) ───────────────────────────────────────────

export function LawnMowerControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const status = useLawnMowerStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const activity = status.data?.activity ?? 'idle'
  const mowing = activity === 'mowing'
  const run = useCallback(
    async (method: 'startMowing' | 'pause' | 'dock') => {
      await mutator.run('lawnMowerControl', method, {})
      void status.refetch()
    },
    [mutator, status],
  )
  if (status.isLoading && !status.data) return <ControlSpinner />
  const disabled = !online || mutator.pending
  return (
    <View style={styles.cluster}>
      <IconButton
        icon={mowing ? Pause : Play}
        label={mowing ? t('v2.accessories.pause') : t('v2.accessories.start')}
        active={mowing}
        disabled={disabled}
        onPress={() => void run(mowing ? 'pause' : 'startMowing')}
      />
      <IconButton icon={House} label={t('v2.accessories.dock')} active={activity === 'docked'} disabled={disabled} onPress={() => void run('dock')} />
    </View>
  )
}

// ── Pet feeder (manual feed / cancel) ─────────────────────────────────────────

export function PetFeederControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const status = usePetFeederStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const feeding = status.data?.feeding ?? false
  const feed = useCallback(async () => {
    await mutator.run('petFeeder', 'feed', { grams: FEED_PORTION_GRAMS })
    void status.refetch()
  }, [mutator, status])
  const cancel = useCallback(async () => {
    await mutator.run('petFeeder', 'cancelFeed', {})
    void status.refetch()
  }, [mutator, status])
  const disabled = !online || mutator.pending
  return (
    <PillButton
      label={feeding ? t('v2.accessories.feeding') : t('v2.accessories.feed')}
      icon={Utensils}
      active={feeding}
      disabled={disabled}
      onPress={() => void (feeding ? cancel() : feed())}
    />
  )
}

const styles = StyleSheet.create({
  cluster: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  readout: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  stateText: { flexShrink: 1, fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
})
