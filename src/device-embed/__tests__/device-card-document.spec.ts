import { afterEach, describe, expect, it } from 'vitest'
import {
  deviceCardCommandScript,
  deviceCardWebViewKey,
} from '../use-device-card-document.js'
import { hiddenDocumentDecision, DEVICE_CARD_DOCUMENT_TTL_MS } from '../use-hidden-device-document.js'
import {
  deviceCardSession,
  dropDeviceCard,
  dropParkedDeviceCard,
  parkDeviceCard,
  presentDeviceCard,
} from '../device-card-session.js'

describe('device card document', () => {
  it('keys the document on the reload nonce alone', () => {
    expect(deviceCardWebViewKey(0)).toBe('device-card:0')
    expect(deviceCardWebViewKey(2)).not.toMatch(/token|embed\/device/)
  })

  it('tells the page to show a device or take a token, as a message event', () => {
    const show = deviceCardCommandScript({ type: 'show-device', deviceId: 23, theme: 'dark', lang: 'en' })
    expect(show).toContain('show-device')
    expect(show).toContain('23')
    expect(show).toContain("new MessageEvent('message'")
    expect(show.endsWith('true;')).toBe(true)
    const token = deviceCardCommandScript({ type: 'set-token', token: 'next' })
    expect(token).toContain('set-token')
    expect(token).toContain('next')
  })

  it('drops a hidden document after the bound or on a memory warning, and keeps a visible one', () => {
    expect(hiddenDocumentDecision(true, DEVICE_CARD_DOCUMENT_TTL_MS, false, DEVICE_CARD_DOCUMENT_TTL_MS)).toBe('drop')
    expect(hiddenDocumentDecision(true, DEVICE_CARD_DOCUMENT_TTL_MS - 1, false, DEVICE_CARD_DOCUMENT_TTL_MS)).toBe(
      'keep',
    )
    expect(hiddenDocumentDecision(true, 0, true, DEVICE_CARD_DOCUMENT_TTL_MS)).toBe('drop')
    expect(hiddenDocumentDecision(false, DEVICE_CARD_DOCUMENT_TTL_MS, true, DEVICE_CARD_DOCUMENT_TTL_MS)).toBe('keep')
  })
})

describe('device card session', () => {
  afterEach(() => {
    dropDeviceCard()
  })

  it('parks a presented card and only drops it once it is parked', () => {
    presentDeviceCard({ deviceId: 7, deviceName: 'Plug', deviceType: 'switch' })
    expect(deviceCardSession()?.phase).toBe('open')
    dropParkedDeviceCard()
    expect(deviceCardSession()?.phase).toBe('open')
    parkDeviceCard()
    expect(deviceCardSession()?.phase).toBe('parked')
    dropParkedDeviceCard()
    expect(deviceCardSession()).toBeNull()
    presentDeviceCard({ deviceId: 8, deviceName: 'Lamp', deviceType: 'light' })
    dropDeviceCard()
    expect(deviceCardSession()).toBeNull()
  })
})
