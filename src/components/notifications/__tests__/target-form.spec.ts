import { describe, it, expect } from 'vitest'
import type { TargetKind } from '../../../data/notification-center.js'
import {
  buildInitialConfig,
  buildTargetPayload,
  configFromTarget,
  parseConfigSchema,
  serializeConfig,
  validateConfig,
} from '../target-form.js'

/** Minimal TargetKind fixture with a config schema exercising every field type
 *  the viewer renders (text/password/select/boolean/number), plus a nested
 *  group + sub-tabs container and an unsupported type that must be dropped. */
function makeKind(overrides: Partial<TargetKind> = {}): TargetKind {
  return {
    kind: 'demo',
    label: 'Demo',
    icon: '🔔',
    addonId: 'notifiers',
    supportsDiscovery: false,
    caps: {
      attachments: { mediaTypes: ['image'], mode: 'url', max: 1 },
      actions: 0,
      levels: [],
      format: ['text'],
      clickUrl: false,
      sound: false,
      ttl: false,
      bodyMaxLen: 1000,
    },
    configSchema: {
      sections: [
        {
          id: 'demo',
          title: 'Demo',
          fields: [
            { type: 'text', key: 'endpoint', label: 'Endpoint', required: true },
            { type: 'password', key: 'token', label: 'Token', required: true },
            {
              type: 'select',
              key: 'mode',
              label: 'Mode',
              default: 'html',
              options: [
                { value: 'html', label: 'HTML' },
                { value: 'text', label: 'Text' },
              ],
            },
            { type: 'boolean', key: 'silent', label: 'Silent', default: false },
            { type: 'number', key: 'priority', label: 'Priority', default: 3 },
            { type: 'separator', key: 'sep' },
            {
              type: 'group',
              key: 'grp',
              label: 'Group',
              fields: [{ type: 'text', key: 'nested', label: 'Nested' }],
            },
          ],
        },
      ],
    },
    ...overrides,
  }
}

describe('parseConfigSchema', () => {
  it('flattens sections + group containers and drops unsupported field types', () => {
    const fields = parseConfigSchema(makeKind().configSchema)
    expect(fields.map((f) => f.key)).toEqual([
      'endpoint',
      'token',
      'mode',
      'silent',
      'priority',
      'nested',
    ])
    // separator is a structural field — dropped, not rendered.
    expect(fields.find((f) => f.key === 'sep')).toBeUndefined()
  })

  it('marks password fields secret and required', () => {
    const token = parseConfigSchema(makeKind().configSchema).find((f) => f.key === 'token')
    expect(token?.secret).toBe(true)
    expect(token?.required).toBe(true)
  })

  it('returns an empty list for a malformed schema', () => {
    expect(parseConfigSchema(undefined)).toEqual([])
    expect(parseConfigSchema({})).toEqual([])
    expect(parseConfigSchema({ sections: 'nope' })).toEqual([])
  })
})

describe('buildInitialConfig', () => {
  it('returns a default value for every field in the schema', () => {
    const initial = buildInitialConfig(makeKind())
    expect(initial).toEqual({
      endpoint: '',
      token: '',
      mode: 'html', // field default
      silent: false, // boolean default
      priority: '3', // number default rendered as an input string
      nested: '',
    })
  })

  it('falls back to the first option for a select without an explicit default', () => {
    const kind = makeKind({
      configSchema: {
        sections: [
          {
            id: 's',
            title: 'S',
            fields: [
              {
                type: 'select',
                key: 'mode',
                label: 'Mode',
                options: [
                  { value: 'a', label: 'A' },
                  { value: 'b', label: 'B' },
                ],
              },
            ],
          },
        ],
      },
    })
    expect(buildInitialConfig(kind)).toEqual({ mode: 'a' })
  })
})

