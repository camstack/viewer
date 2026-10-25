/**
 * CameraSwitchedOffProvider — "an operator turned something off here", for a
 * whole screen of tiles.
 *
 * ## Why this exists at all
 *
 * D62's fourth consequence: *every switch off is REPORTED off*. A camera
 * producing nothing because somebody switched it off must not look like one
 * that is broken — and on the camera list and the grid wall, "produces nothing"
 * is exactly what both look like. The status dot already separates DISABLED
 * (the whole camera, black) from OFFLINE (grey); this covers the other five,
 * where the camera is up and answering and one of its functions is deliberately
 * silent.
 *
 * ## Why a provider rather than a hook per tile
 *
 * Same reason as `CameraBadgesProvider`: `GridTile` and `CameraCard` are leaves
 * and the fetch belongs to the screen. Mounted per screen, read per tile, and
 * where it is NOT mounted `useSwitchedOffFor` reports an empty list — which is
 * also what a hub too old to have `getCameraSwitches` produces, so there is one
 * fallback path instead of two.
 *
 * Unlike the badges there is no batch procedure behind it, so the fetch is a
 * real per-camera fan-out. It therefore runs on the reconcile backstop only and
 * shares its cache entries with the detail screen's own group — a flip made in
 * the panel moves the list's badge with no extra call.
 */
import React, { createContext, useContext, useMemo } from 'react'

import { useSwitchedOffMap } from './use-camera-switches.js'

const NONE: readonly string[] = Object.freeze([])

const SwitchedOffContext = createContext<Readonly<Record<number, readonly string[]>> | null>(null)

export interface CameraSwitchedOffProviderProps {
  readonly deviceIds: readonly number[]
  /** Gate the fan-out the way the tiles gate theirs — screen focused, app awake. */
  readonly enabled: boolean
  readonly children: React.ReactNode
}

export function CameraSwitchedOffProvider({
  deviceIds,
  enabled,
  children,
}: CameraSwitchedOffProviderProps): React.JSX.Element {
  const byId = useSwitchedOffMap(deviceIds, enabled)
  const value = useMemo(() => byId, [byId])
  return <SwitchedOffContext.Provider value={value}>{children}</SwitchedOffContext.Provider>
}

/**
 * The functions an operator switched off on this camera.
 *
 * Empty when the provider is absent, when the group has not been read yet, and
 * when nothing is off — all three mean the same thing to a badge: draw nothing.
 * Claiming "switched off" on an unknown state would be the same lie in the
 * other direction.
 */
export function useSwitchedOffFor(deviceId: number): readonly string[] {
  const ctx = useContext(SwitchedOffContext)
  return ctx?.[deviceId] ?? NONE
}
