/**
 * The Settings tab's four segments, and the session memory of the last one.
 */
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  DEFAULT_SETTINGS_SEGMENT,
  SETTINGS_SEGMENT_LABEL_KEYS,
  SETTINGS_SEGMENT_ORDER,
  buildSettingsSegments,
} from '../settings-segments.js'
import { DEVICE_SETTINGS_DEFAULTS, parseDeviceSettings } from '../../../store/device-settings-store.js'

describe('settings segments', () => {
  it('are Account, Viewing, App, Advanced — in that order', () => {
    expect(SETTINGS_SEGMENT_ORDER).toEqual(['account', 'viewing', 'app', 'advanced'])
    expect(DEFAULT_SETTINGS_SEGMENT).toBe('account')
  })

  it('builds one option per segment through t', () => {
    const options = buildSettingsSegments((k) => `T:${k}`)
    expect(options.map((o) => o.value)).toEqual([...SETTINGS_SEGMENT_ORDER])
    expect(options[0]?.label).toBe('T:v2.settings.segments.account')
  })

  it('every label exists in both locales, translated', () => {
    for (const key of SETTINGS_SEGMENT_ORDER) {
      const leaf = SETTINGS_SEGMENT_LABEL_KEYS[key].split('.').pop() ?? ''
      const en: unknown = (enLocale.v2.settings.segments as Record<string, unknown>)[leaf]
      const it: unknown = (itLocale.v2.settings.segments as Record<string, unknown>)[leaf]
      expect(en, `en ${leaf}`).toBeTypeOf('string')
      expect(it, `it ${leaf}`).toBeTypeOf('string')
    }
    // "Account" and "App" are the Italian words too; the other two are not.
    expect(itLocale.v2.settings.segments.viewing).not.toBe(enLocale.v2.settings.segments.viewing)
    expect(itLocale.v2.settings.segments.advanced).not.toBe(enLocale.v2.settings.segments.advanced)
  })
})

describe('the last segment is kept for the session only', () => {
  it('defaults to Account', () => {
    expect(DEVICE_SETTINGS_DEFAULTS.settingsSegment).toBe('account')
    expect(parseDeviceSettings(null).settingsSegment).toBe('account')
  })

  it('a segment an older build stored is not read back', () => {
    expect(parseDeviceSettings(JSON.stringify({ debugMode: false, settingsSegment: 'app' })).settingsSegment).toBe(
      'account',
    )
  })

  it('a stored document keeps its debug switch', () => {
    const parsed = parseDeviceSettings(JSON.stringify({ debugMode: true, settingsSegment: 'network' }))
    expect(parsed).toEqual({ debugMode: true, settingsSegment: 'account', overlaySize: 'medium' })
  })
})
