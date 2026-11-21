/**
 * QuickActionTile — the LEFT icon of a device row, as the type's primary action.
 *
 * The tile keeps its size, icon and wash; what changes is that where the type
 * has one obvious action (`tile-quick-action.ts`) the tile is a button for it,
 * tinted by the device's live state, and pulses while a change is in flight or
 * the device reports it is moving. A type with no action, an offline device or
 * a read-only session keeps the plain tile. The rest of the row is unchanged.
 *
 * One small component per action kind, because each reads a different cap and
 * hooks cannot be chosen at run time. All four hand the same props to
 * `TileFrame`, which is the only place that draws.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { HeroRowModel, HeroTone } from '@camstack/types'
import {
  useCoverStatus, useLockStatus, useSwitchStatus, useCapMutator,
} from '../data/use-accessory-controls.js'
import { useCanActuate } from '../hooks/use-user-scope.js'
import { hapticAction, hapticTap } from '../lib/haptics.js'
import type { AccessoryControlKind } from '../components/camera/accessory-controls/control-registry.js'
import { controlView, type ControlView } from './hero-view.js'
import { HeroSceneTile } from './HeroSceneTile.js'
import { useRowArm } from './row-arm.js'
import { useHeroCaller } from './use-hero.js'
import {
  TILE_PULSE_MAX_MS, coverPlan, coverState, lockPlan, lockState, switchPlan, switchState,
  tilePulsing, tileQuickKind, tileTint, type TileDeviceState, type TilePlan,
} from './tile-quick-action.js'

export interface QuickActionTileProps {
  readonly deviceId: number
  /** What the row is called; named in the button's accessibility label. */
  readonly name: string
  readonly online: boolean
  readonly controlKind: AccessoryControlKind
  /** The hub row model, when the row has one: its power toggle drives the types the registry has no cap for. */
  readonly model?: HeroRowModel | null
  readonly icon: string
  /** The tone the icon wears when active, and before its state is read. */
  readonly tone: HeroTone
  /** The hub's own verdict that the icon rests muted (offline or unknown). */
  readonly muted?: boolean
  readonly testID?: string
  /** What a tap does when the tile offers no action of its own (plain icon, offline, nothing to send): open the device, as the icon always did. */
  readonly onOpen?: () => void
  readonly openLabel?: string
}

type PowerView = Extract<ControlView, { kind: 'power' }>

/** The row model's power toggle, only when pressing it needs no confirmation (a dialog hangs in a sheet). */
function heroPower(model: HeroRowModel | null | undefined): PowerView | null {
  if (model?.primary == null) return null
  const view = controlView(model.primary)
  return view !== null && view.kind === 'power' && view.press.confirm === null ? view : null
}

export function QuickActionTile(props: QuickActionTileProps): React.JSX.Element {
  const canActuate = useCanActuate()
  const power = heroPower(props.model)
  const kind = tileQuickKind(props.controlKind, power !== null, canActuate)
  switch (kind) {
    case 'switch':
      return <SwitchTile {...props} />
    case 'cover':
      return <CoverTile {...props} capKey={props.controlKind === 'valve' ? 'valve' : 'cover'} />
    case 'lock':
      return <LockTile {...props} />
    case 'hero-power':
      return power === null ? <PlainTile {...props} /> : <HeroPowerTile {...props} power={power} />
    case 'none':
      return <PlainTile {...props} />
  }
}

function PlainTile({ icon, tone, muted = false, online, testID, onOpen, openLabel }: QuickActionTileProps): React.JSX.Element {
  return <OpenWrap onOpen={onOpen} openLabel={openLabel}><HeroSceneTile icon={icon} tone={tone} muted={muted} disabled={!online} testID={testID} /></OpenWrap>
}

function OpenWrap({ onOpen, openLabel, children }: Pick<QuickActionTileProps, 'onOpen' | 'openLabel'> & { readonly children: React.ReactNode }): React.JSX.Element {
  if (onOpen === undefined) return <>{children}</>
  return (
    <Pressable
      onPress={() => { hapticTap(); onOpen() }}
      accessibilityRole="button"
      accessibilityLabel={openLabel}
    >
      {children}
    </Pressable>
  )
}

interface FrameProps extends QuickActionTileProps {
  readonly state: TileDeviceState | 'loading'
  /** What a tap does; `null` = nothing to offer right now (a lock mid-travel). */
  readonly plan: TilePlan | null
  readonly pending: boolean
  readonly failed: boolean
  readonly onPress: () => void
}

