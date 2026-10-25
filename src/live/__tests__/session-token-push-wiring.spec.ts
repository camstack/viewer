import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Session token push into the embed player (D812 residual).
 *
 * The host renews the access token (~2 h); the embed page reads its JWT once
 * from `injectedJavaScriptBeforeContentLoaded` / the iframe handshake. Without
 * a live `setToken` push the WebView keeps the expired JWT and dies after 2 h
 * while the rest of the app keeps working. Guarded as source wiring — same
 * style as `mute-ownership-wiring.spec.ts`.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('renewed access token reaches the embed player (native)', () => {
  const src = read('live/LiveViewWebView.tsx')

  it('advertises the setToken page capability', () => {
    expect(src).toContain("PAGE_CAP_SET_TOKEN = 'setToken'")
  })

  it('pushes setToken onto __camstackEmbedPage when the host token slides', () => {
    expect(src).toContain('__camstackEmbedPage.setToken')
    expect(src).toContain('pushedTokenRef')
  })
})

describe('renewed access token reaches the embed player (web)', () => {
  const src = read('live/LiveView.web.tsx')

  it('posts setToken to the iframe when the host token slides', () => {
    expect(src).toContain("postCommand({ kind: 'setToken', value: token })")
  })
})

describe('PlayerCommand vocabulary names setToken', () => {
  const src = read('live/embed-player-messages.ts')

  it('includes the setToken variant', () => {
    expect(src).toContain("kind: 'setToken'")
  })
})
