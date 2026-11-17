/**
 * @vitest-environment jsdom
 *
 * The playback bar carries NO clip download (operator, 2026-11-17).
 *
 * A download chip beside the loop (#443, #567) widened the bar's trailing side
 * and broke its fit on every layout. Keeping a clip stays where it was before:
 * the Download icon on the clip's card, which opens the one `ClipExportModal`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, cleanup } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import { TimelinePlaybackBar } from '../TimelinePlaybackBar.js'

afterEach(cleanup)

const NOOP = (): void => undefined

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

describe('the playback bar has no clip download', () => {
  it('a held clip draws the loop and no "Save clip" control', () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(TimelinePlaybackBar, {
          mode: 'playback',
          rate: 1,
          paused: false,
          loading: false,
          onTogglePause: NOOP,
          onJogBack: NOOP,
          onJogForward: NOOP,
          onSelectRate: NOOP,
          onGoLive: NOOP,
          clipHeld: true,
          clipLoop: { enabled: true, onToggle: NOOP },
        }),
      ),
    )
    expect(container.querySelector('[aria-label="Save clip"]')).toBeNull()
  })

  it('neither the bar nor the timeline wires a download binding into the bar', () => {
    expect(read('src/components/camera/theater/TimelinePlaybackBar.tsx')).not.toMatch(/clipDownload/)
    expect(read('src/components/camera/theater/TheaterTimeline.tsx')).not.toMatch(/clipDownload:/)
    expect(read('src/components/camera/theater/playback-bar-fit.ts')).not.toMatch(/trailingIcons/)
  })

  it('the clip card keeps its download (the map the cards read survives)', () => {
    expect(read('src/components/camera/theater/TheaterTimeline.tsx')).toMatch(/const clipSaves = useMemo/)
  })
})
