/**
 * The per-camera FUNCTION SWITCH group, viewer side (D62).
 *
 * Four properties are load-bearing, and each of them has already failed
 * somewhere in this product's history:
 *
 *  1. **The group is rendered GENERICALLY.** The viewer must never enumerate
 *     the switches — the hub gained a sixth (the camera microphone) on
 *     2026-08-07 and will gain more. A client that keys off `id` loses the new
 *     row silently, which is indistinguishable from the function not existing.
 *  2. **`available: false` is never a flippable control.** A toggle that does
 *     nothing tells the operator a feature exists.
 *  3. **The admin gate hides controls, and ONLY controls.** A non-admin must
 *     still be able to see that a camera is quiet on purpose — that is the
 *     whole reason `getCameraSwitches` is `auth: 'view'` while
 *     `setCameraSwitch` is `auth: 'admin'`.
 *  4. **An unreadable group is not an empty group.** Guessing "nothing is off"
 *     is how an operator learns a week later that something was.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applySwitchOptimistic,
  canOperateSwitches,
  isZonelessPrivacyMask,
  parseCameraSwitchGroup,
  switchControlKind,
  switchWarningKey,
  switchedOffIds,
  unavailableReasonKey,
  type CameraSwitchRow,
} from '../camera-switches.js'

/** A row builder — every field explicit, so a test never leans on a default. */
function row(patch: Partial<CameraSwitchRow> & Pick<CameraSwitchRow, 'id'>): CameraSwitchRow {
  return {
    label: `Label for ${patch.id}`,
    costWhenOff: `Off: ${patch.id} stops.`,
    available: true,
    unavailableReason: null,
    enabled: true,
    warning: null,
    ...patch,
  }
}

/**
 * The fake group. It deliberately contains an id NO version of this viewer has
 * ever heard of, alongside the real ones and an unavailable one.
 */
const WIRE_GROUP = {
  deviceId: 101,
  fetchedAt: 1_770_000_000_000,
  switches: [
    {
      id: 'stream-broker',
      label: 'Camera',
      costWhenOff: 'Off: the whole camera stops.',
      available: true,
      enabled: true,
      authority: { kind: 'device-disabled' },
    },
    {
      id: 'object-detection',
      label: 'Object detection & tracking',
      costWhenOff: 'Off: nothing is detected or tracked.',
      available: true,
      enabled: false,
      authority: { kind: 'wrapper-binding', capName: 'detection-pipeline' },
    },
    {
      id: 'audio-analysis',
      label: 'Audio detection & classification',
      costWhenOff: 'Off: no audio is classified.',
      available: false,
      unavailableReason: 'no-provider',
      enabled: true,
      authority: { kind: 'wrapper-binding', capName: 'audio-analysis' },
    },
    // ── The switch from the future. Nothing in the viewer knows this id. ──
    {
      id: 'thermal-analysis',
      label: 'Thermal anomaly detection',
      costWhenOff: 'Off: temperature anomalies are not flagged on this camera.',
      available: true,
      enabled: false,
      authority: { kind: 'wrapper-binding', capName: 'thermal-analysis' },
    },
  ],
}

