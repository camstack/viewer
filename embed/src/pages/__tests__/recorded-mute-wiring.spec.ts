import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Recorded audio must obey the host's mute — pinned at the source.
 *
 * Pre-D42 this page had TWO audio paths: the live <video> and a client-side
 * recorded pipeline scheduling PCM into an AudioContext. The recorded path was
 * easy to disconnect from the mute owner silently, and when that wire was
 * absent a muted app entering playback SPOKE — a privacy defect that shipped
 * once without a guard and came back.
 *
 * D42 removed the failure class structurally: recorded audio rides the SAME
 * WebRTC track as live, so the single `muted` prop on the player element is
 * the entire mute surface. What this spec now pins is that the structure
 * STAYS single-path: the one mute owner on the player, and no second
 * client-side audio scheduler creeping back into the page.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const page = readFileSync(path.join(here, '..', 'EmbedPlayerPage.tsx'), 'utf8')

describe('the single mute owner covers every playback mode (D42)', () => {
  it('the player element is muted by the single owner, with no mode conditions', () => {
    expect(page).toContain('muted={muted}')
    // The old dual-surface condition must not return.
    expect(page).not.toContain('muted={muted || ')
  })

  it('no second client-side audio path exists to escape the owner', () => {
    // A recorded audio scheduler (AudioContext PCM feeding) bypasses the
    // <video> mute entirely — that is the exact defect class D42 removed.
    expect(page).not.toContain('AudioContext')
    expect(page).not.toContain('setMuted(mutedRef')
  })

  it('the enforcer sweep still holds the line while the operator wants silence', () => {
    expect(page).toContain("msg: 're-muted'")
  })

  it('…and the sweep is REVERSIBLE — every track it disables, it can re-enable', () => {
    /**
     * The defect: the sweep sets `t.enabled = false` on every audio
     * MediaStreamTrack and **nothing anywhere set it back**. `grep` for
     * `.enabled` in this page returned exactly two hits, the test and the
     * disable.
     *
     * So the silence outlived the request for it. Measured on 1436,
     * 2026-09-23, with the operator's audio icon OFF when the clip opened:
     *
     *   20:23:31.188  first audio RTP sent           Opus, payload 111
     *   20:23:34.664  clip-stream:audio-ready        opus 48000 Hz mono
     *   20:23:34.993  [live-audio] re-muted          corrected: 1
     *   20:23:35.447  clip-stream:first-audio        lateMs 0, droppedLate 0
     *
     * Every layer delivered. Then the operator turned the icon ON, `muted`
     * went false, the sweep stopped and the element un-muted — and the TRACK
     * was still disabled, which is silence whatever the element says. The
     * operator's report was "niente audio dalle clip hik", and it read as a
     * codec or muxing fault for a day.
     *
     * A destructive sweep with no inverse is the bug, not the sweep.
     */
    expect(page).toContain('t.enabled = false')
    expect(page).toContain('t.enabled = true')
  })
})
