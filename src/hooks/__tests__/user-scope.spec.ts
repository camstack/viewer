import { describe, it, expect } from 'vitest'
import {
  UNKNOWN_SCOPE_VIEW,
  allowsGrade,
  parseUserScope,
  resolveScopeView,
  resolveSessionScopeView,
  type UserScope,
} from '../user-scope.js'

/**
 * The viewer's half of the scope model: what `auth.me.scope` says, and which
 * surfaces that hides.
 *
 * Two rules are tested here and nowhere else:
 *
 *  1. A surface is hidden only on a CONFIRMED denial. An `auth.me` that has not
 *     answered yet, an older hub that carries no `scope`, or a `scope` this
 *     build cannot parse all read as UNKNOWN — and unknown behaves exactly like
 *     today's build. Failing closed on unknown would blank PTZ, linked-device
 *     actions and snooze for EVERY user of a hub that does not send the field,
 *     including hubs with no enforcement to mirror.
 *  2. Admin is the exception, and stays fail-closed: unknown ⇒ not admin, the
 *     rule `useIsAdmin` already shipped.
 */

function scope(patch: Partial<UserScope> = {}): UserScope {
  return {
    isAdmin: false,
    role: 'scoped',
    features: [],
    allDevicesViewable: false,
    viewableDeviceCount: 0,
    device: {
      view: { all: false, deviceCount: 0 },
      create: { all: false, deviceCount: 0 },
      delete: { all: false, deviceCount: 0 },
    },
    system: [],
    capabilities: [],
    addons: [],
    ...patch,
  }
}

function wire(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isAdmin: false,
    allDevicesViewable: true,
    viewableDeviceCount: 12,
    device: {
      view: { all: true, deviceCount: 12 },
      create: { all: false, deviceCount: 3 },
      delete: { all: false, deviceCount: 0 },
    },
    system: ['view'],
    capabilities: [{ name: 'ptz', access: ['view', 'create'] }],
    addons: [{ name: 'pipeline-orchestrator', access: ['view'] }],
    ...patch,
  }
}

describe('parseUserScope', () => {
  it('reads a complete wire scope', () => {
    const parsed = parseUserScope(wire())
    expect(parsed).not.toBeNull()
    expect(parsed?.allDevicesViewable).toBe(true)
    expect(parsed?.viewableDeviceCount).toBe(12)
    expect(parsed?.device.create).toEqual({ all: false, deviceCount: 3 })
    expect(parsed?.system).toEqual(['view'])
    expect(parsed?.capabilities).toEqual([{ name: 'ptz', access: ['view', 'create'] }])
    expect(parsed?.addons).toEqual([{ name: 'pipeline-orchestrator', access: ['view'] }])
  })

  it('returns null for an absent scope — an older hub, not a denial', () => {
    expect(parseUserScope(undefined)).toBeNull()
    expect(parseUserScope(null)).toBeNull()
  })

  it('returns null rather than a half-built scope when a required field is wrong', () => {
    expect(parseUserScope(wire({ isAdmin: 'yes' }))).toBeNull()
    expect(parseUserScope(wire({ viewableDeviceCount: 'many' }))).toBeNull()
    expect(parseUserScope(wire({ device: { view: { all: true, deviceCount: 1 } } }))).toBeNull()
    expect(parseUserScope(wire({ device: 'all' }))).toBeNull()
  })

  it('drops unrecognised access flavours instead of failing the whole scope', () => {
    const parsed = parseUserScope(wire({ system: ['view', 'teleport', 7] }))
    expect(parsed?.system).toEqual(['view'])
  })

  it('drops malformed grants instead of failing the whole scope', () => {
    const parsed = parseUserScope(
      wire({ capabilities: [{ name: 'ptz', access: ['create'] }, { name: 9 }, 'nope'] }),
    )
    expect(parsed?.capabilities).toEqual([{ name: 'ptz', access: ['create'] }])
  })

  it('tolerates a missing grant list (a hub that sends only the device reach)', () => {
    const parsed = parseUserScope(wire({ capabilities: undefined, addons: undefined, system: undefined }))
    expect(parsed?.capabilities).toEqual([])
    expect(parsed?.addons).toEqual([])
    expect(parsed?.system).toEqual([])
  })
})

