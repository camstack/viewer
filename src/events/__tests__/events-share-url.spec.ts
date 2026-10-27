/**
 * The events embed URL contract.
 *
 * Every expectation here is the DECODER's, read off
 * `packages/addon-pipeline/embed/src/embed/events-url-config.ts` in the server
 * repo — not off prose. Four of the param names differ from the config field
 * they set (`cols`/`thumb`/`q`/`page`), which is exactly the kind of thing a
 * builder gets subtly wrong and nobody notices until a link opens with default
 * settings and looks "almost right".
 */
import { describe, it, expect } from 'vitest'
import {
  buildEventsEmbedUrl,
  buildEventsShareUrl,
  encodeEventsFields,
  encodeEventsShareQuery,
  eventsShareParamsSchema,
  DEFAULT_EVENTS_FIELDS,
  DEFAULT_EVENTS_SHARE_PARAMS,
  EVENTS_EMBED_PATH,
  type EventsShareParams,
} from '../../../shared/events/events-share-url.js'

const base: EventsShareParams = {
  view: 'gallery',
  columns: 'auto',
  thumb: 'medium',
  deviceIds: [],
  fields: DEFAULT_EVENTS_FIELDS,
  theme: 'auto',
}

/** Parse a built query the way the decoder does. */
const q = (params: EventsShareParams): URLSearchParams =>
  new URLSearchParams(encodeEventsShareQuery(params))

describe('encodeEventsShareQuery — the fixed gates', () => {
  it('always carries mode=events and the version', () => {
    // An absent `v` makes the decoder treat the URL as "not an events config"
    // and fall through — the link would open blank rather than error.
    const p = q(base)
    expect(p.get('mode')).toBe('events')
    expect(p.get('v')).toBe('1')
  })

  it('uses the decoder spellings, not the config field names', () => {
    const p = q({ ...base, view: 'gallery', columns: 4, thumb: 'large' })
    expect(p.get('cols')).toBe('4')
    expect(p.get('thumb')).toBe('large')
    expect(p.has('columns')).toBe(false)
    expect(p.has('thumbSize')).toBe(false)
  })
})

describe('view-conditional layout params', () => {
  it('emits cols for a gallery and never rows', () => {
    const p = q({ ...base, view: 'gallery', columns: 3, rows: 2 })
    expect(p.get('cols')).toBe('3')
    expect(p.has('rows')).toBe(false)
  })

  it('emits rows for a reel and never cols', () => {
    const p = q({ ...base, view: 'reel', rows: 2, columns: 3 })
    expect(p.get('rows')).toBe('2')
    expect(p.has('cols')).toBe(false)
  })

  it('keeps `auto` literal', () => {
    expect(q({ ...base, columns: 'auto' }).get('cols')).toBe('auto')
  })
})

describe('fields is an ALLOW-LIST', () => {
  it('lists only the keys that are on, in render order', () => {
    expect(
      encodeEventsFields({
        label: true,
        sublabel: false,
        camera: true,
        time: false,
        badges: true,
        importance: false,
      }),
    ).toBe('label,camera,badges')
  })

  it('emits an EMPTY fields= when everything is off, never omits it', () => {
    // Empty means "images only" — a real ask. Omitting the param instead would
    // decode as "unset" and restore every label.
    const p = q({
      ...base,
      fields: {
        label: false,
        sublabel: false,
        camera: false,
        time: false,
        badges: false,
        importance: false,
      },
    })
    expect(p.has('fields')).toBe(true)
    expect(p.get('fields')).toBe('')
  })

  it('emits every default-on field', () => {
    // `importance` is off by default, so a default link does not list it.
    expect(q(base).get('fields')).toBe('label,camera,time,badges')
  })
})

describe('optional filters', () => {
  it('omits devices when the link means "every camera"', () => {
    expect(q(base).has('devices')).toBe(false)
  })

  it('emits a csv of ids when cameras are chosen', () => {
    expect(q({ ...base, deviceIds: [104, 101, 102] }).get('devices')).toBe('104,101,102')
  })

  it('omits an empty class list and an empty search', () => {
    const p = q({ ...base, classes: [], search: '   ' })
    expect(p.has('classes')).toBe(false)
    expect(p.has('q')).toBe(false)
  })

  it('percent-encodes free text but leaves csv commas literal', () => {
    const raw = encodeEventsShareQuery({ ...base, classes: ['person', 'vehicle'], search: 'red car' })
    expect(raw).toContain('classes=person,vehicle')
    expect(raw).toContain('q=red%20car')
  })
})

describe('buildEventsShareUrl', () => {
  const url = buildEventsShareUrl('https://hub:4443/', base, 'tok_abc123')

  it('points at the embed path with the query', () => {
    expect(url.startsWith(`https://hub:4443${EVENTS_EMBED_PATH}?mode=events&v=1`)).toBe(true)
  })

  it('puts the token in the FRAGMENT, never the query', () => {
    // A fragment is not sent to the server: no token in hub access logs, proxy
    // logs or referrers.
    expect(url).toContain('#t=tok_abc123')
    expect(url.split('#')[0]).not.toContain('tok_abc123')
  })

  it('encodes a token that would otherwise truncate the fragment', () => {
    const tricky = buildEventsShareUrl('https://hub:4443', base, 'a#b&c')
    expect(tricky).toContain('#t=a%23b%26c')
  })

  it('does not double the slash on a trailing-slash server URL', () => {
    expect(url).not.toContain('4443//addon')
  })
})

describe('buildEventsEmbedUrl — the IN-APP url', () => {
  it('carries no version and no token', () => {
    // The in-app host supplies the whole config by injection/handshake. A `v=1`
    // here would make the page treat the URL as a config source and then reject
    // it for having no `#t=`.
    const url = buildEventsEmbedUrl('https://hub:4443')
    expect(url).toBe(`https://hub:4443${EVENTS_EMBED_PATH}?mode=events`)
    expect(url).not.toContain('v=1')
    expect(url).not.toContain('#t=')
  })

  it('appends the cache identity when the app supplies one', () => {
    expect(buildEventsEmbedUrl('https://hub:4443', { cacheBust: '1.0.272' })).toContain(
      '&_cb=1.0.272',
    )
  })
})

describe('the params schema refuses what the embed would reject', () => {
  it('accepts the builder defaults', () => {
    expect(eventsShareParamsSchema.safeParse(DEFAULT_EVENTS_SHARE_PARAMS).success).toBe(true)
  })

  it('rejects out-of-range layout values rather than emitting an unopenable link', () => {
    expect(eventsShareParamsSchema.safeParse({ ...base, rows: 9 }).success).toBe(false)
    expect(eventsShareParamsSchema.safeParse({ ...base, columns: 20 }).success).toBe(false)
    expect(eventsShareParamsSchema.safeParse({ ...base, view: 'timeline' }).success).toBe(false)
  })
})

describe('the order is not a link parameter: events are newest first, always', () => {
  it('the params carry no sort, and an old record asking for one is stripped', () => {
    expect(Object.keys(eventsShareParamsSchema.shape)).not.toContain('sort')
    const legacy = eventsShareParamsSchema.parse({ ...base, sort: 'importance' })
    expect(legacy).not.toHaveProperty('sort')
    expect(q(legacy).has('sort')).toBe(false)
  })
})
