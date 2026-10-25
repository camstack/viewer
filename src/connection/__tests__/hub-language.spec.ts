import { describe, it, expect, vi, beforeEach } from 'vitest'

import i18n from 'i18next'

import { hubLanguage } from '../hub-language.js'
import { SystemController } from '../system-controller.js'

const { createSystem } = vi.hoisted(() => ({
  createSystem: vi.fn((_config: { getLanguage?: () => string | undefined }) => ({
    serverUrl: 'https://hub:4443',
    switchServerUrl: vi.fn(),
    reconnect: vi.fn(),
    trpcClient: { auth: { me: { query: vi.fn(async () => ({ id: 1 })) } } },
    close: vi.fn(),
  })),
}))
vi.mock('@camstack/sdk', () => ({ createSystem }))

beforeEach(async () => {
  createSystem.mockClear()
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {}, showSupportNotice: false })
})

describe('hubLanguage', () => {
  it('is the two-letter base of the app language, and follows a switch', async () => {
    await i18n.changeLanguage('it-IT')
    expect(hubLanguage()).toBe('it')
    await i18n.changeLanguage('en')
    expect(hubLanguage()).toBe('en')
  })
})

describe('the SDK is created with the language getter', () => {
  it('SystemController hands createSystem a getLanguage that reads the CURRENT language per call', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://hub:4443',
      token: 't',
      candidates: ['https://hub:4443'],
      raceCandidatesImpl: async (urls) => ({
        winner: urls[0] ?? null,
        results: urls.map((url) => ({ url, ok: true, ms: 1, status: 200, error: null })),
      }),
    })
    await ctrl.connect()
    const config = createSystem.mock.calls[0]?.[0]
    expect(typeof config?.getLanguage).toBe('function')
    await i18n.changeLanguage('it')
    expect(config?.getLanguage?.()).toBe('it')
    await i18n.changeLanguage('en')
    expect(config?.getLanguage?.()).toBe('en')
  })
})
