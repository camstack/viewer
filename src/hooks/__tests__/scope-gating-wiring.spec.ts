import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The scope gate — the WIRING, pinned at the source.
 *
 * `user-scope.ts` decides what a session may be offered; these are the places
 * that have to ask. The decision and the asking are separately breakable, and
 * only the first half has ordinary unit tests: an edit that deletes
 * `useCanActuate()` from a call site leaves every scope test green while the
 * control comes back for a user the hub will refuse. That failure is invisible
 * in this repo in particular, because vitest runs `node` with no renderer — so
 * the call sites are asserted as source, the style
 * `live/__tests__/mute-ownership-wiring.spec.ts` established.
 *
 * The hidden-vs-disabled rule is checked too. It is the operator's decision and
 * it is the one a later "make it clearer why it's off" instinct quietly
 * reverses: a greyed siren toggle advertises a capability the session does not
 * have and gives them nothing to do about it.
 */

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

describe('PTZ is withheld at BOTH hosts, not only inside the pad', () => {
  it('the single-camera theater folds the gate into hasPtz', () => {
    const src = read('src/screens/CameraDetailScreen.tsx')
    expect(src).toContain("import { useCanActuate } from '../hooks/use-user-scope.js'")
    // Gating `hasPtz` — rather than the panel — is what also removes the
    // toolbar disc that opens it.
    expect(src).toContain('const hasPtz = canActuate && features.includes(FEATURE.ptz)')
  })

  it('the wall computes an EMPTY ptz set, which removes the tile disc and the sheet row', () => {
    const src = read('src/screens/GridViewScreen.tsx')
    expect(src).toContain("import { useCanActuate } from '../hooks/use-user-scope.js'")
    expect(src).toContain('const canActuate = useCanActuate()')
    expect(src).toContain('canActuate\n        ? wallCameras.filter((c) => c.features.includes(FEATURE.ptz)).map((c) => c.id)\n        : []')
  })

  it('the pad itself refuses too, so a THIRD host cannot mount a d-pad that 403s', () => {
    const src = read('src/components/camera/PtzControls.tsx')
    expect(src).toContain('const controllable = hasFeature && canActuate')
    // Passing it to usePtz also stops the query the hub would refuse. Matched
    // up to the comma so the gate stays pinned while the hook is free to take
    // further arguments — it now also takes an `onError`, because `goHome`
    // refuses when no home preset is configured and a swallowed refusal would
    // leave the Home button dead and mute.
    expect(src).toContain('usePtz(deviceId, controllable,')
  })
})

describe('linked-device actions are withheld, read-only rows are kept', () => {
  const src = read('src/components/camera/accessory-controls/AccessoryControl.tsx')

  it('the split is decided by the exhaustive registry map, not per call site', () => {
    expect(src).toContain('isActuatingControlKind')
    expect(src).toContain('const showPrimary = canActuate || !isActuatingControlKind(pick.kind)')
  })

  it('"on motion" counts as an actuator — it writes the auto-activation', () => {
    expect(src).toContain('hasMotionTrigger(device.features) && canActuate')
  })

  it('withholds by rendering nothing, never by disabling', () => {
    expect(src).toContain('showPrimary ? <PrimaryControl device={device} /> : null')
    expect(src).not.toContain('disabled={!canActuate}')
  })
})

describe('destructive per-camera entries need the delete grade', () => {
  const src = read('src/components/camera/CameraViewOptionsSurface.tsx')

  it('the storage + event-store doors are gated, not the panels behind them', () => {
    expect(src).toContain("import { useCanDelete } from '../../hooks/use-user-scope.js'")
    expect(src).toContain('canDelete && onOpenStorage !== undefined && onOpenEventStore !== undefined')
  })

  it('the D62 function switches keep their own admin gate — unchanged', () => {
    // `CameraSwitchGroup` renders null for a non-admin from the inside. Its ONE
    // mount is the composed accessory panel (2026-09-22; this menu no longer
    // duplicates it), and that host must not grow a second, disagreeing gate
    // around it (D62): the `isAdmin` branch there only decides whether the
    // non-admin BADGE is drawn instead, never a gate over the group itself.
    expect(src).not.toContain('CameraSwitchGroup')
    const panel = read('src/components/camera/accessory-panel/CameraAccessoryPanel.tsx')
    expect(panel).toContain('<CameraSwitchGroup deviceId={deviceId} />')
    expect(panel).not.toContain('canOperateSwitches')
  })
})

describe('snooze', () => {
  const src = read('src/screens/notifications/SnoozeTab.tsx')

  it('hides the composer for a session that may not open one', () => {
    expect(src).toContain("import { useCanActuate } from '../../hooks/use-user-scope.js'")
    expect(src).toContain('const canActuate = useCanActuate()')
    expect(src).toContain("{t('v2.nc.snooze.viewOnly')}")
  })

  it('withholds "end now" by omitting the handler, so the button is not drawn', () => {
    expect(src).toContain('canActuate\n                ? { onEnd: () => cancelSnooze.mutate({ snoozeId: snooze.id }) }\n                : {}')
  })

  it('still lists active snoozes — "why am I not being notified" is information', () => {
    expect(src).toContain("<Section title={t('v2.nc.snooze.active')}>")
  })
})

describe('an out-of-scope refusal is logged, never shouted and never a sign-out', () => {
  const src = read('src/app/query-client.ts')

  it('FORBIDDEN is told apart from UNAUTHORIZED at the one place every call passes', () => {
    expect(src).toContain(
      "import { isForbiddenError, reportOutOfScopeCall, setForbiddenHandler, signalForbidden } from '../auth/forbidden.js'",
    )
    expect(src).toContain('if (isForbiddenError(error)) {\n    reportOutOfScopeCall(source, error)\n    signalForbidden()\n  }')
  })

  it('the sign-out path returns before it, so a scope refusal cannot log anyone out', () => {
    expect(src).toContain('if (isUnauthorizedError(error)) {\n    signalUnauthorized()\n    return\n  }')
  })

  it('names the call, so a refusal points at the surface that should have hidden', () => {
    expect(src).toContain('`query ${queryName(query.queryKey)}`')
    expect(src).toContain('`mutation ${mutationName(mutation.options.mutationKey)}`')
  })
})

describe('the empty camera list says WHICH kind of empty it is', () => {
  const src = read('src/screens/CamerasScreen.tsx')

  it('only a CONFIRMED zero-device scope changes the wording', () => {
    expect(src).toContain("import { useUserScope } from '../hooks/use-user-scope.js'")
    expect(src).toContain("t(hasNoViewableDevices ? 'v2.cameras.emptyOutOfScope' : 'v2.cameras.empty')")
  })

  it('both wordings exist in both languages', () => {
    for (const locale of ['locales/en.json', 'locales/it.json']) {
      const json: unknown = JSON.parse(read(locale))
      const v2: unknown = typeof json === 'object' && json !== null ? Reflect.get(json, 'v2') : null
      const cameras: unknown = typeof v2 === 'object' && v2 !== null ? Reflect.get(v2, 'cameras') : null
      const nc: unknown = typeof v2 === 'object' && v2 !== null ? Reflect.get(v2, 'nc') : null
      const snooze: unknown = typeof nc === 'object' && nc !== null ? Reflect.get(nc, 'snooze') : null
      expect(typeof Reflect.get(Object(cameras), 'emptyOutOfScope')).toBe('string')
      expect(typeof Reflect.get(Object(cameras), 'emptyOutOfScopeHint')).toBe('string')
      expect(typeof Reflect.get(Object(snooze), 'viewOnly')).toBe('string')
    }
  })
})
