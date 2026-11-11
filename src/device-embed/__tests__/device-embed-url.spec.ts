import { describe, expect, it } from 'vitest'
import {
  ADMIN_ACCESS_TOKEN_KEY,
  ADMIN_REFRESH_TOKEN_KEY,
  ADMIN_TOKEN_EXPIRES_KEY,
  buildDeviceEmbedUrl,
  buildSessionSeedScript,
  deviceEmbedLang,
  isDeviceEmbedPath,
  isSameHubOrigin,
} from '../device-embed-url.js'

describe('buildDeviceEmbedUrl', () => {
  it('names the device, the theme and the language — never a token', () => {
    const url = buildDeviceEmbedUrl({ serverUrl: 'https://hub.lan:8443/', deviceId: 42, theme: 'dark', lang: 'it' })
    expect(url).toBe('https://hub.lan:8443/embed/device/42?theme=dark&lang=it')
    expect(url).not.toMatch(/token/i)
  })

  it('keeps a hub mounted under a path', () => {
    expect(buildDeviceEmbedUrl({ serverUrl: 'https://relay.example/p/abc', deviceId: 7, theme: 'light', lang: 'en' })).toBe(
      'https://relay.example/p/abc/embed/device/7?theme=light&lang=en',
    )
  })
})

describe('deviceEmbedLang', () => {
  it('narrows the app language to one the page reads', () => {
    expect(deviceEmbedLang('it')).toBe('it')
    expect(deviceEmbedLang('it-IT')).toBe('it')
    expect(deviceEmbedLang('en-GB')).toBe('en')
    expect(deviceEmbedLang('de')).toBe('en')
  })
})

/** Run the seed script against a stand-in localStorage and return what it left. */
function runSeed(script: string, before: Record<string, string>): Record<string, string> {
  const store = new Map(Object.entries(before))
  const localStorage = {
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  new Function('localStorage', script)(localStorage)
  return Object.fromEntries(store)
}

describe('buildSessionSeedScript', () => {
  const stale = {
    [ADMIN_ACCESS_TOKEN_KEY]: 'old',
    [ADMIN_REFRESH_TOKEN_KEY]: 'old-refresh',
    [ADMIN_TOKEN_EXPIRES_KEY]: '1',
    other: 'kept',
  }

  it('seeds the access token and clears the refresh pair: the viewer owns the refresh', () => {
    expect(runSeed(buildSessionSeedScript('fresh"token'), stale)).toEqual({
      [ADMIN_ACCESS_TOKEN_KEY]: 'fresh"token',
      other: 'kept',
    })
  })

  it('a signed-out viewer leaves no session behind', () => {
    expect(runSeed(buildSessionSeedScript(null), stale)).toEqual({ other: 'kept' })
    expect(runSeed(buildSessionSeedScript(''), stale)).toEqual({ other: 'kept' })
  })
})

describe('isDeviceEmbedPath / isSameHubOrigin', () => {
  it('the card is the card; the sign-in page is not', () => {
    expect(isDeviceEmbedPath('http://hub/embed/device/12?theme=dark')).toBe(true)
    expect(isDeviceEmbedPath('http://hub/p/x/embed/device/12')).toBe(true)
    expect(isDeviceEmbedPath('http://hub/login')).toBe(false)
    expect(isDeviceEmbedPath('not a url')).toBe(false)
  })

  it('only the hub the card came from is followed', () => {
    expect(isSameHubOrigin('http://hub:8080/embed/device/1', 'http://hub:8080')).toBe(true)
    expect(isSameHubOrigin('https://elsewhere.example/', 'http://hub:8080')).toBe(false)
  })
})
