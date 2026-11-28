/**
 * The on-demand window's chrome carries no LIVE LOCK.
 *
 * Shipped by accident in 1.0.488: the window composes `TimelinePlaybackBar`
 * verbatim, and the bar's leading control at the live edge is the LIVE badge
 * WITH the lock folded into it. So the overlay inherited a padlock.
 *
 * The lock exists so the theater's operator can browse a timeline while the
 * picture stays where it is — the theater has a preview to browse INTO. This
 * window has a day strip and a picture, nothing else; armed, every press on
 * that strip moves the cursor and leaves the picture behind, with nothing on a
 * 200pt panel to say why. A control that accepts a press and throws the result
 * away is the defect a bar full of absent-vs-disabled rules exists to prevent.
 *
 * Source text, because the claim is about what this surface BINDS. Both halves
 * are asserted: gone here, and still offered where it belongs — or the guard
 * would pass just as well if the lock were deleted from the whole app.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the on-demand overlay binds no live lock', () => {
  const player = read('src/components/camera/OnDemandPlayer.tsx')

  it('passes neither half of the binding — absent, not a false and a no-op', () => {
    expect(player).not.toContain('onToggleLiveLock')
    expect(player).not.toContain('liveLocked')
    expect(player).not.toContain('toggleLiveLock')
  })

  it('still mounts the shared transport row (the row is not what was removed)', () => {
    expect(player).toContain('<TimelinePlaybackBar')
  })
})

describe('and the theater keeps it', () => {
  it('the bar is still bound to a lock where there is something to browse', () => {
    const theater = read('src/components/camera/theater/TheaterTimeline.tsx')
    expect(theater).toContain('onToggleLiveLock')
  })
})

describe('the on-demand overlay never rings a live picture as loading', () => {
  const player = read('src/components/camera/OnDemandPlayer.tsx')

  it('seeds the busy flag from the request, not a blanket true', () => {
    expect(player).not.toContain('const [loading, setLoading] = useState(true)')
    expect(player).toContain('useState(() => onDemandStartsLoading(request))')
  })

  it('clears it on every remount into live (go-live and a camera swap)', () => {
    const goLive = player.slice(player.indexOf('const goLiveNow'), player.indexOf('const sink'))
    expect(goLive).toContain('setLoading(false)')
    expect(player).toContain('setLoading(onDemandStartsLoading(request))')
  })
})

describe('the timeline spans the whole panel', () => {
  const player = read('src/components/camera/OnDemandPlayer.tsx')

  it('lays the bar out at the panel width, and pads the chrome on no side', () => {
    expect(player).toContain('const chromeWidth = onDemandChromeWidth(box)')
    const at = player.indexOf('    chrome: {')
    expect(at).toBeGreaterThan(-1)
    expect(player.slice(at, player.indexOf('},', at))).not.toMatch(/padding(Left|Right|Horizontal)/)
  })

  it('keeps the size grip out of the timeline row (it lives in the header)', () => {
    const header = player.slice(
      player.indexOf('<View style={styles.header}'),
      player.indexOf('<View style={styles.picture}'),
    )
    expect(header).toContain('ondemand-player-resize')
    expect(player.slice(player.indexOf('<TimelineScaleProvider'))).not.toContain('ondemand-player-resize')
  })
})
