import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source guards for the 2026-08-01 overlay-panel audit fixes. The viewer cannot
 * mount a component (see `docs/roadmap.md`), so the wiring is asserted on the
 * source, in the style of `zone-shape-wiring.spec.ts`. Each assertion names the
 * defect it holds shut.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('everything drawn ON the picture is edited by ONE overlay editor', () => {
  // Since 2026-08-02 that editor renders INLINE in the view-options menu: the
  // "Overlay" sub-panel had become the menu's only real content, so the level
  // was dissolved (operator request). The single-editor property the split-out
  // won is kept by keeping the sections ONE component.

  it('the overlay sub-panel is dissolved into the menu, not reachable as a panel', () => {
    // The menu embeds the sections component… (on `CameraViewOptionsSurface`
    // since 2026-08-13: the menu's content moved there when a grid cell became
    // its second host — the theater panel is now only the frame around it.)
    const menu = read('components/camera/CameraViewOptionsSurface.tsx')
    expect(menu).toContain('<OverlaySettingsSections')
    // …and the panel kind is gone, so no wiring can resurrect the extra tap.
    const layout = read('components/camera/theater/timeline-layout.ts')
    expect(layout).not.toContain("| 'overlay'")
    expect(layout).not.toContain("kind: 'overlay'")
    const body = read('components/camera/theater/TimelineBodyPanel.tsx')
    expect(body).not.toContain("case 'overlay'")
  })

  it('the view-options panel does not grow a second border-trigger editor', () => {
    // The duplication that was reported: triggers in the menu, a border switch
    // in the sub-panel, and the sub-panel's switch dead on the WebView player.
    // The trigger rows must arrive ONLY via `OverlaySettingsSections`, next to
    // the switch they gate. Matched on the IMPORTED NAME and the JSX use,
    // never the module path — the panel still imports `ClusterLabelRow` from
    // the same file.
    const src = read('components/camera/CameraViewOptionsSurface.tsx')
    expect(src).not.toMatch(/import\s*\{[^}]*\bHighlightTriggerRows\b[^}]*\}/)
    expect(src).not.toContain('<HighlightTriggerRows')
  })

  it('the overlay sections host the border switch WITH its triggers', () => {
    // The RENDER, not the import — an unused import would satisfy the weaker
    // check while the section shipped empty. (The file keeps the historical
    // `TimelineOverlayPanel` name: `use-discarded-detections.spec.ts` pins the
    // path from outside this directory.)
    const src = read('components/camera/theater/TimelineOverlayPanel.tsx')
    expect(src).toContain('<HighlightTriggerRows')
    expect(src).toContain('config.highlightBorder')
  })

  it('the border toggle reaches the WebView embed too', () => {
    // `enabled: true` was hardcoded, so on the WebView player (which draws its
    // own border) the overlay panel's switch toggled nothing.
    const src = read('screens/CameraDetailScreen.tsx')
    expect(src).toContain('enabled: overlay.highlightBorder')
  })

  it('motion regions and detection boxes stay two LAYERS of one control', () => {
    // Merged once by mistake, and the motion switch looked dead. They are one
    // chip row now — but four independent members of it, never a scale that
    // makes one imply another.
    const src = read('components/camera/theater/TimelineOverlayPanel.tsx')
    expect(src).toContain('<OverlayLayersRow')
    expect(src).toContain('selected={config.layers}')
    expect(src).toContain('toggleLayer(config, layer)')
  })
})

