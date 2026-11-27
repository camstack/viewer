/**
 * planning#751 — the detection hold is the GLOBAL setting everywhere the border
 * is drawn; a per-camera / per-grid `detectionHoldSec` is no longer read.
 * (Wiring spec: reverting any of these lines fails it.)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (rel: string): string => readFileSync(join(__dirname, '../..', rel), 'utf8')

describe('the detection hold is global', () => {
  it('the camera detail holds the native border and feeds the embed with it', () => {
    const s = src('screens/CameraDetailScreen.tsx')
    expect(s).toContain('useHeld(detMatch, settings.grid.detectionHoldSec * 1000)')
    expect(s).toContain('detectionHoldSec: settings.grid.detectionHoldSec,')
    expect(s).not.toContain('cameraHighlight.detectionHoldSec')
  })

  it('the grid wall embed and the share link carry the global hold', () => {
    expect(src('screens/GridViewScreen.tsx')).toContain('detectionHoldSec: settings.grid.detectionHoldSec,')
    expect(src('components/grid/GridShareDialog.tsx')).toContain('detectionHoldSec: settings.grid.detectionHoldSec,')
  })

  it('the trigger rows no longer edit a hold unless the reel asks', () => {
    const s = src('components/camera/HighlightTriggerRows.tsx')
    expect(s).toContain('ownHold = false')
    expect(src('components/camera/ReelHighlightSheet.tsx')).toContain('ownHold')
  })
})