describe('parseCameraSwitchGroup', () => {
  it('renders a switch id it has never heard of, from the label the hub sent', () => {
    // THE test. The hub added `device-audio` after this client shipped and will
    // add more; if anything here enumerated the ids, this row would vanish and
    // the operator would have no way to know the function existed.
    const group = parseCameraSwitchGroup(WIRE_GROUP)
    expect(group).not.toBeNull()

    const future = group?.switches.find((s) => s.id === 'thermal-analysis')
    expect(future).toBeDefined()
    expect(future?.label).toBe('Thermal anomaly detection')
    expect(future?.costWhenOff).toContain('temperature anomalies')
    // And it is a fully working, flippable row — not a degraded one.
    expect(switchControlKind(future!, true)).toBe('toggle')
    // It counts as switched off exactly like a known id would.
    expect(switchedOffIds(group!.switches)).toContain('thermal-analysis')
  })

  it('keeps the hub’s order rather than imposing one', () => {
    // `CAMERA_SWITCH_ORDER` is a server decision (broadest blast radius first,
    // a source above what consumes it). Re-sorting here would be the viewer
    // quietly disagreeing with it.
    const group = parseCameraSwitchGroup(WIRE_GROUP)
    expect(group?.switches.map((s) => s.id)).toEqual([
      'stream-broker',
      'object-detection',
      'audio-analysis',
      'thermal-analysis',
    ])
  })

  it('an unreadable payload is null — never an empty group', () => {
    // These two must not lead to the same decision: "nothing is off" versus "we
    // could not read it". The second renders a warning; the first renders calm.
    expect(parseCameraSwitchGroup(null)).toBeNull()
    expect(parseCameraSwitchGroup('NOT_FOUND')).toBeNull()
    expect(parseCameraSwitchGroup({ deviceId: 101 })).toBeNull()
    expect(parseCameraSwitchGroup({ switches: [] })).toBeNull()
    // An honestly EMPTY group is a group, and is not null.
    expect(parseCameraSwitchGroup({ deviceId: 101, switches: [] })?.switches).toEqual([])
  })

  it('drops a malformed row without taking the group with it', () => {
    const group = parseCameraSwitchGroup({
      deviceId: 102,
      switches: [
        { id: 'ok', label: 'Ok', costWhenOff: 'cost', available: true, enabled: true },
        { id: 'no-label', costWhenOff: 'cost', available: true, enabled: true },
        { label: 'no id', costWhenOff: 'cost', available: true, enabled: true },
        'garbage',
      ],
    })
    expect(group?.switches.map((s) => s.id)).toEqual(['ok'])
  })
})

describe('availability — never a dead control', () => {
  it('an unavailable switch renders its reason, not a toggle', () => {
    const unavailable = row({ id: 'audio-analysis', available: false, unavailableReason: 'no-provider' })
    // Even for an admin. Availability, not role, decides this one.
    expect(switchControlKind(unavailable, true)).toBe('unavailable')
    expect(switchControlKind(unavailable, false)).toBe('unavailable')
    expect(unavailableReasonKey('no-provider')).toBe('v2.cameraSwitches.unavailableNoProvider')
    expect(unavailableReasonKey('source-unreachable')).toBe('v2.cameraSwitches.unavailableUnreachable')
    expect(unavailableReasonKey('not-configured')).toBe('v2.cameraSwitches.unavailableNotConfigured')
    expect(unavailableReasonKey('device-disabled')).toBe('v2.cameraSwitches.unavailableDeviceDisabled')
  })

  it('says WHICH thing is not set up when the switch is the privacy mask', () => {
    // Every camera on this fleet answers `not-configured` for the privacy mask,
    // because none has a zone drawn. The generic sentence ("nothing is set up
    // for it to act on yet") leaves the operator with no next step, and the
    // next step is not even in this app — the zones live on the camera. Name
    // the missing thing.
    expect(unavailableReasonKey('not-configured', 'privacy-mask')).toBe(
      'v2.cameraSwitches.unavailableNoPrivacyZones',
    )
    // Only that pair. The same reason on another switch keeps the general
    // sentence — inventing per-switch copy for reasons nobody has seen is how
    // a translation file rots.
    expect(unavailableReasonKey('not-configured', 'object-detection')).toBe(
      'v2.cameraSwitches.unavailableNotConfigured',
    )
    // And a privacy mask that is unavailable for a DIFFERENT reason still says
    // that reason: the switch id refines the explanation, it never replaces it.
    expect(unavailableReasonKey('source-unreachable', 'privacy-mask')).toBe(
      'v2.cameraSwitches.unavailableUnreachable',
    )
  })

  it('an unknown unavailable reason still says something', () => {
    // A newer hub can invent a reason. Rendering a gap with no explanation is
    // the state D62 forbids, so there is always a key.
    expect(unavailableReasonKey('quantum-decoherence')).toBe('v2.cameraSwitches.unavailableUnknown')
    expect(unavailableReasonKey(null)).toBe('v2.cameraSwitches.unavailableUnknown')
  })

  it('an unavailable switch is never reported as switched OFF', () => {
    // `enabled` is meaningless when `available` is false — the contract says to
    // read it as true. Nobody turned off a function this install does not have,
    // and badging one would send an operator hunting for a switch that is not
    // there.
    const rows = [
      row({ id: 'a', available: false, unavailableReason: 'source-unreachable', enabled: false }),
      row({ id: 'b', available: true, enabled: false }),
      row({ id: 'c', available: true, enabled: true }),
    ]
    expect(switchedOffIds(rows)).toEqual(['b'])
  })
})