describe('position choices go through ONE picker, inline, never cycled', () => {
  it('no POSITION is edited by a cycling SelectRow', () => {
    // A row that cycles shows one option at a time; a position is a choice
    // among nine, so every position value goes through the SAME picker.
    // The ban used to be file-wide, then had to be narrowed for the box
    // overlay's three-rung scale. That scale is gone — the layers are a
    // checkable SET — so the only cycling rows left in this file are the
    // highlight-trigger ones, and no position may join them.
    const src = read('components/camera/theater/TimelineOverlayPanel.tsx')
    expect(src).toContain('<OverlayPositionPicker')
    const selectRows = src.match(/<SelectRow[\s\S]*?\/>/g) ?? []
    for (const row of selectRows) {
      for (const position of ['audioMeter', 'occupancy']) {
        expect(row).not.toContain(position)
      }
    }
  })

  it('every placeable overlay is edited by the shared placement row', () => {
    // Counting `<OverlayPositionPicker` occurrences was the old assertion; it
    // broke the moment the three identical rows were folded into one
    // `PanelPositionRow`, which is the very deduplication it should reward.
    // Assert the INTENT instead: five placeable overlays, one row shape.
    // The motion pill was retired (the overlay is the motion treatment); the
    // stream stats joined on 2026-10-07 (it was a bare switch), the live
    // viewers count on 2026-10-14.
    const src = read('components/camera/theater/TimelineOverlayPanel.tsx')
    const rows = src.match(/<PanelPositionRow/g) ?? []
    expect(rows.length).toBe(5)
    expect(src).toContain('onChange={(stats) => patch({ stats })}')
    expect(src).toContain('onChange={(viewers) => patch({ viewers })}')
    for (const field of ['audioMeter', 'occupancy', 'deviceInfo']) {
      expect(src).toContain(field)
    }
    expect(src).not.toContain('motionBadge')
  })

  it('the superseded twin pickers are gone, not left as unused files', () => {
    // `AudioMeterPositionPicker` (nine kebab values) and `CornerSelect` (four
    // camelCase values) merged into `OverlayPositionPicker` on 2026-08-02. A
    // leftover twin would read as the right place to add the next position
    // control and split the vocabulary again.
    expect(existsSync(join(SRC, 'components/camera/AudioMeterPositionPicker.tsx'))).toBe(false)
    expect(existsSync(join(SRC, 'components/camera/overlay/CornerSelect.tsx'))).toBe(false)
  })
})

describe('panels opened FROM a panel offer a way back; toolbar panels do not', () => {
  it('exactly the two view-options children receive the back handler', () => {
    // Was three: the overlay panel counted here until 2026-08-02, when it was
    // dissolved into the view-options menu itself. Storage and the event store
    // remain the only panels reached FROM the menu.
    const src = read('components/camera/theater/TimelineBodyPanel.tsx')
    const backs = src.match(/onBack=\{managementBinding\.onBackToViewOptions\}/g) ?? []
    expect(backs).toHaveLength(2)
    // …and no panel invents a different back target.
    const anyBack = src.match(/onBack=\{/g) ?? []
    expect(anyBack).toHaveLength(2)
  })

  it('the host renders the chevron only when a back target exists', () => {
    const src = read('components/camera/theater/TimelinePanelHost.tsx')
    expect(src).toContain("onBack !== undefined ? (")
  })
})

describe('the date panel picks a time within the staged day', () => {
  it('day cells stage; the jump goes through onPick / onPickTime', () => {
    const src = read('components/camera/theater/TimelineDatePanel.tsx')
    expect(src).toContain('onSelectDay={setStagedDayMs}')
    expect(src).toContain('props.onPickTime(h.epoch)')
    expect(src).toContain('props.onPick(effectiveDayMs)')
  })

  it('the timeline seeks the exact epoch for a picked time', () => {
    const src = read('components/camera/theater/TheaterTimeline.tsx')
    expect(src).toContain('onPickTime: handlePickTime')
  })
})

describe('audio highlight is a TOGGLE with three meter rungs behind it', () => {
  it('the trigger editor is a switch plus rungs — not a picker, and no dB', () => {
    // It used to say "offers off/low/mid/high", and that shape is gone (D607):
    // audio was the only one of three triggers that was a four-way picker
    // between two switches. The assertions below survived the change because
    // the rung keys did — which is exactly how a guard ends up vouching for a
    // design nobody has any more, so the missing half is asserted now.
    const src = read('components/camera/HighlightTriggerRows.tsx')
    expect(src).toContain('highlightAudioLow')
    expect(src).toContain('highlightAudioMid')
    expect(src).toContain('highlightAudioHigh')
    expect(src).not.toContain('highlightAudioSensor')
    expect(src).not.toContain('highlightThreshold')
    expect(src).toContain('AUDIO_HIGHLIGHT_HOLD_SEC')
    // The alignment itself: audio takes the same control as its neighbours.
    // `highlightAudioOff` was the picker's own "off" row and is retired — a
    // switch says off by being off.
    expect(src).not.toContain('highlightAudioOff')
  })

  it('the player holds audio for 5s and previews the overlay on pick', () => {
    const src = read('screens/CameraDetailScreen.tsx')
    expect(src).toContain('AUDIO_HIGHLIGHT_HOLD_SEC')
    expect(src).toContain('audioPreviewUntil')
  })
})