describe('resolveScopeView — unknown scope behaves like today', () => {
  it('offers every non-admin grade while the hub has not answered', () => {
    const view = resolveScopeView(null)
    expect(view).toEqual(UNKNOWN_SCOPE_VIEW)
    expect(view.known).toBe(false)
    expect(view.canActuate).toBe(true)
    expect(view.canDelete).toBe(true)
  })

  it('still refuses the admin grade — unknown is never admin', () => {
    expect(resolveScopeView(null).isAdmin).toBe(false)
    expect(allowsGrade(resolveScopeView(null), 'admin')).toBe(false)
  })

  it('never claims a device count it does not have, and never reports an empty fleet', () => {
    // `hasNoViewableDevices` drives an empty state that says "nothing is in
    // your access profile". Saying that from a scope we never received would
    // accuse the operator's grants of something the hub never said.
    expect(resolveScopeView(null).hasNoViewableDevices).toBe(false)
  })
})

describe('resolveScopeView — a known scope', () => {
  it('grants everything to an admin regardless of the device reach', () => {
    const view = resolveScopeView(scope({ isAdmin: true }))
    expect(view.isAdmin).toBe(true)
    expect(view.canActuate).toBe(true)
    expect(view.canDelete).toBe(true)
    expect(view.isViewer).toBe(false)
  })

  it('reads actuation from the CREATE reach and deletion from the DELETE reach', () => {
    const view = resolveScopeView(
      scope({
        device: {
          view: { all: true, deviceCount: 9 },
          create: { all: false, deviceCount: 2 },
          delete: { all: false, deviceCount: 0 },
        },
      }),
    )
    expect(view.canActuate).toBe(true)
    expect(view.canDelete).toBe(false)
  })

  it('counts an `all` reach as reach even when the fleet is momentarily empty', () => {
    const view = resolveScopeView(
      scope({
        device: {
          view: { all: true, deviceCount: 0 },
          create: { all: true, deviceCount: 0 },
          delete: { all: false, deviceCount: 0 },
        },
      }),
    )
    expect(view.canActuate).toBe(true)
  })

  it('calls a user with view reach and nothing else a viewer', () => {
    const view = resolveScopeView(
      scope({
        allDevicesViewable: false,
        viewableDeviceCount: 4,
        device: {
          view: { all: false, deviceCount: 4 },
          create: { all: false, deviceCount: 0 },
          delete: { all: false, deviceCount: 0 },
        },
      }),
    )
    expect(view.isViewer).toBe(true)
    expect(view.canActuate).toBe(false)
    expect(view.canDelete).toBe(false)
    expect(view.viewableDeviceCount).toBe(4)
    expect(view.hasNoViewableDevices).toBe(false)
  })

  it('reports an empty fleet only when the hub CONFIRMED zero viewable devices', () => {
    expect(resolveScopeView(scope()).hasNoViewableDevices).toBe(true)
    expect(
      resolveScopeView(scope({ allDevicesViewable: true, viewableDeviceCount: 0 })).hasNoViewableDevices,
    ).toBe(false)
  })
})

