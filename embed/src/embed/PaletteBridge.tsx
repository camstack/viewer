/**
 * Fetches the hub palette for an embed page and, when the read is unknown,
 * says so. The pages do not share one React tree with the app.
 */
import React from 'react'
import type { System } from '@camstack/sdk'
import { THEME } from '../../../src/theme/tokens'
import { usePaletteView } from '../../../shared/palette'
import { useEmbedPalette } from './use-display-palette'

export interface PaletteBridgeProps {
  readonly system: System
}

export function PaletteBridge({ system }: PaletteBridgeProps): React.JSX.Element | null {
  useEmbedPalette(system)
  const view = usePaletteView()
  if (view.origin !== 'unknown' || view.reason === null) return null
  return (
    <p
      role="status"
      data-testid="palette-unknown"
      style={{
        margin: 0,
        padding: '6px 10px',
        fontSize: 12,
        color: THEME.dark.warning,
        background: THEME.dark.background,
      }}
    >
      {`Palette unreadable (${view.reason}). Using the CamStack preset.`}
    </p>
  )
}
