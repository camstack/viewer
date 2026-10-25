import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { embedLogLevel } from '../embed-log-level.js'

/**
 * Live local-record — the wiring, pinned at the source.
 *
 * The clip is the DECODED live picture (what the operator sees), not an archive
 * remux. That means: the rec button lives on the playback bar (outside the
 * video gesture layer), the embed owns MediaRecorder, and the host never
 * reaches for expo-media-library (a native module that would force a store
 * release and break OTA).
 */

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

describe('live capture is a playback-bar control, not a stream overlay', () => {
  it('the rec affordance is drawn by TimelinePlaybackBar', () => {
    const bar = read('src/components/camera/theater/TimelinePlaybackBar.tsx')
    // ONE record control now: the flow it drives comes from the mode
    // (`record-control.ts`), so the bar names neither of the two by hand.
    expect(bar).toContain('RECORD_TEST_ID')
    expect(bar).toContain('RecordControlBinding')
  })

  it('the stream overlay does not grow a second rec button', () => {
    const overlay = read('src/components/camera/StreamOverlayControls.tsx')
    expect(overlay).not.toContain('LiveCapture')
    expect(overlay).not.toContain('onStartCapture')
  })
})

describe('recorded playback census always ships', () => {
  it('the host promotes embed:playback to info and downsamples the 1 Hz probe', () => {
    // Both moved into the router both hosts share (`embed-log-route.ts`, whose
    // spec drives the throttle by value). Assert the delegation and the rule's
    // answer, not the text of a condition.
    const router = read('src/live/embed-log-route.ts')
    expect(router).toContain("embedLogLevel(rec.scope) === 'info'")
    expect(embedLogLevel('playback')).toBe('info')
    expect(router).toContain('PLAYBACK_CENSUS_MIN_INTERVAL_MS')
    for (const host of ['src/live/LiveViewWebView.tsx', 'src/live/LiveView.web.tsx']) {
      expect(read(host)).toContain('new EmbedLogRouter(')
    }
  })
})

describe('the embed records decoded pixels, not the RTC video track', () => {
  const page = read('embed/src/pages/EmbedPlayerPage.tsx')
  const capture = read('embed/src/live/live-capture.ts')

  it('exposes start/stop on the host command surface', () => {
    expect(page).toContain('startLiveCapture')
    expect(page).toContain('stopLiveCapture')
  })

  it('captures the <video> element (decoded), never cloned RTC video tracks', () => {
    expect(page).toContain('startLiveCapture')
    expect(page).not.toContain('getVideoTracks().map')
    expect(page).not.toContain('pc.getReceivers')
  })

  it('mixes cloned srcObject AUDIO onto the decoded capture (mute-safe)', () => {
    expect(capture).toContain('captureRecorderTracks')
    expect(capture).toContain('srcObject')
  })
})

describe('the host share path stays OTA-safe', () => {
  const screen = read('src/screens/CameraDetailScreen.tsx')

  it('writes the clip to the cache and opens the share sheet', () => {
    expect(screen).toContain('stopLiveCapture')
    expect(screen).toContain('Sharing.shareAsync')
    expect(screen).not.toContain('expo-media-library')
  })

  it('an INTERRUPTED capture is offered, Discard or Share only — no gallery', () => {
    // The normal ending is now the bar's own Keep/Discard pair. This prompt
    // survives for the captures the operator did NOT stop — a pause, a wall, a
    // trip into the archive — where bytes exist and nobody has said what to do
    // with them.
    const start = screen.indexOf('const promptKeepLiveClip')
    expect(start).toBeGreaterThan(0)
    const end = screen.indexOf('const startLiveCapture')
    expect(end).toBeGreaterThan(start)
    const prompt = screen.slice(start, end)
    expect(prompt).toContain("t('v2.theater.discardClip')")
    expect(prompt).toContain("t('v2.theater.shareClip')")
    expect(prompt).not.toContain("t('v2.theater.saveToGallery')")
    expect(prompt).not.toContain("t('common.save')")
  })
})