describe('the admin gate', () => {
  it('a non-admin gets no controls at all', () => {
    expect(canOperateSwitches(false)).toBe(false)
    expect(canOperateSwitches(true)).toBe(true)
    expect(switchControlKind(row({ id: 'recording' }), false)).toBe('read-only')
    expect(switchControlKind(row({ id: 'recording' }), true)).toBe('toggle')
  })

  it('but a non-admin can still SEE what is off', () => {
    // The hub publishes `getCameraSwitches` at `auth: 'view'` for exactly this:
    // disabled must never look like broken, for anybody.
    const group = parseCameraSwitchGroup(WIRE_GROUP)
    expect(switchedOffIds(group!.switches)).toEqual(['object-detection', 'thermal-analysis'])
  })
})

describe('the optimistic flip', () => {
  it('returns a NEW group and leaves the old one untouched', () => {
    // The rollback in `onError` is "put the previous object back", which only
    // works because nothing was mutated on the way out.
    const before = parseCameraSwitchGroup(WIRE_GROUP)!
    const after = applySwitchOptimistic(before, 'object-detection', true)

    expect(after).not.toBe(before)
    expect(after.switches.find((s) => s.id === 'object-detection')?.enabled).toBe(true)
    expect(before.switches.find((s) => s.id === 'object-detection')?.enabled).toBe(false)
  })

  it('moves an unknown id exactly like a known one', () => {
    const before = parseCameraSwitchGroup(WIRE_GROUP)!
    const after = applySwitchOptimistic(before, 'thermal-analysis', true)
    expect(after.switches.find((s) => s.id === 'thermal-analysis')?.enabled).toBe(true)
    expect(switchedOffIds(after.switches)).toEqual(['object-detection'])
  })

  it('refuses to move an unavailable row', () => {
    // We would be drawing a state the server is about to reject.
    const before = parseCameraSwitchGroup(WIRE_GROUP)!
    const after = applySwitchOptimistic(before, 'audio-analysis', false)
    expect(after.switches.find((s) => s.id === 'audio-analysis')?.enabled).toBe(true)
    expect(switchedOffIds(after.switches)).toEqual(switchedOffIds(before.switches))
  })
})

// ── Guards. A rule nothing checks has already been broken somewhere. ────────

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC_ROOT = join(HERE, '..', '..')
const REPO_ROOT = join(SRC_ROOT, '..')

