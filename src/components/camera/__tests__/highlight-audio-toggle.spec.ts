/**
 * @vitest-environment jsdom
 *
 * "Il setting dell'audio highlight non è allineato con gli altri."
 *
 * The trigger editor had three controls for three triggers and only two shapes:
 * motion was a switch, detection was a switch with its detail (class chips,
 * hold) revealed underneath, and audio was a FOUR-WAY picker — Off/Low/Mid/High
 * — sitting between them. Audio is now a switch with its level behind it, which
 * is detection's shape, so the panel reads as three peers.
 *
 * The gates:
 *  1. three switches, and the audio one is the MIDDLE row (its position in the
 *     list did not change — only its kind);
 *  2. the level picker exists only while audio is on, exactly as the class
 *     chips exist only while detection is on;
 *  3. an off → on round trip returns to the SAME rung. Nothing migrated, so
 *     the mode is still `'off' | 'sensor' | 'level'` and the rung still lives
 *     in `audioDb`; the switch must therefore leave `audioDb` standing and
 *     read it back, not fall to a default. A stored `'level'` that silently
 *     came back as something else is the failure this pins.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

import '../../../app/i18n.js'
import { mountScreen } from '../../../testing/mount.js'
import { HighlightTriggerRows } from '../HighlightTriggerRows.js'
import { dbfsForAudioUi } from '../audio-level.js'
import { GRID_HIGHLIGHT_DEFAULTS, type GridHighlightSettings } from '../../../store/grid-store.js'

afterEach(cleanup)

interface Mounted {
  readonly root: HTMLElement
  readonly patches: readonly Partial<GridHighlightSettings>[]
}

function mount(highlight: GridHighlightSettings): Mounted {
  const patches: Partial<GridHighlightSettings>[] = []
  const { container } = mountScreen(
    React.createElement(HighlightTriggerRows, {
      highlight,
      onSetHighlight: (p: Partial<GridHighlightSettings>) => patches.push(p),
    }),
  )
  return { root: container, patches }
}

/** The switches, in row order: motion, audio, detection. */
function switches(root: HTMLElement): readonly Element[] {
  return [...root.querySelectorAll('[role="switch"], input[type="checkbox"]')]
}

/** A row (or value) by its exact rendered text. `SelectRow` draws its label and
 *  the CURRENT option; the rest of the list lives in an anchored dropdown that
 *  needs a measured anchor, which jsdom cannot give it. */
function byText(root: HTMLElement, text: string): Element | null {
  return [...root.querySelectorAll('div')].find((el) => el.textContent === text) ?? null
}

const withAudio = (audio: GridHighlightSettings['audio'], audioDb: number): GridHighlightSettings => ({
  ...GRID_HIGHLIGHT_DEFAULTS,
  audio,
  audioDb,
})

describe('audio is a switch, like its neighbours', () => {
  it('three triggers, three switches, audio in the middle', () => {
    const { root, patches } = mount(withAudio('off', GRID_HIGHLIGHT_DEFAULTS.audioDb))
    expect(switches(root)).toHaveLength(3)

    fireEvent.click(switches(root)[1]!)
    // The middle switch is the AUDIO one — it writes the audio mode and
    // nothing else. (Motion and detection write their own booleans.)
    expect(patches).toHaveLength(1)
    expect(patches[0]?.audio).toBe('level')
    expect(patches[0]?.motion).toBeUndefined()
    expect(patches[0]?.detection).toBeUndefined()
  })

  it('the level picker is behind the switch — absent while off, present while on', () => {
    const off = mount(withAudio('off', dbfsForAudioUi('high')))
    // The switch itself is there (positive control); the level row is not.
    expect(byText(off.root, 'On audio')).not.toBeNull()
    expect(byText(off.root, 'Level')).toBeNull()
    cleanup()

    const on = mount(withAudio('level', dbfsForAudioUi('high')))
    expect(byText(on.root, 'Level')).not.toBeNull()
    // …showing the stored rung, which is the value the row reads back.
    expect(byText(on.root, 'High')).not.toBeNull()
  })
})

describe('the rung survives the switch — nothing was migrated', () => {
  it('off pins the rung it was showing, so nothing is left to guess', () => {
    const { root, patches } = mount(withAudio('level', dbfsForAudioUi('high')))
    fireEvent.click(switches(root)[1]!)
    expect(patches[0]?.audio).toBe('off')
    expect(patches[0]?.audioDb).toBe(dbfsForAudioUi('high'))
  })

  it('on comes back to the rung that was stored, not to a default', () => {
    for (const rung of ['low', 'mid', 'high'] as const) {
      const db = dbfsForAudioUi(rung)
      // …as the store holds it after an off: mode moved, `audioDb` did not.
      const { root, patches } = mount(withAudio('off', db))
      fireEvent.click(switches(root)[1]!)
      expect(patches[0]?.audio).toBe('level')
      expect(patches[0]?.audioDb).toBe(db)
      cleanup()
    }
  })

  it("a legacy 'sensor' switches off at the LOWEST rung, and comes back to it", () => {
    // `'sensor'` was binary presence; the `audioDb` beside it (-30) never meant
    // anything, and reading it literally would bring the trigger back at 'mid'.
    const { root, patches } = mount(withAudio('sensor', -30))
    fireEvent.click(switches(root)[1]!)
    expect(patches[0]).toEqual({
      audio: 'off',
      audioDb: dbfsForAudioUi('low'),
      audioHoldSec: 5,
    })
    cleanup()

    // …and from THAT stored state, on is 'low' again.
    const back = mount(withAudio('off', dbfsForAudioUi('low')))
    fireEvent.click(switches(back.root)[1]!)
    expect(back.patches[0]?.audio).toBe('level')
    expect(back.patches[0]?.audioDb).toBe(dbfsForAudioUi('low'))
  })
})