describe('resolveSessionScopeView', () => {
  it('reads the scope when the hub sent one', () => {
    const view = resolveSessionScopeView({ isAdmin: false, scope: scope({ viewableDeviceCount: 3 }) })
    expect(view.known).toBe(true)
    expect(view.isViewer).toBe(true)
  })

  it('is unknown before auth.me has answered', () => {
    expect(resolveSessionScopeView(null)).toEqual(UNKNOWN_SCOPE_VIEW)
  })

  it('keeps an admin an admin on a hub that sends no scope at all', () => {
    // `auth.me.isAdmin` predates the scope model. Reading the scope alone here
    // would take the D62 function switches away from the only person who has
    // them — on the hub build where they still work.
    const view = resolveSessionScopeView({ isAdmin: true, scope: null })
    expect(view.isAdmin).toBe(true)
    expect(allowsGrade(view, 'admin')).toBe(true)
    expect(view.known).toBe(false)
  })

  it('leaves a non-admin on such a hub exactly as the build before scopes behaved', () => {
    expect(resolveSessionScopeView({ isAdmin: false, scope: null })).toEqual(UNKNOWN_SCOPE_VIEW)
  })

  it('resolves a disagreement in favour of admin', () => {
    const view = resolveSessionScopeView({ isAdmin: true, scope: scope({ isAdmin: false }) })
    expect(view.isAdmin).toBe(true)
    expect(view.canActuate).toBe(true)
    expect(view.canDelete).toBe(true)
    expect(view.isViewer).toBe(false)
  })
})

describe('allowsGrade', () => {
  const viewer = resolveScopeView(
    scope({
      allDevicesViewable: false,
      viewableDeviceCount: 2,
      device: {
        view: { all: false, deviceCount: 2 },
        create: { all: false, deviceCount: 0 },
        delete: { all: false, deviceCount: 0 },
      },
    }),
  )
  const operator = resolveScopeView(
    scope({
      allDevicesViewable: true,
      viewableDeviceCount: 8,
      device: {
        view: { all: true, deviceCount: 8 },
        create: { all: true, deviceCount: 8 },
        delete: { all: false, deviceCount: 0 },
      },
    }),
  )
  const admin = resolveScopeView(scope({ isAdmin: true }))

  it('never hides a view-grade surface — the server already filtered the list', () => {
    expect(allowsGrade(viewer, 'view')).toBe(true)
    expect(allowsGrade(UNKNOWN_SCOPE_VIEW, 'view')).toBe(true)
  })

  it('hides actuate and delete from a viewer', () => {
    expect(allowsGrade(viewer, 'actuate')).toBe(false)
    expect(allowsGrade(viewer, 'delete')).toBe(false)
    expect(allowsGrade(viewer, 'admin')).toBe(false)
  })

  it('gives an operator actuation but not deletion or admin', () => {
    expect(allowsGrade(operator, 'actuate')).toBe(true)
    expect(allowsGrade(operator, 'delete')).toBe(false)
    expect(allowsGrade(operator, 'admin')).toBe(false)
  })

  it('gives an admin every grade', () => {
    for (const grade of ['view', 'actuate', 'delete', 'admin'] as const) {
      expect(allowsGrade(admin, grade)).toBe(true)
    }
  })
})

describe('parseUserScope — role and features (D921)', () => {
  it('reads a viewer row and its known features, dropping ids this build does not know', () => {
    const parsed = parseUserScope(wire({ role: 'viewer', features: ['retrain', 'teleport', 'retrain', 'scenes'] }))
    expect(parsed?.role).toBe('viewer')
    expect(parsed?.features).toEqual(['retrain', 'scenes'])
  })

  it('gives every non-viewer role no features, whatever the wire says', () => {
    expect(parseUserScope(wire({ role: 'scoped', features: ['retrain'] }))?.features).toEqual([])
    expect(parseUserScope(wire({ isAdmin: true, role: 'admin', features: ['retrain'] }))?.features).toEqual([])
  })

  it('derives the role from isAdmin on a hub older than roles', () => {
    expect(parseUserScope(wire())?.role).toBe('scoped')
    expect(parseUserScope(wire({ isAdmin: true }))?.role).toBe('admin')
    expect(parseUserScope(wire({ role: 'superuser' }))?.role).toBe('scoped')
  })
})
