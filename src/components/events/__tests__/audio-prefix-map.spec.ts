/**
 * Audio prefix-map — the viewer resolver (`useEventKindResolver.resolveAudioIcon`)
 * namespaces a BARE audio-macro id (`dog`, `siren`, `water`) to `audio-<id>`
 * before resolving, because audio events persist the macro id un-namespaced
 * while the taxonomy + glyph dictionary key audio subs under `audio-<id>`.
 *
 * This exercises the pure building blocks that path is built from — `audioKindId`
 * + `resolveEventKindIcon` + `EVENT_KIND_ICONS` — so a bare audio label resolves
 * to the curated AUDIO glyph (never the VIDEO detection sub of the same bare id)
 * and falls back to the audio `Volume2` glyph (not the neutral `Tag`) when unmapped.
 *
 * `lucide-react-native` ships flow-typed sources the node test env can't parse,
 * so the icons are mocked with one stable sentinel per name — identity
 * comparisons (`Droplet` vs `Droplets`, audio vs video) still hold. The mock
 * targets `src/lib/icons.ts`, the app's own re-export module, because that is
 * what every call site imports.
 */
import { describe, it, expect, vi } from 'vitest'

// Every icon name statically imported by `event-kind-icons.ts`. Each maps to a
// distinct sentinel so identity comparisons (`Droplet` vs `Droplets`) hold.
const LUCIDE_NAMES = [
  'Activity', 'TriangleAlert', 'Baby', 'BellRing', 'Bike', 'Bird', 'Bus', 'Car',
  'Cat', 'CircleDot', 'Cog', 'Crosshair', 'Dog', 'DoorOpen', 'Droplet', 'Droplets',
  'Flame', 'Footprints', 'Hammer', 'Laugh', 'Lock', 'Megaphone', 'MessageSquare',
  'Music', 'Package', 'PawPrint', 'Phone', 'Plane', 'Radar', 'Radio', 'Sailboat',
  'ShieldAlert', 'Siren', 'SlidersHorizontal', 'Tag', 'ToggleRight', 'TrainFront',
  'Truck', 'User', 'UserCheck', 'Users', 'Vibrate', 'Volume2', 'VolumeX', 'Wind',
] as const

// Mocks the app's OWN icon module, not the package: every call site imports
// from `src/lib/icons.ts` now (the package barrel bundles 1,747 icon modules),
// so that is the single point this test has to intercept.
vi.mock('../../../lib/icons.js', () =>
  Object.fromEntries(LUCIDE_NAMES.map((name) => [name, { __icon: name }])),
)

const { audioKindId, resolveEventKindIcon, EVENT_KIND_ICONS } = await import(
  '../event-kind-icons.js'
)

describe('audioKindId', () => {
  it('namespaces + lowercases a bare macro id', () => {
    expect(audioKindId('dog')).toBe('audio-dog')
    expect(audioKindId('Glass_Breaking')).toBe('audio-glass_breaking')
  })
})

describe('audio prefix-map (resolveEventKindIcon ∘ audioKindId)', () => {
  it('resolves a bare audio label to the audio glyph', () => {
    // `dog` exists in BOTH namespaces; the audio path goes through `audio-dog`.
    expect(resolveEventKindIcon(audioKindId('dog'))).toBe(EVENT_KIND_ICONS['audio-dog'])
  })

  it('does not collide with the video detection sub of the same bare id', () => {
    // `water`: audio → Droplets, video → Droplet — genuinely different glyphs.
    const audioWater = resolveEventKindIcon(audioKindId('water'))
    expect(audioWater).toBe(EVENT_KIND_ICONS['audio-water'])
    expect(audioWater).not.toBe(EVENT_KIND_ICONS['water'])
  })

  it('rescues a label absent from the video dict via the audio namespace', () => {
    // `glass_breaking` has no VIDEO sub (→ neutral Tag), but a curated audio one.
    expect(resolveEventKindIcon('glass_breaking')).toBe(EVENT_KIND_ICONS['generic'])
    expect(resolveEventKindIcon(audioKindId('glass_breaking'))).toBe(
      EVENT_KIND_ICONS['audio-glass_breaking'],
    )
  })

  it('falls back to the audio Volume2 glyph (not Tag) for an unmapped audio label', () => {
    const unmapped = resolveEventKindIcon(audioKindId('nonsense_xyz'))
    expect(unmapped).toBe(EVENT_KIND_ICONS['audio'])
    expect(unmapped).not.toBe(EVENT_KIND_ICONS['generic'])
  })

  it('covers all 25 audio macro ids with a defined glyph', () => {
    const audioKeys = Object.keys(EVENT_KIND_ICONS).filter((k) => k.startsWith('audio-'))
    expect(audioKeys.length).toBe(25)
    for (const k of audioKeys) expect(EVENT_KIND_ICONS[k]).toBeDefined()
  })
})