/** Every SHIPPED `.ts`/`.tsx` under `src/`. Tests are excluded: a fixture that
 *  names an id is exactly what the test below this one is made of, and nothing
 *  in a spec file reaches an operator. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry)) continue
    out.push(full)
  }
  return out
}

describe('guard: the viewer never enumerates the switches', () => {
  it('no source file mentions a switch id', () => {
    // D62 puts `label` and `costWhenOff` on the wire precisely so this client
    // needs no catalog. The moment a file branches on an id, the next switch
    // the hub adds renders wrong — or not at all — and nobody finds out until
    // an operator reports a function they cannot turn off.
    //
    // These four are unambiguous (`recording` and `notifications` are ordinary
    // words this app uses everywhere, so they are not checked here — the
    // distinctive ones are enough to catch a catalog being reintroduced).
    const ids = ['stream-broker', 'object-detection', 'audio-analysis', 'device-audio']
    const offenders: string[] = []
    for (const file of sourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const id of ids) {
        if (text.includes(`'${id}'`) || text.includes(`"${id}"`)) {
          offenders.push(`${file.slice(SRC_ROOT.length + 1)} → ${id}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('guard: every key the group can render exists in both locales', () => {
  it('resolves every switch-group string in en and it', () => {
    // The group's own copy is the only copy the viewer owns — `label` and
    // `costWhenOff` are server text. A missing key here renders the raw key
    // path to the operator, in the one panel that explains what turning a
    // camera function off costs.
    const keys = [
      'title',
      'loading',
      'readFailed',
      'writeFailed',
      'offBadge',
      'badgeLabel_one',
      'badgeLabel_other',
      'unavailableNoProvider',
      'unavailableUnreachable',
      'unavailableNotConfigured',
      'unavailableNoPrivacyZones',
      'unavailableDeviceDisabled',
      'unavailableUnknown',
      // What `switchWarningKey` can return. These were missing from the list,
      // which is how a warning key ships untranslated: the panel renders the
      // raw path beside a live toggle.
      'warnNoPrivacyZones',
      'warnUnknown',
    ]
    for (const locale of ['en', 'it']) {
      const raw: unknown = JSON.parse(
        readFileSync(join(REPO_ROOT, 'locales', `${locale}.json`), 'utf8'),
      )
      const v2 = (raw as { v2?: { cameraSwitches?: Record<string, unknown> } }).v2
      const group = v2?.cameraSwitches
      expect(group, `${locale}: v2.cameraSwitches missing`).toBeDefined()
      for (const key of keys) {
        expect(typeof group?.[key], `${locale}: v2.cameraSwitches.${key}`).toBe('string')
      }
    }
    // And the five keys `unavailableReasonKey` can return are exactly the
    // five above — proven by construction rather than by reading.
    for (const reason of [
      'no-provider',
      'source-unreachable',
      'not-configured',
      'device-disabled',
      'anything-else',
    ]) {
      expect(unavailableReasonKey(reason).startsWith('v2.cameraSwitches.')).toBe(true)
      expect(unavailableReasonKey(reason, 'privacy-mask').startsWith('v2.cameraSwitches.')).toBe(
        true,
      )
    }
  })
})

describe('the privacy mask with no zone drawn is a LIVE control with a warning', () => {
  const zoneless = row({ id: 'privacy-mask', available: false, enabled: false, unavailableReason: 'not-configured' })

  it('the CURRENT hub says so itself: available, with a warning code', () => {
    // Since @camstack/types 1.2.243 the derivation no longer withholds the
    // control — it sends `available: true` plus `warning`. This is the shape
    // every up-to-date hub produces; the `not-configured` row below is the
    // old one, kept only so this app still works against a stale hub.
    const declared = row({ id: 'privacy-mask', enabled: false, warning: 'no-privacy-zones' })
    expect(isZonelessPrivacyMask(declared)).toBe(true)
    expect(switchControlKind(declared, true)).toBe('toggle')
    expect(switchWarningKey(declared)).toBe('v2.cameraSwitches.warnNoPrivacyZones')
  })

  it('a warning code this app has never heard of still renders SOMETHING', () => {
    const future = row({ id: 'recording', warning: 'some-future-note' })
    expect(switchControlKind(future, true)).toBe('toggle')
    expect(switchWarningKey(future)).toBe('v2.cameraSwitches.warnUnknown')
  })

  it('is offered as a toggle (admin) or read-only (non-admin), never as unavailable', () => {
    // The switch is the entry point to the feature: greying the one button
    // that starts it teaches the operator the feature is broken.
    expect(isZonelessPrivacyMask(zoneless)).toBe(true)
    expect(switchControlKind(zoneless, true)).toBe('toggle')
    expect(switchControlKind(zoneless, false)).toBe('read-only')
    expect(switchWarningKey(zoneless)).toBe('v2.cameraSwitches.warnNoPrivacyZones')
  })

  it('known-empty is not not-yet-known: an unread zone count stays unavailable (D315)', () => {
    const unread = row({ id: 'privacy-mask', available: false, enabled: false, unavailableReason: 'source-unreachable' })
    expect(isZonelessPrivacyMask(unread)).toBe(false)
    expect(switchControlKind(unread, true)).toBe('unavailable')
    expect(switchWarningKey(unread)).toBeNull()
    // And a camera that cannot mask at all is still not offered.
    const cannot = row({ id: 'privacy-mask', available: false, enabled: false, unavailableReason: 'no-provider' })
    expect(switchControlKind(cannot, true)).toBe('unavailable')
  })

  it('only that pair: another switch reporting not-configured keeps the general rule', () => {
    const other = row({ id: 'object-detection', available: false, enabled: false, unavailableReason: 'not-configured' })
    expect(isZonelessPrivacyMask(other)).toBe(false)
    expect(switchControlKind(other, true)).toBe('unavailable')
    expect(switchWarningKey(other)).toBeNull()
    // A normal live row carries no warning.
    expect(switchWarningKey(row({ id: 'recording' }))).toBeNull()
  })

  it('the optimistic flip draws the zoneless mask moving, like any live toggle', () => {
    const group = { deviceId: 1, switches: [zoneless] }
    expect(applySwitchOptimistic(group, 'privacy-mask', true).switches[0]?.enabled).toBe(true)
  })
})
