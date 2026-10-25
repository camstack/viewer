import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const embedRoot = path.join(here, '..', '..')
const player = readFileSync(path.join(here, '..', 'EmbedPlayerPage.tsx'), 'utf8')
const recording = readFileSync(path.join(here, '..', 'EmbedRecordingPage.tsx'), 'utf8')

describe('recorded scrubbing is WebRTC push only', () => {
  it('routes live-player scrub commands only through RecordedTrackSession', () => {
    expect(player).toContain("withSession('scrubStart'")
    expect(player).toContain('current.landFromScrub(deviceId, epochMs, playbackProfile(), dragId)')
    expect(player).toContain("withSession('scrubTo'")
    expect(player).toContain('current.retarget(epochMs, hint)')
    expect(player).toContain("msg: 'pointer move with no open session'")
    expect(player).toContain("emitHost({ type: 'recState', state: 'error' })")

    expect(player).not.toContain('ByteRange')
    expect(player).not.toContain('KeyframeDecoder')
    expect(player).not.toContain('SegmentDirectoryClient')
    expect(player).not.toContain('<canvas')
    expect(player).not.toContain('armPrefetch')
  })

  it('ships playback intent on the always-on playback scope, not the debug scrub scope', () => {
    expect(player).toContain("scope: msg.startsWith('playback:') ? 'playback' : 'scrub'")
    expect(player).toContain("scope: 'playback', msg: 'stats'")
  })

  it('does not let the legacy HLS page invent a scrub engine', () => {
    expect(recording).toContain(
      "const SCRUB_UNAVAILABLE = 'scrub unavailable: no open RecordedTrackSession'",
    )
    expect(recording).toContain("reportScrubUnavailable('scrubStart')")
    expect(recording).toContain("reportScrubUnavailable('scrubTo', epochMs)")
    expect(recording).toContain("reportScrubUnavailable('scrubEnd', epochMs)")
    expect(recording).not.toContain('ByteRange')
    expect(recording).not.toContain('KeyframeDecoder')
    expect(recording).not.toContain('SegmentDirectoryClient')
    expect(recording).not.toContain('<canvas')
  })

  it('removes the obsolete pull-scrub implementation modules', () => {
    for (const relative of [
      'playback/byte-range-source.ts',
      'playback/segment-directory-client.ts',
      'scrub/byte-range-scrub-tier.ts',
      'scrub/keyframe-decoder.ts',
    ]) {
      expect(existsSync(path.join(embedRoot, relative)), relative).toBe(false)
    }
  })
})
