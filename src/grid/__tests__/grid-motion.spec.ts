import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseOverlayConfig } from '../../components/camera/overlay/overlay-config.js'
import { resolveGridOptions } from '../../store/grid-store.js'
import { buildTileOverlayMap, tileOverlayFor } from '../../grid-embed/embed-config.js'
import { wallHighlight, wallMotionOn, wallTileOverlay } from '../grid-motion.js'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the wall follows the GRID document for motion (planning#745)', () => {
  it('a grid that never stored the setting has motion OFF', () => {
    expect(wallMotionOn(resolveGridOptions(undefined).layers)).toBe(false)
    expect(wallMotionOn(resolveGridOptions({}).layers)).toBe(false)
  })

  it('a stored canonical layer set carrying motion turns it on, and one without keeps it off', () => {
    expect(wallMotionOn(resolveGridOptions({ layers: ['motion', 'objects'] }).layers)).toBe(true)
    expect(wallMotionOn(resolveGridOptions({ layers: ['objects'] }).layers)).toBe(false)
  })

  it('the retired per-camera-era motionBoxes flag does NOT switch the wall on', () => {
    expect(wallMotionOn(resolveGridOptions({ motionBoxes: true, boxes: 'all' }).layers)).toBe(false)
  })

  it('a camera whose own document has the motion layer does not make its tile draw it on a wall with it off', () => {
    const own = parseOverlayConfig({ layers: ['motion'], motionBadge: 'top-left' })
    expect(wallTileOverlay(own, []).motionBadge).toBe('off')
    expect(wallTileOverlay(own, ['motion']).motionBadge).toBe('top-right')
  })

  it('the embed is not told a camera\'s own motion: it travels as the grid setting', () => {
    const own = parseOverlayConfig({ layers: ['motion'], motionBadge: 'top-left' })
    const config = tileOverlayFor(own)
    expect(config).not.toHaveProperty('motionBoxes')
    expect(config).not.toHaveProperty('motionBadge')
    expect(buildTileOverlayMap([{ deviceId: 5, overlay: own }])['5']).not.toHaveProperty('motionBoxes')
  })

  it('the border cannot light with the layer off', () => {
    expect(wallHighlight({ motion: true, audio: false }, []).motion).toBe(false)
    expect(wallHighlight({ motion: true, audio: false }, ['motion']).motion).toBe(true)
  })

  it('the native tile and the hosted wall read the grid layer, never the camera document', () => {
    const tile = read('src/components/grid/GridTile.tsx')
    expect(tile).not.toContain("hasLayer(overlay, 'motion')")
    expect(tile).toContain('wallMotionOn(layers)')
    const screen = read('src/screens/GridViewScreen.tsx')
    expect(screen).toContain('wallMotionOn(layers)')
    expect(screen).toContain('wallHighlight(')
  })
  it('the hosted embed receives the grid layer and draws motion only from it', () => {
    expect(read('src/screens/GridViewScreen.tsx')).toContain('showMotion={wallMotionOn(layers)}')
    const player = read('embed/src/components/GridTilePlayer.tsx')
    expect(player).toContain('showMotion && !paused')
    expect(player).not.toContain('overlay?.motionBoxes')
    expect(read('embed/src/pages/EmbedGridPage.tsx')).toContain("case 'setShowMotion'")
    for (const f of ['GridLiveEmbed.tsx', 'GridLiveEmbed.web.tsx']) {
      expect(read(`src/grid-embed/${f}`)).toContain("kind: 'setShowMotion'")
    }
  })
})
