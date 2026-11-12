import { describe, expect, it } from 'vitest'
import { addonNameOf, formatProviderLabel, integrationNameOf, toProviderRef } from '../device-provider-label.js'

describe('device provider label', () => {
  it('names the integration instance after the addon, and only when it says more', () => {
    expect(formatProviderLabel('Homematic', 'Casa')).toBe('Homematic (Casa)')
    expect(formatProviderLabel('Homematic', null)).toBe('Homematic')
    expect(formatProviderLabel('Homematic', '  ')).toBe('Homematic')
    expect(formatProviderLabel('Homematic', 'Homematic')).toBe('Homematic')
  })

  it('reads the provider off a listAll row, and nothing off a row without an addon', () => {
    expect(toProviderRef({ id: 1, addonId: 'provider-homematic', integrationId: 'i-1' })).toEqual({
      addonId: 'provider-homematic',
      integrationId: 'i-1',
    })
    expect(toProviderRef({ id: 1, addonId: 'provider-homematic' })).toEqual({
      addonId: 'provider-homematic',
      integrationId: null,
    })
    expect(toProviderRef({ id: 1 })).toBeNull()
    expect(toProviderRef(null)).toBeNull()
  })

  it('finds the manifest name, and no name for an addon the hub does not list', () => {
    const list = [{ manifest: { id: 'provider-homematic', name: 'Homematic' } }, { manifest: { id: 'x' } }]
    expect(addonNameOf(list, 'provider-homematic')).toBe('Homematic')
    expect(addonNameOf(list, 'x')).toBeNull()
    expect(addonNameOf(null, 'x')).toBeNull()
    expect(integrationNameOf({ id: 'i-1', name: 'Casa' })).toBe('Casa')
    expect(integrationNameOf(null)).toBeNull()
  })
})
