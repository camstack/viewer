import { describe, expect, it } from 'vitest'
import { DEFAULT_EVENTS_FIELDS, parseEventsConfig } from '../events-config'
import { DEFAULT_EVENTS_SHARE_PARAMS, encodeEventsShareQuery } from '../../../../shared/events/events-share-url'
import {
  EVENTS_URL_VERSION,
  encodeDeviceNames,
  mergeUrlPatch,
  parseEventsUrlConfig,
  parseEventsUrlPatch,
  readTokenFragment,
} from '../events-url-config'

const ORIGIN = 'https://hub.local:4443'

describe('readTokenFragment', () => {
  it('reads `#t=`', () => {
    expect(readTokenFragment('#t=abc123')).toBe('abc123')
    expect(readTokenFragment('t=abc123')).toBe('abc123')
  })

  it('is null for an absent or empty fragment', () => {
    expect(readTokenFragment('')).toBeNull()
    expect(readTokenFragment('#')).toBeNull()
    expect(readTokenFragment('#other=1')).toBeNull()
    expect(readTokenFragment('#t=')).toBeNull()
  })
})

describe('parseEventsUrlPatch', () => {
  it('returns null when the URL is not an events config at all', () => {
    expect(parseEventsUrlPatch('?mode=events')).toBeNull()
    expect(parseEventsUrlPatch('')).toBeNull()
  })

  it('rejects an unknown version explicitly rather than guessing', () => {
    const result = parseEventsUrlPatch('?v=2')
    expect(result?.ok).toBe(false)
    if (result && !result.ok) expect(result.error).toContain('version')
  })

  it('accepts a bare v=1 as an empty patch', () => {
    const result = parseEventsUrlPatch(`?v=${EVENTS_URL_VERSION}`)
    expect(result).toEqual({ ok: true, patch: {} })
  })

  it('maps every v1 param', () => {
    const result = parseEventsUrlPatch(
      '?v=1&view=gallery&rows=2&cols=4&thumb=large&devices=101,102&classes=person,vehicle' +
        '&q=alice&page=40&max=200&refresh=5000&age=86400000&theme=light',
    )
    expect(result?.ok).toBe(true)
    if (!result?.ok) return
    expect(result.patch).toEqual({
      view: 'gallery',
      rows: 2,
      columns: 4,
      thumbSize: 'large',
      deviceIds: [101, 102],
      classes: ['person', 'vehicle'],
      search: 'alice',
      pageSize: 40,
      maxRows: 200,
      refreshMs: 5000,
      maxAgeMs: 86_400_000,
      theme: 'light',
    })
  })

  it('reads lang as a shipped locale and ignores any other', () => {
    const it = parseEventsUrlPatch('?v=1&lang=it-IT')
    expect(it?.ok && it.patch.locale).toBe('it')
    const unknown = parseEventsUrlPatch('?v=1&lang=xx')
    expect(unknown).toEqual({ ok: true, patch: {} })
  })

  it('reads cols=auto', () => {
    const result = parseEventsUrlPatch('?v=1&cols=auto')
    expect(result?.ok).toBe(true)
    if (result?.ok) expect(result.patch.columns).toBe('auto')
  })

  it('treats `fields` as an ALLOW-LIST', () => {
    const result = parseEventsUrlPatch('?v=1&fields=label,time')
    expect(result?.ok).toBe(true)
    if (result?.ok) {
      expect(result.patch.fields).toEqual({
        label: true,
        sublabel: false,
        camera: false,
        time: true,
        badges: false,
        importance: false,
      })
    }
  })

  it('distinguishes an EMPTY fields= (images only) from an absent one', () => {
    const empty = parseEventsUrlPatch('?v=1&fields=')
    expect(empty?.ok).toBe(true)
    if (empty?.ok) {
      expect(empty.patch.fields).toEqual({
        label: false,
        sublabel: false,
        camera: false,
        time: false,
        badges: false,
        importance: false,
      })
    }
    const absent = parseEventsUrlPatch('?v=1')
    expect(absent?.ok).toBe(true)
    if (absent?.ok) expect(absent.patch.fields).toBeUndefined()
  })

  it('distinguishes an EMPTY devices= (all cameras) from an absent one', () => {
    const empty = parseEventsUrlPatch('?v=1&devices=')
    if (empty?.ok) expect(empty.patch.deviceIds).toEqual([])
    const absent = parseEventsUrlPatch('?v=1')
    if (absent?.ok) expect(absent.patch.deviceIds).toBeUndefined()
  })

  it('fails on an out-of-range value rather than silently clamping', () => {
    const result = parseEventsUrlPatch('?v=1&rows=99')
    expect(result?.ok).toBe(false)
  })

  it('ignores junk csv entries without failing the whole URL', () => {
    const result = parseEventsUrlPatch('?v=1&devices=101,,abc,102')
    expect(result?.ok).toBe(true)
    if (result?.ok) expect(result.patch.deviceIds).toEqual([101, 102])
  })
})

