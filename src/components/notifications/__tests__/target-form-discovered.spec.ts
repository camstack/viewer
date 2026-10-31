import { describe, it, expect } from 'vitest'
import type { TargetKind } from '../../../data/notification-center.js'
import {
  buildInitialConfig,
  discoverReady,
  discoveryConfig,
  optionsFromCandidates,
  parseConfigSchema,
  serializeConfig,
} from '../target-form.js'

function kindWith(fields: readonly unknown[]): TargetKind {
  return {
    kind: 'alexa',
    label: 'Alexa',
    icon: 'speaker',
    addonId: 'import-alexa',
    supportsDiscovery: true,
    caps: {
      attachments: { mediaTypes: [], mode: 'url', max: 0 },
      actions: 0,
      levels: [],
      format: ['text'],
      clickUrl: false,
      sound: false,
      ttl: false,
      bodyMaxLen: 1000,
    },
    configSchema: { sections: [{ id: 's', title: 'S', fields }] },
  }
}

const alexa = kindWith([
  { type: 'broker-select', key: 'brokerId', label: 'Account', brokerKind: 'alexa', required: true },
  {
    type: 'select',
    key: 'deviceId',
    label: 'Speaker',
    options: [],
    discoverOptions: { kind: 'alexa', dependsOn: ['brokerId'] },
  },
])

describe('D981 target form fields', () => {
  it('reads a broker-select and a discovered select from the server schema', () => {
    const [broker, device] = parseConfigSchema(alexa.configSchema)
    expect(broker).toMatchObject({ key: 'brokerId', type: 'broker-select', brokerKind: 'alexa' })
    expect(device).toMatchObject({
      key: 'deviceId',
      type: 'select',
      discover: { kind: 'alexa', dependsOn: ['brokerId'] },
    })
  })

  it('pre-selects nothing', () => {
    expect(buildInitialConfig(alexa)).toEqual({ brokerId: '', deviceId: '' })
  })

  it('asks for options only once every dependsOn field has a value', () => {
    const device = parseConfigSchema(alexa.configSchema)[1]!
    expect(discoverReady(device, { brokerId: '', deviceId: '' })).toBe(false)
    expect(discoverReady(device, { brokerId: '   ' })).toBe(false)
    expect(discoverReady(device, { brokerId: 'b1' })).toBe(true)
  })

  it('a plain select is never "discovered"', () => {
    const plain = parseConfigSchema(
      kindWith([{ type: 'select', key: 'x', label: 'X', options: [{ value: 'a', label: 'A' }] }]).configSchema,
    )[0]!
    expect(plain.discover).toBeUndefined()
    expect(discoverReady(plain, {})).toBe(false)
    expect(buildInitialConfig(kindWith([{ type: 'select', key: 'x', label: 'X', options: [{ value: 'a', label: 'A' }] }]))).toEqual({ x: 'a' })
  })

  it('sends only non-empty scalars to discovery', () => {
    expect(discoveryConfig({ brokerId: 'b1', deviceId: '', n: 3, off: false })).toEqual({
      brokerId: 'b1',
      n: 3,
      off: false,
    })
  })

  it('maps candidates to options by the field key and drops blanks and repeats', () => {
    const options = optionsFromCandidates(
      [
        { suggestedName: 'Kitchen', config: { deviceId: 'd1' } },
        { suggestedName: 'Dup', config: { deviceId: 'd1' } },
        { suggestedName: 'Blank', config: { deviceId: '' } },
        { suggestedName: 'Other', config: { other: 'z' } },
      ],
      'deviceId',
    )
    expect(options).toEqual([{ value: 'd1', label: 'Kitchen' }])
  })

  it('serializes only declared fields: a Mode the schema no longer declares is never sent', () => {
    const out = serializeConfig(alexa, { brokerId: 'b1', deviceId: 'd1', mode: 'announce' })
    expect(out).toEqual({ brokerId: 'b1', deviceId: 'd1' })
  })
})