describe('validateConfig', () => {
  it('flags each missing required field', () => {
    const result = validateConfig(makeKind(), buildInitialConfig(makeKind()))
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['endpoint', 'token'])
  })

  it('passes once the required fields are filled', () => {
    const values = { ...buildInitialConfig(makeKind()), endpoint: 'https://x', token: 'secret' }
    expect(validateConfig(makeKind(), values)).toEqual({ ok: true, missing: [] })
  })

  it('does not flag a required boolean (false is a valid value)', () => {
    const kind = makeKind({
      configSchema: {
        sections: [
          {
            id: 's',
            title: 'S',
            fields: [{ type: 'boolean', key: 'on', label: 'On', required: true }],
          },
        ],
      },
    })
    expect(validateConfig(kind, { on: false })).toEqual({ ok: true, missing: [] })
  })

  it('keeps a blank required secret when editing (kept server-side)', () => {
    const values = { ...buildInitialConfig(makeKind()), endpoint: 'https://x', token: '' }
    // No keep list → blank secret is flagged (create flow).
    expect(validateConfig(makeKind(), values).missing).toEqual(['token'])
    // With the secret in the keep set → not flagged (edit flow, unchanged secret).
    expect(validateConfig(makeKind(), values, { keepSecretKeys: ['token'] })).toEqual({
      ok: true,
      missing: [],
    })
  })
})

describe('serializeConfig', () => {
  it('coerces numbers, keeps booleans, and omits untouched secrets', () => {
    const values = {
      endpoint: 'https://x',
      token: '', // untouched secret
      mode: 'text',
      silent: true,
      priority: '5',
      nested: '',
    }
    expect(serializeConfig(makeKind(), values)).toEqual({
      endpoint: 'https://x',
      mode: 'text',
      silent: true,
      priority: 5,
      nested: '',
    })
  })

  it('includes a re-typed secret', () => {
    const values = { ...buildInitialConfig(makeKind()), endpoint: 'x', token: 'new-secret' }
    expect(serializeConfig(makeKind(), values).token).toBe('new-secret')
  })
})

describe('configFromTarget', () => {
  it('seeds from stored config but blanks secret fields', () => {
    const kind = makeKind()
    const seeded = configFromTarget(kind, {
      id: 't1',
      name: 'T1',
      kind: 'demo',
      addonId: 'notifiers',
      enabled: true,
      config: { endpoint: 'https://y', token: 'REDACTED', mode: 'text', silent: true, priority: 9 },
    })
    expect(seeded.endpoint).toBe('https://y')
    expect(seeded.token).toBe('') // secret blanked, never round-trips
    expect(seeded.mode).toBe('text')
    expect(seeded.silent).toBe(true)
    expect(seeded.priority).toBe('9')
  })
})

describe('buildTargetPayload', () => {
  it('builds a create payload without any client-set ownerUserId', () => {
    const kind = makeKind()
    const values = { ...buildInitialConfig(kind), endpoint: 'https://x', token: 'secret' }
    const target = buildTargetPayload({ kind, existing: null, name: 'My target', values })
    expect(target.kind).toBe('demo')
    expect(target.addonId).toBe('notifiers')
    expect(target.enabled).toBe(true)
    expect(target.name).toBe('My target')
    expect('ownerUserId' in target.config).toBe(false)
    expect(target.config.endpoint).toBe('https://x')
  })

  it('reuses the id/enabled of the edited target and never resurfaces stored secrets', () => {
    const kind = makeKind()
    const existing = {
      id: 't1',
      name: 'Old',
      kind: 'demo',
      addonId: 'notifiers',
      enabled: false,
      config: { endpoint: 'https://y', token: 'REDACTED', ownerUserId: 'u1' },
    }
    const values = { ...configFromTarget(kind, existing), endpoint: 'https://z' }
    const target = buildTargetPayload({ kind, existing, name: 'New', values })
    expect(target.id).toBe('t1')
    expect(target.enabled).toBe(false)
    expect(target.config.endpoint).toBe('https://z')
    // Untouched secret omitted → server keeps it; client never echoes it back.
    expect('token' in target.config).toBe(false)
    // Ownership is server-derived — never carried from the stored blob.
    expect('ownerUserId' in target.config).toBe(false)
  })
})
