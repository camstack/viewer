/**
 * One overlay size, three hosts: the single player, the native wall tile and the
 * hosted embed tile must size a read-out the same way.
 *
 * The embed is a separate bundle and mirrors `overlay-size.ts` by hand; this is
 * the spec that notices the copy drifting, and the wiring that proves every
 * surface actually mounts its read-outs inside a frame (a surface that skipped
 * it would silently draw at scale 1 whatever the operator chose).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BASE_FONT_PX,
  MAX_SCALE,
  OVERLAY_SIZE_MIN_SCALE,
  OVERLAY_SIZE_SHARE,
  OVERLAY_SIZES,
  overlayScale,
} from '../overlay-size.js'
import {
  BASE_FONT_PX as EMBED_BASE,
  MAX_SCALE as EMBED_MAX,
  OVERLAY_SIZE_MIN_SCALE as EMBED_MIN,
  OVERLAY_SIZE_SHARE as EMBED_SHARE,
  OVERLAY_SIZES as EMBED_SIZES,
  overlayScale as embedScale,
} from '../../../../../embed/src/embed/overlay-size.js'

const ROOT = process.cwd()
const read = (...p: string[]): string => readFileSync(join(ROOT, ...p), 'utf8')

describe('the embed mirrors the app\'s overlay size', () => {
  it('same levels, same shares, same clamps', () => {
    expect([...EMBED_SIZES]).toEqual([...OVERLAY_SIZES])
    expect(EMBED_SHARE).toEqual(OVERLAY_SIZE_SHARE)
    expect(EMBED_BASE).toBe(BASE_FONT_PX)
    expect(EMBED_MIN).toEqual(OVERLAY_SIZE_MIN_SCALE)
    expect(EMBED_MAX).toBe(MAX_SCALE)
  })

  it('same multiplier at every width and level', () => {
    for (const width of [0, 90, 160, 390, 640, 932, 1920, 4000]) {
      for (const size of OVERLAY_SIZES) {
        expect(embedScale(width, size), `${String(width)} ${size}`).toBe(overlayScale(width, size))
      }
    }
  })
})

describe('every surface that draws read-outs sizes them', () => {
  it('the single player mounts its read-outs in an OverlayFrame', () => {
    const screen = read('src/screens/CameraDetailScreen.tsx')
    const frame = screen.slice(screen.indexOf('<OverlayFrame'), screen.indexOf('</OverlayFrame>'))
    for (const overlay of [
      '<AudioLevelMeter',
      '<DeviceInfoOverlay',
      '<DoorbellBadge',
      '<OccupancyBadge',
      '<OverlayReadouts',
      '<StreamStatsOverlay',
      '<LiveViewersBadge',
    ]) {
      expect(frame, overlay).toContain(overlay)
    }
    // …and the frame follows the player's own fit (letterboxed in fill / wide).
    expect(screen).toContain("fit={fill || isWideDetail ? 'contain' : 'cover'}")
  })

  it('the native wall tile mounts its indicators in an OverlayFrame', () => {
    const tile = read('src/components/grid/GridTile.tsx')
    const frame = tile.slice(tile.indexOf('<OverlayFrame'), tile.indexOf('</OverlayFrame>'))
    for (const overlay of ['<AudioLevelMeter', '<OccupancyBadge', '<StreamStatsOverlay', '<LiveViewersBadge']) {
      expect(frame, overlay).toContain(overlay)
    }
  })

  it('the wall\'s device-information pill is framed too', () => {
    expect(read('src/components/grid/GridDeviceInfo.tsx')).toContain('<OverlayFrame')
  })

  it('the hosted tile publishes --ov on a frame over the PICTURE and draws every indicator inside it', () => {
    const tile = read('embed/src/components/GridTilePlayer.tsx')
    const frame = tile.slice(tile.indexOf('...scaleVarStyle('), tile.indexOf('<TileViewers'))
    expect(tile).toContain('overlayScale(measured ? picture.width')
    for (const overlay of ['<TileAudioMeter', '<TileOccupancy', '<TileStats']) {
      expect(frame, overlay).toContain(overlay)
    }
  })

  it('both walls hand the embed the device size', () => {
    for (const file of ['src/screens/GridViewScreen.tsx', 'src/screens/camera-detail/WorkspaceGrid.tsx']) {
      const src = read(file)
      expect(src, file).toContain('useDeviceSettingsStore((s) => s.settings.overlaySize)')
      expect(src, file).toMatch(/buildTileOverlayMap\([\s\S]*?overlaySize,/)
    }
  })
})
