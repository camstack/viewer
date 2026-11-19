/**
 * The row's own extras — "On motion" and the timed run — handed to the primary
 * control so they sit INSIDE its button group, not beside it.
 *
 * `items` are `IconButton`s that join the control's group; `after` is what
 * reads after the group (the time left on an armed timed run). A control that
 * draws no group leaves both unused, and `AccessoryControl` draws them itself.
 */
import type React from 'react'

export interface GroupExtras {
  readonly items: React.ReactNode
  readonly after: React.ReactNode
}
