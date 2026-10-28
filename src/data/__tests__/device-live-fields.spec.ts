import { describe, it, expect } from 'vitest'
import {
  CAP_STATUS_FIELDS,
  CAP_STATUS_SECTION_ID,
  capStatusToField,
  capStatusToFields,
  parseBindingCapNames,
} from '../use-device-live-fields.js'

/**
 * The readout catalogue's SECOND source: sensor cap `getStatus` slices.
 *
 * The first source (`getDeviceLiveInfoAggregate`) returns NULL for sensor
 * devices — verified against the live hub on 2026-08-01 (`deviceId: 291`,
 * "Indoor Temperature", aggregate `null`; `temperatureSensor.getStatus` →
 * `{ celsius: 41.1, unit: "C" }`, the field the hub has since renamed to `temperature`). The payloads below are those real
 * responses, so this suite fails if the mapping drifts from what the hub
 * actually sends — not from what a fake was seeded with.
 */
describe('cap-status readings become pickable fields', () => {
  it('maps the live hub temperature payload', () => {
    const field = capStatusToField('temperature-sensor', {
      temperature: 41.1,
      lastFetchedAt: 1785596987072,
      unit: 'C',
    })
    expect(field).toMatchObject({
      sectionId: CAP_STATUS_SECTION_ID,
      key: 'temperature-sensor',
      label: 'Temperature',
      value: 41.1,
      unit: 'C', // the live unit wins over the canonical fallback
    })
  })

  it('falls back to the canonical unit when the status carries none', () => {
    // Real hub payloads: humiditySensor(292) → { percent: 16 } with NO unit,
    // pressureSensor(293) → { hpa: 1004.7 } with NO unit.
    expect(capStatusToField('humidity-sensor', { humidity: 16, lastFetchedAt: 1 })).toMatchObject({
      value: 16,
      unit: '%',
    })
    expect(capStatusToField('pressure-sensor', { pressure: 1004.7, lastFetchedAt: 1 })).toMatchObject({
      value: 1004.7,
      unit: 'hPa',
    })
  })

  it('still reads the unit-named fields of a hub that has not been migrated', () => {
    expect(capStatusToField('temperature-sensor', { celsius: 41.1, unit: 'C' })).toMatchObject({
      key: 'temperature-sensor',
      value: 41.1,
    })
    expect(capStatusToField('humidity-sensor', { percent: 16 })).toMatchObject({ value: 16, unit: '%' })
    expect(capStatusToField('battery', { percentage: 64 })).toMatchObject({ value: 64 })
    // The new name wins when a payload carries both.
    expect(capStatusToField('battery', { level: 70, percentage: 64 })).toMatchObject({ value: 70 })
  })

  it('keeps the saved id of a multi-leaf readout across the rename', () => {
    // A saved overlay stores `air-quality-sensor:co2Ppm`; the hub field is now `co2`.
    const rows = capStatusToFields('air-quality-sensor', { co2: 612, voc: 80 })
    expect(rows.map((r) => r.key)).toEqual(['air-quality-sensor:co2Ppm', 'air-quality-sensor:vocPpb'])
    expect(capStatusToFields('air-quality-sensor', { co2Ppm: 612 })[0]?.value).toBe(612)
  })

  it('maps climate-control currentTemp as a multi-leaf cap-status row', () => {
    const rows = capStatusToFields('climate-control', {
      currentTemp: 21.5,
      currentHumidity: 44,
      lastFetchedAt: 1,
    })
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionId: CAP_STATUS_SECTION_ID,
          key: 'climate-control:currentTemp',
          label: 'Current temperature',
          value: 21.5,
        }),
        expect.objectContaining({
          key: 'climate-control:currentHumidity',
          value: 44,
        }),
      ]),
    )
  })

  it('an unknown cap or a payload without its reading maps to nothing', () => {
    expect(capStatusToField('switch', { on: true })).toBeNull()
    expect(capStatusToField('temperature-sensor', { lastFetchedAt: 1 })).toBeNull()
    expect(capStatusToField('temperature-sensor', null)).toBeNull()
  })

  it('every mapped value key matches its cap schema field name', () => {
    // Field names come from camstack-server's *.cap.ts status schemas; a rename
    // there silently empties every chip. Pin the pairs this module relies on.
    expect(CAP_STATUS_FIELDS['temperature-sensor']?.valueKey).toBe('temperature')
    expect(CAP_STATUS_FIELDS['humidity-sensor']?.valueKey).toBe('humidity')
    expect(CAP_STATUS_FIELDS['pressure-sensor']?.valueKey).toBe('pressure')
    expect(CAP_STATUS_FIELDS['ambient-light-sensor']?.valueKey).toBe('illuminance')
    expect(CAP_STATUS_FIELDS['numeric-sensor']?.valueKey).toBe('value')
    expect(CAP_STATUS_FIELDS['enum-sensor']?.valueKey).toBe('value')
    expect(CAP_STATUS_FIELDS.battery?.valueKey).toBe('level')
  })
})

describe('binding parsing', () => {
  it('extracts cap names from a real getBindings payload shape', () => {
    const names = parseBindingCapNames({
      deviceId: 291,
      entries: [
        { capName: 'snapshot', kind: 'wrapped' },
        { capName: 'temperature-sensor', kind: 'native', providerAddonId: 'provider-ecowitt' },
        { notACap: true },
      ],
    })
    expect(names).toEqual(['snapshot', 'temperature-sensor'])
  })

  it('degrades to empty on malformed payloads', () => {
    expect(parseBindingCapNames(null)).toEqual([])
    expect(parseBindingCapNames({ entries: 'nope' })).toEqual([])
  })
})
