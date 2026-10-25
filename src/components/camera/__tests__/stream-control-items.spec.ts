/**
 * The stream's own controls — mute, talk, PiP — are DEFINED once.
 *
 * They are needed on two surfaces: the single-camera screen's on-video disc
 * cluster and the on-demand overlay's picture. Before this module each surface
 * would have spelled its own icon/label/active triple, and a second audio
 * button that disagrees with the one that owns the function is worse than no
 * button (D62). So the definition is a pure builder and both surfaces call it;
 * the only thing a surface decides is WHICH CLUSTER the disc lands in.
 *
 * Pure, so the absences are pinned rather than discovered: a camera without
 * two-way audio has no talk disc AT ALL (not a disabled one), and a platform
 * without system PiP has no PiP disc — the exact defect the padlock removal
 * settled, a control that accepts a press and throws the result away.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  muteDisc,
  talkDisc,
  systemPipDisc,
  systemPipSupported,
} from '../stream-control-items.js'
import { Volume2, VolumeX, Mic, MicOff, PictureInPicture2 } from '../../../lib/icons.js'

const t = (key: string, vars?: Record<string, string | number>): string =>
  vars === undefined ? key : `${key}:${JSON.stringify(vars)}`
const noop = (): void => {}

describe('the mute disc', () => {
  it('wears the crossed speaker and is INACTIVE while muted', () => {
    const disc = muteDisc({ muted: true, onToggleMute: noop, cluster: 'left', t })
    expect(disc.icon).toBe(VolumeX)
    expect(disc.active).toBe(false)
    expect(disc.label).toBe('v2.streamBar.unmute')
    expect(disc.id).toBe('mute')
  })

  it('wears the speaker and is ACTIVE once audio is on', () => {
    const disc = muteDisc({ muted: false, onToggleMute: noop, cluster: 'right', t })
    expect(disc.icon).toBe(Volume2)
    expect(disc.active).toBe(true)
    expect(disc.label).toBe('v2.streamBar.mute')
    expect(disc.cluster).toBe('right')
  })
})

describe('the mute disc when the SPEED is what silenced the clip (D621)', () => {
  const LOCALES = ['locales/en.json', 'locales/it.json'] as const

  it('wears the rate as a badge and says so, rather than reading as a fault', () => {
    const disc = muteDisc({
      muted: false,
      onToggleMute: noop,
      cluster: 'left',
      t,
      audio: { kind: 'silent-by-speed', rate: 8 },
    })
    // The badge is the rate, spelled by the ONE rate formatter this app has.
    expect(disc.badge).toBe('8×')
    // A disabled thing must never look broken (D62): the glyph is still the
    // speaker the operator's own mute state chose, and `active` still tracks
    // that and nothing else. The notice adds a word, it does not take the
    // button away or grey it out.
    expect(disc.icon).toBe(Volume2)
    expect(disc.active).toBe(true)
    expect(disc.label).toBe('v2.streamBar.silentBySpeed:{"rate":"8×"}')
  })

  it('keeps the badge while the operator ALSO has it muted — both are true', () => {
    const disc = muteDisc({
      muted: true,
      onToggleMute: noop,
      cluster: 'left',
      t,
      audio: { kind: 'silent-by-speed', rate: 0.25 },
    })
    expect(disc.badge).toBe('0.25×')
    expect(disc.icon).toBe(VolumeX)
    expect(disc.active).toBe(false)
  })

  it('wears NO badge when nothing says the speed silenced anything', () => {
    expect(muteDisc({ muted: false, onToggleMute: noop, cluster: 'left', t }).badge).toBeUndefined()
    expect(
      muteDisc({ muted: false, onToggleMute: noop, cluster: 'left', t, audio: null }).badge,
    ).toBeUndefined()
  })

  it('has the sentence in BOTH locales, and it interpolates the rate', () => {
    for (const rel of LOCALES) {
      const json = JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as {
        v2: { streamBar: Record<string, string> }
      }
      const line = json.v2.streamBar.silentBySpeed
      expect(line, rel).toBeTypeOf('string')
      expect(line, rel).toContain('{{rate}}')
    }
  })
})

describe('the talk disc', () => {
  it('is ABSENT on a camera with no two-way audio — not a disabled disc', () => {
    expect(
      talkDisc({ hasTwoWayAudio: false, talking: false, onToggleTalk: noop, cluster: 'left', t }),
    ).toBeNull()
  })

  it('is the open mic while talking, the crossed mic while not', () => {
    const idle = talkDisc({
      hasTwoWayAudio: true, talking: false, onToggleTalk: noop, cluster: 'left', t,
    })
    expect(idle?.icon).toBe(MicOff)
    expect(idle?.active).toBe(false)
    expect(idle?.label).toBe('v2.streamBar.talkStart')

    const live = talkDisc({
      hasTwoWayAudio: true, talking: true, onToggleTalk: noop, cluster: 'left', t,
    })
    expect(live?.icon).toBe(Mic)
    expect(live?.active).toBe(true)
    expect(live?.label).toBe('v2.streamBar.talkStop')
  })
})

describe('the system PiP disc', () => {
  it('exists only where the platform has system PiP', () => {
    expect(systemPipSupported('ios')).toBe(true)
    expect(systemPipSupported('android')).toBe(false)
    expect(systemPipSupported('web')).toBe(false)
  })

  it('is ABSENT rather than a press that goes nowhere', () => {
    expect(
      systemPipDisc({ supported: false, onStartSystemPip: noop, cluster: 'right', t }),
    ).toBeNull()
  })

  it('is the PiP glyph where it is supported', () => {
    const disc = systemPipDisc({ supported: true, onStartSystemPip: noop, cluster: 'right', t })
    expect(disc?.icon).toBe(PictureInPicture2)
    expect(disc?.label).toBe('v2.streamBar.pip')
    expect(disc?.id).toBe('pip')
  })
})

/**
 * Source text, because the claim is that nothing spells these twice. A second
 * copy would pass every behavioural test above and still be the defect.
 */
describe('both surfaces call the builder rather than spelling a second button', () => {
  const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

  for (const rel of [
    'src/components/camera/StreamOverlayControls.tsx',
    'src/components/camera/OnDemandPlayer.tsx',
  ]) {
    it(`${rel} imports the shared definitions`, () => {
      expect(read(rel)).toContain("from './stream-control-items.js'")
    })

    it(`${rel} builds no audio/talk/PiP glyph of its own`, () => {
      const src = read(rel)
      for (const glyph of ['Volume2', 'VolumeX', 'MicOff', 'PictureInPicture2']) {
        expect(src, glyph).not.toContain(glyph)
      }
    })
  }
})
