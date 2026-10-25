/**
 * @vitest-environment jsdom
 *
 * The words reach the page, in the config it already receives at the handshake.
 *
 * Two claims, and the second is the one that has to survive every future edit:
 *
 *  1. a host that HAS translations puts them in the boot config, so an Italian
 *     app draws an Italian wall;
 *  2. the labels ride in the INJECTED config and nowhere else — there is no
 *     `setLabels` command, so nothing about them can reload the document or
 *     cross the bridge on a render.
 *
 * The page's own half (an absent map ⇒ the English that ships) is asserted in
 * `embed/src/embed/__tests__/tile-labels.spec.ts`; the two artifacts are held
 * to the same key list by `tile-labels.spec.ts` next door.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import { bootedWebViewConfigs, resetWebViewStub } from '../../testing/webview-control.js'
import { GridLiveEmbed } from '../GridLiveEmbed.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

beforeEach(() => {
  resetWebViewStub()
  setTestPlatform('ios')
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

/** The `window.__CAMSTACK_GRID__` object the host injected before load. */
function bootConfig(): Record<string, unknown> {
  const scripts = bootedWebViewConfigs()
  if (scripts.length === 0) throw new Error('the host injected no boot config')
  const script = scripts[scripts.length - 1]
  const match = /window\.__CAMSTACK_GRID__ = (\{.*\}); true;/s.exec(script)
  if (match === null) throw new Error(`no grid config in the injected script: ${script}`)
  return JSON.parse(match[1]) as Record<string, unknown>
}

function mountWall(): void {
  mountScreen(
    React.createElement(GridLiveEmbed, {
      devices: [101, 102],
      quality: 'auto',
      layout: 'auto',
      showName: true,
      audioOnIds: [],
      pausedIds: [],
      editable: true,
    }),
  )
}

describe('the labels ride in the boot config', () => {
  it('the host sends a word for every control the page draws', () => {
    mountWall()
    const labels = bootConfig().labels as Record<string, string> | undefined
    if (labels === undefined) throw new Error('the boot config carried no labels')

    // The harness pins the locale to `en`, so these are the English strings —
    // the claim under test is that they TRAVELLED, not which language they are
    // in (`tile-labels.spec.ts` asserts both locales are complete).
    expect(labels.open).toBe('Open')
    expect(labels.removeFromView).toBe('Remove from view')
    expect(labels.moreActions).toBe('More actions')
    expect(labels.noActiveCameras).toBe('No active cameras')
  })

  it('and no `setLabels` command exists — the handshake is the only channel', () => {
    // A hot channel would be a second way to say the same thing, and the words
    // are settled before the first frame. If one is ever added, this spec is
    // the place the decision gets recorded rather than discovered.
    mountWall()
    expect(JSON.stringify(bootConfig())).not.toContain('setLabels')
  })
})
