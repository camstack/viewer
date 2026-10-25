import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('cursor-aligned cluster activation', () => {
  it('scores the cluster against the raw fixed-cursor epoch', () => {
    const src = read('components/camera/theater/TheaterTimeline.tsx')
    expect(src).toContain("props.mode === 'live' || props.activeEpoch === null")
    expect(src).toContain(': props.activeEpoch')
    expect(src).toContain('buildExpansionMap(clusters, expansionEpoch, zoomIndex)')
    expect(src).not.toContain('expansionAnchorEpochMs')
  })

  it('keeps temporal geometry fixed and uses proximity only as a selection cue', () => {
    const src = read('components/camera/theater/TimelineScroller.tsx')
    // The card's slot is placed from the cluster's own `topPx` and NOTHING
    // else; proximity only decides `selected`. (Both moved into `ClusterSlot`
    // when the list was windowed — the rule did not.)
    expect(src).toContain('top={cluster.topPx + layoutOriginPx}')
    expect(src).toContain("selected={(expansion?.get(cluster.id) ?? 0) >= 0.75}")
    expect(src).not.toContain('transform: [{ scale:')
  })
})

describe('the card: the gallery panel, always open', () => {
  it('has no paging, no gallery toggle and no close button', () => {
    const src = read('components/camera/theater/ClusterCard.tsx')
    for (const gone of ['carouselOpen', 'stepCarousel', 'canStepCarousel', 'onOpenCarousel', 'settings.clusters.carousel']) {
      expect(src, gone).not.toContain(gone)
    }
    expect(src).toContain('paging ?')
    expect(src).toContain('<ScrollView')
    expect(src).toContain('horizontal')
    expect(src).toContain("'transparent'")
    expect(src).toContain('styles.clipBody')
  })

  it('a tap on a thumbnail seeks it, the lens opens the detail on the selected one', () => {
    const src = read('components/camera/theater/ClusterCard.tsx')
    expect(src).toContain('onPress(event)')
    expect(src).toContain('onOpenDetail(activeEvent)')
    expect(src).toContain('const activeEvent = events[Math.max(selectedIndex, 0)]')
    // Playback never drives the panel: no playhead-lit member, no auto-scroll.
    expect(src).not.toContain('activeMemberId')
    expect(src).not.toContain('scrollTo')
  })

  it('the scroller owns (and pulses) the card-level handlers', () => {
    const scroller = read('components/camera/theater/TimelineScroller.tsx')
    expect(scroller).toContain('hapticTap()')
    expect(scroller).not.toContain('ClusterFanOverlay')
    expect(scroller).not.toContain('setFan')
  })
})

describe('the lens and the seek', () => {
  it('the LENS opens the cluster detail DIRECTLY — no intermediate overlay', () => {
    const scroller = read('components/camera/theater/TimelineScroller.tsx')
    expect(scroller).toContain('onOpenDetail(cluster)')
    const timeline = read('components/camera/theater/TheaterTimeline.tsx')
    expect(timeline).toContain('onClusterOpenDetail: clipsMode ? undefined : openClusterDetail')
  })

  it('the timeline seeds the card seek path', () => {
    const timeline = read('components/camera/theater/TheaterTimeline.tsx')
    // The member's start minus the lead (`memberSeekMs`).
    expect(timeline).toContain("onSeek(memberSeekMs(event), 'cluster')")
    expect(timeline).toContain('onClusterPress: onClusterTrackSeek')
    expect(timeline).toContain('enableClusterActions: !clipsMode')
  })
})
