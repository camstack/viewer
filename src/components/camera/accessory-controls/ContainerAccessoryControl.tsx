/**
 * ContainerAccessoryControl — renders a CONTAINER linked-device row AS its
 * primary child's control.
 *
 * A container (e.g. a Gree air-conditioner) exposes no control of its own, so a
 * bare container row shows no action. Mirroring admin-ui's `ContainerHero`, this
 * fetches the container's entity children (`deviceManager.getChildren` via
 * `useAccessories`), resolves the highest-priority child by type
 * (`resolvePrimaryChildByType`), and renders THAT child's inline
 * `AccessoryControl` — so an A/C container surfaces its climate control (mode +
 * setpoint), a grouped light surfaces its switch, etc.
 *
 * Degrades gracefully: a container with no children renders nothing.
 */
import React from 'react'
import { useAccessories } from '../../../data/use-accessories.js'
import { AccessoryControl } from './AccessoryControl.js'
import { ControlSpinner } from './control-atoms.js'
import { resolvePrimaryChildByType } from './container-primary.js'

export interface ContainerAccessoryControlProps {
  readonly containerId: number
}

export function ContainerAccessoryControl({ containerId }: ContainerAccessoryControlProps) {
  const { data, isLoading } = useAccessories(containerId)
  const children = data ?? []
  const primary = resolvePrimaryChildByType(children)

  if (isLoading && !data) return <ControlSpinner />
  if (primary === null) return null

  return <AccessoryControl device={primary} />
}
