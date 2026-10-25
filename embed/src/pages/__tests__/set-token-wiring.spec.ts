import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Embed player accepts a live `setToken` from the host (D812 residual).
 * Without it a page that booted with a 2 h access token dies when the host
 * renews, because the boot JWT is read once.
 */

// Resolved from this spec, not from cwd: the page lives next to `__tests__`, and a
// cwd-relative path silently pointed at a file that no longer exists (it moved
// from `src/pages/` to `embed/src/pages/`).
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('EmbedPlayerPage setToken surface', () => {
  const src = read('../EmbedPlayerPage.tsx')

  it('advertises the setToken capability', () => {
    expect(src).toContain("'setToken'")
  })

  it('exposes setToken on the page-level command surface', () => {
    expect(src).toContain('setToken: applyToken')
    expect(src).toContain('system.setToken(raw)')
    expect(src).toContain('system.reconnect()')
  })

  it('routes web embed-command setToken to the same handler', () => {
    expect(src).toContain("command.kind === 'setToken'")
  })
})
