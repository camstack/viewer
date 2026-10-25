/**
 * The `clipAudio` report crosses SIX files between the broker's data channel
 * and the speaker the operator looks at, and five of them are wiring this repo
 * has no renderer for:
 *
 *   broker → `embed/src/playback/recorded-track-session.ts`  (data channel)
 *          → `embed/src/pages/EmbedPlayerPage.tsx`            (emitHost)
 *          → `src/recording/recording-messages.ts`            (one validator)
 *          → `src/live/LiveViewWebView.tsx` AND `LiveView.web.tsx`
 *          → `src/screens/CameraDetailScreen.tsx`
 *          → `src/components/camera/StreamOverlayControls.tsx` → the disc.
 *
 * A prop dropped anywhere along that chain is INVISIBLE: the badge simply
 * never appears, which is indistinguishable from the state this change exists
 * to end. It is also the exact failure that already happened once on this
 * chain — `servedProfile` reached the iOS bar and never the web one, because
 * the two hosts each spelled their own check — so both hosts are asserted
 * here, by name, rather than one.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the embed half', () => {
  it('the session forwards the report to its host', () => {
    expect(read('embed/src/playback/recorded-track-session.ts')).toContain("msg.t === 'clipAudio'")
  })

  it('the player page posts it to the app', () => {
    const page = read('embed/src/pages/EmbedPlayerPage.tsx')
    expect(page).toContain('onClipAudio:')
    expect(page).toContain("type: 'clipAudio'")
  })
})

describe('the app half — BOTH hosts, because they are two files', () => {
  for (const rel of ['src/live/LiveViewWebView.tsx', 'src/live/LiveView.web.tsx']) {
    it(`${rel} forwards a parsed clipAudio`, () => {
      const src = read(rel)
      expect(src).toContain("rec.type === 'clipAudio'")
      expect(src).toContain('onClipAudio?.(')
    })
  }
})

describe('the screen', () => {
  const SCREEN = read('src/screens/CameraDetailScreen.tsx')

  it('routes the report into the clip stage, which owns the clip identity', () => {
    expect(SCREEN).toContain('onClipAudio={clipStage.reportAudio}')
  })

  it('hands the RESOLVED notice to the disc cluster, not a second decision', () => {
    expect(SCREEN).toContain('audio={clipStage.audioNotice}')
    // The screen must not re-derive the notice: `resolveClipAudioNotice` has
    // one caller and it is the hook that holds the clip id.
    expect(SCREEN).not.toContain('resolveClipAudioNotice')
  })
})

describe('the disc cluster', () => {
  it('passes the notice into the shared builder rather than painting a badge', () => {
    const src = read('src/components/camera/StreamOverlayControls.tsx')
    expect(src).toContain('muteDisc({ muted, onToggleMute, cluster: \'left\', t, audio })')
  })
})
