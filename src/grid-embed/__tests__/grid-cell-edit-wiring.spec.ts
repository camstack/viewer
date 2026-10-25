/**
 * The two ends of the per-cell EDIT path that no mount test in this repo can
 * reach, one assertion per defect.
 *
 * `workspace-grid-mount.spec.ts` mounts the native host and proves what happens
 * when a cell asks to leave or to change size. It cannot cover:
 *
 *  1. **`GridLiveEmbed.web.tsx`** — vitest resolves the bare specifier, so the
 *     `.web` twin is never the module under test, and it is the one the
 *     hub-served viewer runs. On web the iframe comes from the hub and the app
 *     from the browser cache, so it is also the half most likely to skew.
 *  2. **`EmbedGridPage.tsx` / `GridTilePlayer.tsx`** — a different bundle, its
 *     own React, its own suite. The controls only exist if the page draws them,
 *     the spans only arrive if the page NAMES the command, and the picture is
 *     only whole if the tile inscribes it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8')

const WEB_HOST = read('src', 'grid-embed', 'GridLiveEmbed.web.tsx')
const NATIVE_HOST = read('src', 'grid-embed', 'GridLiveEmbed.tsx')
const PAGE = read('embed', 'src', 'pages', 'EmbedGridPage.tsx')
const TILE = read('embed', 'src', 'components', 'GridTilePlayer.tsx')

describe('the web host speaks the same edit contract as the native one', () => {
  it('routes a cell that asked to leave, and one that asked to resize', () => {
    for (const host of [WEB_HOST, NATIVE_HOST]) {
      expect(host).toMatch(/case 'tileRemove':/)
      expect(host).toMatch(/case 'tileResize':/)
    }
  })

  it('sends the arrangement only to a page that named the command', () => {
    for (const host of [WEB_HOST, NATIVE_HOST]) {
      expect(host).toMatch(/commands\?\.includes\(GRID_SPANS_COMMAND\)/)
      expect(host).toMatch(/if \(!hotSpans\) return/)
    }
  })

  it('does NOT reload for a page that did not name it', () => {
    // The distinction from `setDevices`, and the reason the two commands have
    // separate rules: an unarranged wall is a CORRECT wall, so blanking every
    // peer to deliver a preference would cost more than the preference. The
    // reload path must belong to the device set alone.
    for (const host of [WEB_HOST, NATIVE_HOST]) {
      const spansEffect = host.slice(host.indexOf('if (!hotSpans) return'))
      expect(spansEffect.slice(0, 300)).not.toContain('setReloadNonce')
    }
  })

  it('serialises the map before deciding to push it', () => {
    // This fires on every frame of a resize drag; identity would cross the
    // bridge on each render of a host that rebuilds the map every time.
    for (const host of [WEB_HOST, NATIVE_HOST]) {
      expect(host).toContain('const spansKey = JSON.stringify(spans ?? {})')
    }
  })
})

describe('the page implements the span command AND declares it', () => {
  it('names it in the ready report', () => {
    expect(PAGE).toMatch(/IMPLEMENTED_COMMANDS: readonly string\[\] = \[[^\]]*'setSpans'/)
  })

  it('routes the inbound command to the API', () => {
    expect(PAGE).toMatch(/case 'setSpans':\s*\n\s*api\.setSpans\(/)
  })

  it('holds the arrangement as STATE, not as a read of the boot config', () => {
    // `config.spans` is what the document booted with and never changes; a page
    // that read it directly would ignore every later push.
    expect(PAGE).toMatch(/useState<WallSpans>\(\(\) => config\.spans \?\? \{\}\)/)
    expect(PAGE).toMatch(/resolveWall\(visibleDevices, box\.w, box\.h, layout, spans\)/)
  })

  it('gives each cell its own span, and only lets cells edit an EDITABLE wall', () => {
    expect(PAGE).toContain('span={spans[String(deviceId)]}')
    expect(PAGE).toContain('editable={config.editable === true}')
  })
})

describe('the cell posts intents and edits nothing itself', () => {
  it('the remove control posts tileRemove', () => {
    expect(PAGE).toMatch(/onRemove=\{\(id\) => postToHost\(tileRemoveMsg\(id\)\)\}/)
    expect(TILE).toContain('onRemove(deviceId)')
  })

  it('the grips post a SPAN, never a rectangle', () => {
    expect(PAGE).toMatch(/onResize=\{\(id, cw, ch\) => postToHost\(tileResizeMsg\(id, cw, ch\)\)\}/)
    // The rule the design extracted and a real defect paid for: dimensions
    // cross this bridge, positions do not. A grip that posted an x/y would be
    // publishing a coordinate in a frame the host does not own.
    expect(TILE).not.toMatch(/tileResizeMsg\([^)]*clientX/)
  })

  it('keeps no optimistic copy of the arrangement', () => {
    // The host owns the map, exactly as it owns the audio and paused sets. A
    // local copy would let a resize the host declined leave a ghost cell.
    expect(TILE).not.toMatch(/useState[^\n]*span/i)
  })

  it('inscribes the picture instead of filling the cell', () => {
    // `object-fit: cover` also fills a 32:9 cell and crops the sides off every
    // frame — the failure the operator ruled out, and the one nobody sees.
    expect(TILE).toContain('fitInside(cellW ?? 0, cellH ?? 0, VIDEO_ASPECT)')
    expect(TILE).toContain('const pictureStyle = measured')
  })
})
