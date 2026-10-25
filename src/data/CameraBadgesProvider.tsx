/**
 * CameraBadgesProvider — one badge fetch for a whole screen of cards.
 *
 * The aggregate is per-SCREEN (it takes the list of cameras being shown), but
 * it is consumed per-CARD, and the consumers are two levels apart:
 * `CameraCard` reads the battery, and `CameraStatusDot` — which the card
 * renders, and which the camera detail renders on its own — reads the recording
 * mode. Prop-drilling through both would put the aggregate in the signature of
 * a component that must also work with no aggregate at all.
 *
 * So the screen mounts this and the leaves read it. Where it is NOT mounted
 * (the detail screen, a grid tile) `useCameraBadgeRow` reports `supported:
 * false`, which is the same answer an old hub gives — and the callers already
 * have to handle that, so there is exactly one fallback path rather than two.
 */
import React, { createContext, useContext, useMemo } from 'react'

import {
  resolveBadgeSlice,
  useCameraBadges,
  type CameraBadgeAggregate,
  type CameraBadgeSlice,
} from './use-camera-badges.js'

export type { CameraBadgeSlice } from './use-camera-badges.js'

const BadgesContext = createContext<CameraBadgeAggregate | null>(null)

export interface CameraBadgesProviderProps {
  readonly deviceIds: readonly number[]
  /** Gate the fetch the way the cards gate theirs — screen focused, app awake. */
  readonly enabled: boolean
  readonly children: React.ReactNode
}

export function CameraBadgesProvider({
  deviceIds,
  enabled,
  children,
}: CameraBadgesProviderProps): React.JSX.Element {
  const { data, status } = useCameraBadges(deviceIds, enabled)
  // Pending is "no answer YET", not "no answer": an errored aggregate has
  // answered (badly), and the cards' own queries are the right fallback there.
  const pending = data === undefined && status === 'pending'
  const value = useMemo<CameraBadgeAggregate>(
    () => ({ pending, supported: data?.supported === true, byId: data?.byId ?? {} }),
    [data, pending],
  )
  return <BadgesContext.Provider value={value}>{children}</BadgesContext.Provider>
}

/** This camera's badge values from the screen's aggregate — see `resolveBadgeSlice`. */
export function useCameraBadgeRow(deviceId: number): CameraBadgeSlice {
  return resolveBadgeSlice(useContext(BadgesContext), deviceId)
}