describe('parseEventsUrlConfig', () => {
  it('builds a whole config from params + token + origin', () => {
    const result = parseEventsUrlConfig('?v=1&view=gallery&thumb=small', '#t=jwt-abc', ORIGIN)
    expect(result?.ok).toBe(true)
    if (!result?.ok) return
    expect(result.config.serverUrl).toBe(ORIGIN)
    expect(result.config.token).toBe('jwt-abc')
    expect(result.config.view).toBe('gallery')
    expect(result.config.thumbSize).toBe('small')
    expect(result.config.fields).toEqual(DEFAULT_EVENTS_FIELDS)
  })

  it('is null for a non-events URL', () => {
    expect(parseEventsUrlConfig('?mode=grid', '#t=jwt', ORIGIN)).toBeNull()
  })

  it('is null (not an error) for a v=1 URL with NO token — the host may supply it', () => {
    expect(parseEventsUrlConfig('?v=1&view=reel', '', ORIGIN)).toBeNull()
  })

  it('surfaces a malformed param as an error even with a token', () => {
    const result = parseEventsUrlConfig('?v=1&thumb=huge', '#t=jwt', ORIGIN)
    expect(result?.ok).toBe(false)
  })
})

describe('mergeUrlPatch', () => {
  it('applies URL layout params on top of a handshake config', () => {
    const handshake = parseEventsConfig({ serverUrl: ORIGIN, token: 'jwt', view: 'reel' })
    const merged = mergeUrlPatch(handshake, { view: 'gallery', thumbSize: 'large' })
    expect(merged.ok).toBe(true)
    if (merged.ok) {
      expect(merged.config.view).toBe('gallery')
      expect(merged.config.thumbSize).toBe('large')
      expect(merged.config.token).toBe('jwt')
    }
  })

  it('is a pass-through with no patch or on a failed parse', () => {
    const handshake = parseEventsConfig({ serverUrl: ORIGIN, token: 'jwt' })
    expect(mergeUrlPatch(handshake, null)).toBe(handshake)
    const failed = parseEventsConfig({})
    expect(mergeUrlPatch(failed, { view: 'gallery' })).toBe(failed)
  })
})

