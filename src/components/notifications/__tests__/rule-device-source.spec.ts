/**
 * Which devices a rule's device scope offers, per rule kind.
 *
 * Operator, 2026-09-26: "For sensor rules we don't show the sensors but the
 * cameras" — a device-event rule ("Allagamento", devices [3223, 3229, 3235],
 * sensorKinds [flood]) listed SENSORS the camera-only picker could not offer,
 * so they were not selectable. A kind is offered the devices its rule can
 * actually target.
 *
 * Changed 2026-10-01 (operator ruling): `detection` / `occupancy` / `sound`
 * moved off the plain camera-TYPE list onto `ruleDeviceCompatCapNames`
 * (`@camstack/types`) — the SAME capability table the admin's Devices tab
 * now asks `deviceManager.listDeviceIdsByCaps` for, so a camera with no
 * `detection-pipeline` (or `audio-metrics`) binding is no longer offered for
 * a rule that could never match it.
 *
 * Changed 2026-10-01 (fix round 1, review): a sensor rule's devices are its
 * eventful sensors/controls UNION every camera (`extraCapNames`) — the
 * engine matches a sensor rule scoped to a CAMERA (`rowCameraIds`, D630 §6),
 * so a camera-scoped sensor rule is legitimate and the picker's two
 * `listDeviceIdsByCaps` queries (`ruleDeviceCompatCapQueries`,
 * `@camstack/types` 1.2.281) must both be offered.
 */
import { describe, expect, it } from 'vitest'
import {
  EVENTFUL_CAP_NAMES,
  NC_CAMERA_SCOPE_CAP_NAME,
  NC_RULE_KIND_SPECS,
  ruleEditorSectionsForKind,
} from '@camstack/types/client'
import { ruleDeviceCompatCapQueries } from '@camstack/types'

import { ruleDeviceSource, sensorRuleCapNames } from '../rule-device-source.js'

describe('ruleDeviceSource — the device list a rule kind offers', () => {
  it('a SENSOR rule offers the devices bound to a sensor / control cap, PLUS every camera', () => {
    expect(ruleDeviceSource('sensor', undefined)).toEqual({
      kind: 'caps',
      capNames: EVENTFUL_CAP_NAMES,
      extraCapNames: [NC_CAMERA_SCOPE_CAP_NAME],
      subject: 'sensor',
    })
  })

  it('its sensor kinds narrow the sensor query; the camera query stays untouched', () => {
    expect(ruleDeviceSource('sensor', ['flood'])).toEqual({
      kind: 'caps',
      capNames: ['flood'],
      extraCapNames: [NC_CAMERA_SCOPE_CAP_NAME],
      subject: 'sensor',
    })
  })

  it('matches the union @camstack/types itself says a sensor rule may target', () => {
    const source = ruleDeviceSource('sensor', undefined)
    expect(source.kind).toBe('caps')
    if (source.kind !== 'caps') throw new Error('unreachable')
    expect(ruleDeviceCompatCapQueries('sensor')).toEqual([source.capNames, source.extraCapNames])
  })

  it('a kind names its TAXONOMY id, which is not always the cap name', () => {
    expect(sensorRuleCapNames(['contact', 'lock', 'motion-sensor'])).toEqual(['contact', 'motion', 'lock-control'])
  })

  it('kinds nothing maps never narrow the list into nothing', () => {
    expect(sensorRuleCapNames(['not-a-kind'])).toEqual(EVENTFUL_CAP_NAMES)
    expect(sensorRuleCapNames([])).toEqual(EVENTFUL_CAP_NAMES)
  })

  it('detection and occupancy ask for the detection-pipeline cap, worded as a camera scope', () => {
    for (const kind of ['detection', 'occupancy'] as const) {
      expect(ruleDeviceSource(kind, ['flood'])).toEqual({
        kind: 'caps',
        capNames: ['detection-pipeline'],
        subject: 'camera',
      })
    }
  })

  it('sound asks for the audio-metrics cap, worded as a camera scope', () => {
    expect(ruleDeviceSource('sound', undefined)).toEqual({
      kind: 'caps',
      capNames: ['audio-metrics'],
      subject: 'camera',
    })
  })

  it("sensorKinds never leaks into a non-sensor kind's caps — it is sensor-only narrowing", () => {
    expect(ruleDeviceSource('detection', ['flood'])).toEqual({
      kind: 'caps',
      capNames: ['detection-pipeline'],
      subject: 'camera',
    })
  })

  it('every kind with a Devices section has a deliberate answer', () => {
    const withDevices = NC_RULE_KIND_SPECS.map((spec) => spec.kind).filter((kind) =>
      ruleEditorSectionsForKind(kind).some((section) => section.key === 'devices'),
    )
    expect(withDevices).toEqual(['detection', 'sensor', 'occupancy', 'sound'])
  })

  it('the cap list fits the hub\'s bound (16 names)', () => {
    expect(EVENTFUL_CAP_NAMES.length).toBeLessThanOrEqual(16)
  })
})