/** Pulsing is bounded: a report stuck on "moving" stops animating after `TILE_PULSE_MAX_MS`. */
function usePulseExpired(active: boolean): boolean {
  const [expired, setExpired] = useState(false)
  if (!active && expired) setExpired(false)
  useEffect(() => {
    if (!active) return undefined
    const timer = setTimeout(() => setExpired(true), TILE_PULSE_MAX_MS)
    return () => clearTimeout(timer)
  }, [active])
  return expired
}

function TileFrame({ deviceId, name, online, icon, tone, muted = false, testID, onOpen, openLabel, state, plan, pending, failed, onPress }: FrameProps): React.JSX.Element {
  const { t } = useTranslation()
  const busy = pending || state === 'transitional'
  const expired = usePulseExpired(busy)
  const pulsing = tilePulsing(state, pending, expired)
  const tint = tileTint({ online, state, failed, activeTone: tone, restingTone: tone })
  // Before the state is read the hub's own muting stands; afterwards the live state decides.
  const tile = (
    <HeroSceneTile
      icon={icon}
      tone={tint.tone}
      muted={state === 'loading' ? muted : tint.tone === 'muted'}
      disabled={tint.disabled}
      pulsing={pulsing}
      testID={testID}
    />
  )
  if (plan === null || !online) return <OpenWrap onOpen={onOpen} openLabel={openLabel}>{tile}</OpenWrap>
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t(`v2.tileAction.${plan.label}`, { device: name })}
      accessibilityState={{ busy: pulsing, disabled: pending }}
      testID={`tile-action-${deviceId}`}
    >
      {tile}
    </Pressable>
  )
}

function SwitchTile(props: QuickActionTileProps): React.JSX.Element {
  const status = useSwitchStatus(props.deviceId, props.online)
  const mutator = useCapMutator(props.deviceId)
  const on = status.data?.on ?? null
  const plan = switchPlan(on)
  const press = useCallback(async () => {
    await mutator.run(plan.call.cap, plan.call.method, plan.call.args)
    void status.refetch()
  }, [mutator, plan, status])
  return (
    <TileFrame
      {...props}
      state={status.isLoading && !status.data ? 'loading' : switchState(on)}
      plan={plan}
      pending={mutator.pending}
      failed={mutator.error !== null}
      onPress={() => { hapticAction(); void press() }}
    />
  )
}

function CoverTile({ capKey, ...props }: QuickActionTileProps & { readonly capKey: 'cover' | 'valve' }): React.JSX.Element {
  const status = useCoverStatus(props.deviceId, props.online)
  const mutator = useCapMutator(props.deviceId)
  const reported = status.data?.state ?? null
  const plan = coverPlan(capKey, reported)
  const press = useCallback(async () => {
    await mutator.run(plan.call.cap, plan.call.method, plan.call.args)
    void status.refetch()
  }, [mutator, plan, status])
  return (
    <TileFrame
      {...props}
      state={status.isLoading && !status.data ? 'loading' : coverState(reported)}
      plan={plan}
      pending={mutator.pending}
      failed={mutator.error !== null}
      onPress={() => { hapticAction(); void press() }}
    />
  )
}

function LockTile(props: QuickActionTileProps): React.JSX.Element {
  const status = useLockStatus(props.deviceId, props.online)
  const mutator = useCapMutator(props.deviceId)
  // An unlock is asked in the row (a second tap inside the window), like the lock's own button.
  const arm = useRowArm()
  const reported = status.data?.state ?? null
  const plan = lockPlan(reported)
  const press = useCallback(async () => {
    if (plan === null) return
    await mutator.run(plan.call.cap, plan.call.method, plan.call.args)
    void status.refetch()
  }, [mutator, plan, status])
  return (
    <TileFrame
      {...props}
      state={status.isLoading && !status.data ? 'loading' : lockState(reported)}
      plan={plan}
      pending={mutator.pending}
      failed={mutator.error !== null}
      onPress={() => {
        if (plan === null) return
        hapticAction()
        arm.press(plan.call.armId ?? plan.label, plan.call.armId !== null, () => void press())
      }}
    />
  )
}

function HeroPowerTile({ power, ...props }: QuickActionTileProps & { readonly power: PowerView }): React.JSX.Element {
  const caller = useHeroCaller(props.deviceId)
  const plan: TilePlan = {
    call: { cap: power.press.call.cap, method: power.press.call.method, args: power.press.call.args, armId: null },
    label: power.look === 'on' ? 'powerOff' : 'powerOn',
  }
  const state: TileDeviceState = power.look === 'on' ? 'on' : power.look === 'off' ? 'off' : 'unknown'
  return (
    <TileFrame
      {...props}
      state={state}
      plan={plan}
      pending={caller.pending}
      failed={caller.error !== null}
      onPress={() => { hapticAction(); void caller.runAction(power.press) }}
    />
  )
}