describe('names= — the rename dictionary round-trip', () => {
  /**
   * The encoder a HOST uses. Deliberately single-encode (`encodeURIComponent`
   * per name), which is the documented contract — the viewer's builder does
   * exactly this and pointedly did NOT compensate for the parser bug, because
   * a double-encoding workaround would break on the day the parser was fixed.
   */
  function encode(names: Record<string, string>): string {
    return Object.entries(names)
      .map(([id, name]) => `${id}:${encodeURIComponent(name)}`)
      .join(',')
  }

  function roundTrip(names: Record<string, string>): Record<string, string> | undefined {
    const result = parseEventsUrlPatch(`?v=1&names=${encode(names)}`)
    if (result === null || !result.ok) throw new Error('parse failed')
    return result.patch.deviceNames
  }

  it('survives a COMMA in a name', () => {
    // The reported bug: `URLSearchParams.get()` has ALREADY percent-decoded, so
    // splitting its output on ',' cuts the name in half — `Garage, retro`
    // became `Garage` plus a junk entry. Dropping the second decode does not
    // fix it; the value has to be read RAW.
    expect(roundTrip({ '102': 'Garage, retro' })).toEqual({ '102': 'Garage, retro' })
  })

  it('survives a COLON in a name', () => {
    // The separator is the FIRST colon of an entry; an encoded one inside the
    // name (`%3A`) must not be mistaken for it.
    expect(roundTrip({ '101': 'Sala: TV' })).toEqual({ '101': 'Sala: TV' })
  })

  it('survives ACCENTS and non-ASCII', () => {
    expect(roundTrip({ '104': 'Porch posteriore — città' })).toEqual({
      '104': 'Porch posteriore — città',
    })
  })

  it('survives an ampersand, which would otherwise end the param', () => {
    expect(roundTrip({ '104': 'Cortile & Vialetto' })).toEqual({ '104': 'Cortile & Vialetto' })
  })

  it('round-trips a MULTI-camera dictionary with a comma in one name', () => {
    const names = { '102': 'Garage, retro', '101': 'Front door' }
    expect(roundTrip(names)).toEqual(names)
  })

  it('an EMPTY dictionary is an empty dictionary, not absence', () => {
    expect(roundTrip({})).toEqual({})
    const absent = parseEventsUrlPatch('?v=1')
    if (absent === null || !absent.ok) throw new Error('parse failed')
    expect(absent.patch.deviceNames).toBeUndefined()
  })

  it('skips a malformed entry rather than failing the whole link', () => {
    const result = parseEventsUrlPatch('?v=1&names=abc:Nope,101:Front door,noseparator')
    if (result === null || !result.ok) throw new Error('parse failed')
    expect(result.patch.deviceNames).toEqual({ '101': 'Front door' })
  })

  it('encodeDeviceNames is the encoder the parser expects', () => {
    // The exported builder and the parser must agree, or a share link built by
    // this repo would not survive its own parser.
    const names = { '102': 'Garage, retro', '101': 'Front door' }
    const result = parseEventsUrlPatch(`?v=1&names=${encodeDeviceNames(names)}`)
    if (result === null || !result.ok) throw new Error('parse failed')
    expect(result.patch.deviceNames).toEqual(names)
  })

  it('reads names when it is not the first param', () => {
    const result = parseEventsUrlPatch(
      `?v=1&view=gallery&names=${encode({ '101': 'A, B' })}&sort=time`,
    )
    if (result === null || !result.ok) throw new Error('parse failed')
    expect(result.patch.deviceNames).toEqual({ '101': 'A, B' })
    expect(result.patch).not.toHaveProperty('sort')
  })
})

describe('an old link asking for an importance order', () => {
  it('still opens, and the order it asked for is dropped: newest first, always', () => {
    const patch = parseEventsUrlPatch('?v=1&view=gallery&sort=importance')
    if (patch === null || !patch.ok) throw new Error('a legacy sort must not fail the link')
    expect(patch.patch).not.toHaveProperty('sort')
    const whole = parseEventsUrlConfig('?mode=events&v=1&view=gallery&sort=importance', '#t=tok', ORIGIN)
    if (whole === null || !whole.ok) throw new Error('a legacy sort must not fail the link')
    expect(whole.config).not.toHaveProperty('sort')
  })

  it('a junk order value is ignored too, not an error', () => {
    const patch = parseEventsUrlPatch('?v=1&sort=random')
    expect(patch !== null && patch.ok).toBe(true)
  })
})

describe('the viewer tile settings in the link', () => {
  it('are read by the viewer names', () => {
    const parsed = parseEventsUrlPatch('?v=1&tileLabelMode=label&tileDetailCamera=1&tileDetailZone=0')
    expect(parsed?.ok && parsed.patch).toMatchObject({
      tileLabelMode: 'label',
      tileDetailCamera: true,
      tileDetailZone: false,
    })
  })

  it('an absent setting stays unset so the legacy fields decide', () => {
    const parsed = parseEventsUrlPatch('?v=1&fields=label,camera')
    expect(parsed?.ok && parsed.patch.tileLabelMode).toBeUndefined()
    expect(parsed?.ok && parsed.patch.tileDetailCamera).toBeUndefined()
  })

  it('an unknown label mode is refused, not guessed', () => {
    expect(parseEventsUrlPatch('?v=1&tileLabelMode=huge')?.ok).toBe(false)
  })

  it('the share-link builder and the embed parser agree on every name', () => {
    const query = encodeEventsShareQuery({
      ...DEFAULT_EVENTS_SHARE_PARAMS,
      tileLabelMode: 'off',
      tileDetailCamera: true,
      tileDetailZone: false,
    })
    const parsed = parseEventsUrlPatch(`?${query}`)
    expect(parsed?.ok && parsed.patch).toMatchObject({
      tileLabelMode: 'off',
      tileDetailCamera: true,
      tileDetailZone: false,
    })
  })
})
