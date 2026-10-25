/**
 * The `clipIncomplete` report crosses SEVEN files between the broker's data
 * channel and the band the operator reads, and six of them are wiring this
 * repo has no renderer for:
 *
 *   broker → `embed/src/playback/recorded-track-session.ts`  (data channel)
 *          → `embed/src/pages/EmbedPlayerPage.tsx`            (emitHost)
 *          → `src/recording/recording-messages.ts`            (ONE validator)
 *          → `src/live/LiveViewWebView.tsx` AND `LiveView.web.tsx`
 *          → `src/screens/CameraDetailScreen.tsx`
 *          → `src/components/camera/theater/TimelineView.tsx`
 *          → `TimelineClipIncompleteNotice` → the sentence.
 *
 * A prop dropped anywhere along that chain is INVISIBLE: the band simply never
 * appears, which is indistinguishable from the silence D623 exists to end.
 * That has already happened twice on this exact chain — `servedProfile`
 * reached the iOS bar and never the web one because the two hosts each spelled
 * their own check, and `clipAudio` was added to the hub and read by nobody for
 * a day — so BOTH hosts are asserted here, by name, rather than one.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the embed half', () => {
  it('the session forwards the report to its host', () => {
    expect(read('embed/src/playback/recorded-track-session.ts')).toContain(
      "msg.t === 'clipIncomplete'",
    )
  })

  it('the player page posts it to the app', () => {
    const page = read('embed/src/pages/EmbedPlayerPage.tsx')
    expect(page).toContain('onClipIncomplete:')
    expect(page).toContain("type: 'clipIncomplete'")
  })
})

describe('the app half — BOTH hosts, because they are two files', () => {
  for (const rel of ['src/live/LiveViewWebView.tsx', 'src/live/LiveView.web.tsx']) {
    it(`${rel} forwards a parsed clipIncomplete`, () => {
      const src = read(rel)
      expect(src).toContain("rec.type === 'clipIncomplete'")
      expect(src).toContain('onClipIncomplete?.(')
    })
  }

  it('the web host goes through the SHARED validator, not a second hand check', () => {
    // The whole reason `coerceRecordingHostMessage` exists. A web host that
    // re-spelled the check is how `servedProfile` shipped on one platform.
    const web = read('src/live/LiveView.web.tsx')
    expect(web).toContain('coerceRecordingHostMessage(')
    expect(web).not.toContain("m.type === 'clipIncomplete'")
  })
})

describe('the screen', () => {
  const SCREEN = read('src/screens/CameraDetailScreen.tsx')

  it('routes the report into the clip stage, which owns the clip identity', () => {
    expect(SCREEN).toContain('onClipIncomplete={clipStage.reportIncomplete}')
  })

  it('hands the RESOLVED notice to the theater, never a second decision', () => {
    expect(SCREEN).toContain('clipIncomplete={clipStage.incompleteNotice}')
    expect(SCREEN).not.toContain('resolveClipIncompleteNotice')
  })
})

describe('the band', () => {
  it('the theater threads the notice down to the one component that draws it', () => {
    expect(read('src/components/camera/theater/TheaterTimeline.tsx')).toContain(
      'clipIncomplete={props.clipIncomplete}',
    )
    expect(read('src/components/camera/theater/TimelineView.tsx')).toContain(
      '<TimelineClipIncompleteNotice',
    )
  })

  it('carries NO retry: a second dial contends for the camera’s single replay slot', () => {
    const band = read('src/components/camera/theater/TimelineClipIncompleteNotice.tsx')
    expect(band).not.toContain('onRetry')
    expect(band).not.toContain('RefreshCw')
  })
})
