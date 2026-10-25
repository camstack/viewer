import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The battery gate reaches every surface that can DIAL a camera.
 *
 * `battery-stream-gate.ts` is pure and tested, and a pure test cannot see a
 * screen that stopped consulting it — which is the only way this feature can
 * regress, because the regression is invisible from the app: the stream simply
 * starts, exactly as it did before, and a camera somewhere loses charge. The
 * defect has no on-screen symptom at all.
 *
 * Three surfaces mount a live player. All three are checked:
 *
 *   • `CameraDetailScreen` — mounts `LiveView` directly.
 *   • `GridTile` — the Android native wall, one component per cell.
 *   • `GridViewScreen` → `GridLiveEmbed` — iOS + web, where "paused" is a list
 *     of ids seeded into the WebView's injected config.
 *
 * SOURCE guards, for the reason `timeline-faults-wiring.spec.ts` is one: this
 * suite runs in `node` with no renderer, so a `.spec.tsx` would be silently
 * never collected.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const read = (...parts: readonly string[]): string => readFileSync(join(SRC, ...parts), 'utf8')

describe('the single-camera player', () => {
  const screen = read('screens', 'CameraDetailScreen.tsx')

  it('DERIVES the pause instead of latching a boolean', () => {
    // `useState(hasBattery)` would latch `false` on a cold start's first render
    // (the camera list is still empty) and dial the camera anyway.
    expect(screen).toContain('const paused = resolveLivePaused(streamGate)')
    expect(screen).toContain('useState<boolean | null>(null)')
    expect(screen).not.toContain('const [paused, setPaused] = useState(false)')
  })

  it('feeds the gate the three facts, including whether the list ANSWERED', () => {
    expect(screen).toContain('operatorChoice: pauseChoice')
    expect(screen).toContain('cameraKnown,')
    expect(screen).toContain('batteryPowered: hasBattery')
    expect(screen).toContain('known: cam !== undefined')
  })

  it('uses the ORDINARY transports on the hold — no sleeping-specific disc', () => {
    // 2026-08-15 (operator): during the hold the detail showed THREE play
    // buttons — the centre disc, the stream controls' play, and the playback
    // bar's play. The disc and its "sleeping" hint were the duplicate. The
    // gate stays (it decides the mount); the overlay does not.
    expect(screen).not.toContain('BatteryHoldOverlay')
    expect(screen).not.toContain('onStartBatteryStream')
  })

  it('never rings the playback-bar play on a held (playerless) surface', () => {
    // `playerStatus` starts at `connecting` and a held camera never mounts the
    // player — without the `paused` guard the bar's spinner ran forever.
    expect(screen).toContain('!paused && playerStatus.state === \'connecting\'')
  })

  it('the poster is the CACHED snapshot — never the one flag that wakes a camera', () => {
    // `force: true` is the one thing that walks past the hub's battery sleep
    // gate, and it must never appear in the poster path the hold renders. It
    // used to appear exactly once, in the timebar capture menu's snapshot
    // action; that menu and its action were removed on 2026-09-02, so the
    // correct count is now ZERO and this screen can no longer wake a camera at
    // all. `getSnapshotLinks` must still never carry force — a signed public
    // URL cannot wake a camera.
    expect(screen.match(/force: true/g)?.length ?? 0).toBe(0)
    expect(screen).toContain('useSnapshot(deviceId, enabled, POSTER_SNAPSHOT_WIDTH)')
    expect(screen).not.toContain('getSnapshot.query')
    expect(screen).not.toContain('getSnapshotLinks.query')
  })

  it('mounts LiveView through shouldMountLiveView, not `paused && !isRecorded`', () => {
    // That boolean is the 2026-08-23 wake: the first scrub frame is `seeking`
    // (`isRecorded` true) so the player mounted on the live edge, and a gap
    // then kept the live peer. Play is the only wake.
    expect(screen).toContain('shouldMountLiveView(')
    expect(screen).toContain('shouldDialLiveOnGoLive(')
    expect(screen).not.toContain('paused && !isRecorded')
  })
})

describe('the grid', () => {
  it('the native tile runs the same gate per cell, and every consumer reads it', () => {
    const tile = read('components', 'grid', 'GridTile.tsx')
    expect(tile).toContain('resolveLivePaused(tileGate)')
    expect(tile).toContain('isBatteryHold(tileGate)')
    // A consumer left on the raw wall-wide `paused` would keep streaming (or
    // keep subscribing) behind the poster — the wake this prevents.
    expect(tile).toContain('const live = !effectivePaused && camera.online')
    // The snapshot is gated on PAUSED alone since D190: whether the camera is
    // reachable is the hub's business, and the hub has a tile either way. What
    // must never regress is the `effectivePaused` part — a tile that fetches a
    // snapshot while it is live is a second pull on the camera.
    expect(tile).toContain('useSnapshot(camera.id, effectivePaused,')
    expect(tile).toContain('useMotionHighlight(camera.id, !effectivePaused && camera.online)')
    expect(tile).toContain('{effectivePaused ? (')
    expect(tile).toContain('<BatteryHoldOverlay onStart={onStartBatteryTile} compact />')
    // Same trap as the detail screen, different lid: the tap-to-reveal
    // Pressable covers the cell with `absoluteFill`, so the disc must be the
    // LAST child or the press only opens the cell actions.
    const reveal = tile.indexOf('onPress={toggleActions}')
    const disc = tile.indexOf('<BatteryHoldOverlay onStart={onStartBatteryTile} compact />')
    expect(reveal).toBeGreaterThan(-1)
    expect(disc).toBeGreaterThan(reveal)
  })

  it('the embedded wall boots battery tiles paused, so no peer is ever negotiated', () => {
    const grid = read('screens', 'GridViewScreen.tsx')
    expect(grid).toContain('heldTileIds(')
    expect(grid).toContain('pausedIds={embedPausedIds}')
    expect(grid).toContain('toggleTileTransport(')
    // The seed must NOT go through `pausedIds`: that would flip `anyPaused` on
    // a wall nobody paused and blanket-pause the Android native wall.
    expect(grid).toContain('const anyPaused = pausedIds.size > 0')
  })

  it('`pausedIds` is seeded into the injected config, not only pushed after load', () => {
    // A tile that boots live and is paused a moment later has already dialled —
    // and on a battery camera, already woken it.
    const embed = read('grid-embed', 'GridLiveEmbed.tsx')
    const config = embed.indexOf('buildGridEmbedConfig({')
    expect(config).toBeGreaterThan(-1)
    expect(embed.slice(config, embed.indexOf('}),', config))).toContain('pausedIds,')
  })
})

describe('the strings', () => {
  it('exist in BOTH locales — an untranslated key renders as its path', () => {
    for (const locale of ['en', 'it'] as const) {
      const json: unknown = JSON.parse(readFileSync(join(ROOT, 'locales', `${locale}.json`), 'utf8'))
      const v2 = (json as { v2: Record<string, Record<string, unknown>> }).v2
      for (const key of ['holdHint', 'startStreamA11y']) {
        expect(typeof v2.battery[key], `${locale}.v2.battery.${key}`).toBe('string')
      }
    }
  })

  it('the wake press is an ACTION haptic, through the policy', () => {
    const overlay = read('components', 'camera', 'BatteryHoldOverlay.tsx')
    expect(overlay).toContain("import { hapticAction } from '../../lib/haptics.js'")
    expect(overlay).toContain('hapticAction()')
  })
})
