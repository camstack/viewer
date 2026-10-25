/**
 * user-scope — what the hub says this session may reach, and which surfaces
 * that hides.
 *
 * ## Where the answer comes from
 *
 * `auth.me.scope` is the hub's OWN resolved answer, computed from the same
 * grants it enforces with. It carries counts and flags, never id lists: the
 * hub already filters every enumeration server-side, so a device outside the
 * session's reach simply never arrives here. Nothing in this module decides
 * whether a call succeeds — the hub does, and it refuses regardless of what the
 * viewer drew. What this module decides is whether drawing the control was
 * honest.
 *
 * ## The one rule
 *
 * A surface is hidden only on a CONFIRMED denial. Three states collapse to
 * UNKNOWN — `auth.me` still in flight, an older hub that does not send `scope`,
 * and a `scope` this build cannot parse — and UNKNOWN behaves exactly like the
 * build that shipped before scopes existed: everything is offered.
 *
 * Failing closed on unknown is the tempting choice and it is wrong twice over.
 * A hub that does not send `scope` has no scope enforcement either, so hiding
 * PTZ, linked-device actions and snooze there would remove working controls
 * from every user to mirror a gate that is not running. And on a hub that does
 * send it, the field arrives on the same connection that produces the camera
 * list — by the time there is a camera to draw a control over, the answer is
 * in.
 *
 * `isAdmin` is the exception and keeps failing closed: unknown ⇒ not admin.
 * That is the rule `useIsAdmin` already shipped with, and the surfaces behind
 * it (the D62 function switches) change state for the whole household.
 *
 * ## Why the grades are coarse
 *
 * The hub deliberately sends reach as `{ all, deviceCount }` and not a set of
 * ids, so this module cannot answer "may I actuate THIS camera". It answers
 * "may this session actuate anything", which is what a control gate needs: a
 * user with create on some cameras keeps the control everywhere and the hub
 * refuses the ones they do not hold — a 403 that {@link ../auth/forbidden.js}
 * logs rather than shouts about.
 *
 * Pure — no React, no I/O. The React binding is `use-user-scope.ts`.
 */
import {
  isSessionRole,
  parseViewerFeatures,
  type SessionRole,
  type ViewerFeatureId,
} from './viewer-features.js'

/** The three access flavours a grant can carry (mirrors the hub's `MethodAccess`). */
export type ScopeAccess = 'view' | 'create' | 'delete'

/** One capability/addon grant, flattened for the UI. */
export interface ScopeGrant {
  readonly name: string
  readonly access: readonly ScopeAccess[]
}

/** How far one access flavour reaches across the fleet. `all` outranks the
 *  count: a grant over everything still reads as reach on a fleet that is
 *  momentarily empty. */
export interface DeviceReach {
  readonly all: boolean
  readonly deviceCount: number
}

/** The hub's resolved effective scope for this session (`auth.me.scope`). */
export interface UserScope {
  readonly isAdmin: boolean
  /**
   * `admin`, `viewer`, or `scoped` (a person not yet converted to a role). A
   * hub older than roles sends none: the role is then derived from `isAdmin`
   * — `admin`, else `scoped`, which holds no feature, as before.
   */
  readonly role: SessionRole
  /** The named features a viewer holds; empty for every other role. */
  readonly features: readonly ViewerFeatureId[]
  readonly allDevicesViewable: boolean
  readonly viewableDeviceCount: number
  readonly device: Readonly<Record<ScopeAccess, DeviceReach>>
  readonly system: readonly ScopeAccess[]
  readonly capabilities: readonly ScopeGrant[]
  readonly addons: readonly ScopeGrant[]
}

/**
 * The grade a UI surface requires.
 *
 *  • `view`    — always drawn. The list it sits in is already filtered.
 *  • `actuate` — moves or changes a device: PTZ, linked-device actions,
 *                arm/disarm, "on motion", snooze.
 *  • `delete`  — destroys stored data: prune/delete recordings or events.
 *  • `admin`   — cluster-wide configuration: the D62 function switches, a
 *                snooze that mutes for everyone.
 */
export type SurfaceGrade = 'view' | 'actuate' | 'delete' | 'admin'

/** The scope reduced to the questions a component asks. */
export interface ScopeView {
  /** True once the hub has answered WITH a parseable scope. */
  readonly known: boolean
  readonly isAdmin: boolean
  /** May actuate at least one device (`device.create` reach). */
  readonly canActuate: boolean
  /** May destroy stored media/events for at least one device. */
  readonly canDelete: boolean
  /** Confirmed view reach and nothing beyond it. */
  readonly isViewer: boolean
  readonly viewableDeviceCount: number
  readonly allDevicesViewable: boolean
  /** The hub CONFIRMED this session can see no camera at all — the one case
   *  that earns its own empty state. Never true while the scope is unknown. */
  readonly hasNoViewableDevices: boolean
}

/**
 * What every grade resolves to before the hub has confirmed anything.
 *
 * Deliberately permissive for the non-admin grades — see the module docblock.
 */
export const UNKNOWN_SCOPE_VIEW: ScopeView = {
  known: false,
  isAdmin: false,
  canActuate: true,
  canDelete: true,
  isViewer: false,
  viewableDeviceCount: 0,
  allDevicesViewable: true,
  hasNoViewableDevices: false,
}

/**
 * An admin on a hub that sends no `scope`.
 *
 * `auth.me.isAdmin` is older than the scope model and has always been there,
 * so an admin is still KNOWN to be an admin on such a hub — dropping them to
 * {@link UNKNOWN_SCOPE_VIEW} would take the D62 function switches away from
 * exactly the person they exist for. `known` stays false because the reach
 * counts genuinely are unknown; only the admin verdict is confirmed.
 */
const ADMIN_UNSCOPED_VIEW: ScopeView = { ...UNKNOWN_SCOPE_VIEW, isAdmin: true }

// ── Wire parsing ────────────────────────────────────────────────────────────

function isScopeAccess(value: unknown): value is ScopeAccess {
  return value === 'view' || value === 'create' || value === 'delete'
}

function readObject(value: unknown): object | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

function readBoolean(source: object, key: string): boolean | null {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'boolean' ? value : null
}

function readCount(source: object, key: string): number | null {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function readReach(source: object, key: string): DeviceReach | null {
  const raw = readObject(Reflect.get(source, key))
  if (raw === null) return null
  const all = readBoolean(raw, 'all')
  const deviceCount = readCount(raw, 'deviceCount')
  if (all === null || deviceCount === null) return null
  return { all, deviceCount }
}

/** Unknown flavours are dropped, not fatal: a newer hub may grow a fourth. */
function readAccessList(source: object, key: string): readonly ScopeAccess[] {
  const value: unknown = Reflect.get(source, key)
  if (!Array.isArray(value)) return []
  return value.filter(isScopeAccess)
}

/** A malformed grant is dropped, not fatal — for the same reason. */
function readGrants(source: object, key: string): readonly ScopeGrant[] {
  const value: unknown = Reflect.get(source, key)
  if (!Array.isArray(value)) return []
  const out: ScopeGrant[] = []
  for (const entry of value) {
    const raw = readObject(entry)
    if (raw === null) continue
    const name: unknown = Reflect.get(raw, 'name')
    if (typeof name !== 'string') continue
    out.push({ name, access: readAccessList(raw, 'access') })
  }
  return out
}

/**
 * Parse `auth.me.scope`.
 *
 * Returns `null` — i.e. UNKNOWN, not "denied" — whenever the payload is absent
 * or its required core is malformed. A half-built scope would be indistinguish-
 * able from a real denial and would hide working controls on a parse bug.
 */
export function parseUserScope(raw: unknown): UserScope | null {
  const source = readObject(raw)
  if (source === null) return null

  const isAdmin = readBoolean(source, 'isAdmin')
  const allDevicesViewable = readBoolean(source, 'allDevicesViewable')
  const viewableDeviceCount = readCount(source, 'viewableDeviceCount')
  if (isAdmin === null || allDevicesViewable === null || viewableDeviceCount === null) return null

  const device = readObject(Reflect.get(source, 'device'))
  if (device === null) return null
  const view = readReach(device, 'view')
  const create = readReach(device, 'create')
  const remove = readReach(device, 'delete')
  if (view === null || create === null || remove === null) return null

  const wireRole: unknown = Reflect.get(source, 'role')
  const role: SessionRole = isSessionRole(wireRole) ? wireRole : isAdmin ? 'admin' : 'scoped'

  return {
    isAdmin,
    role,
    features: role === 'viewer' ? parseViewerFeatures(Reflect.get(source, 'features')) : [],
    allDevicesViewable,
    viewableDeviceCount,
    device: { view, create, delete: remove },
    system: readAccessList(source, 'system'),
    capabilities: readGrants(source, 'capabilities'),
    addons: readGrants(source, 'addons'),
  }
}

// ── Selectors ───────────────────────────────────────────────────────────────

function hasReach(reach: DeviceReach): boolean {
  return reach.all || reach.deviceCount > 0
}

/** Reduce a scope (or the absence of one) to the questions components ask. */
export function resolveScopeView(scope: UserScope | null): ScopeView {
  if (scope === null) return UNKNOWN_SCOPE_VIEW
  const canActuate = scope.isAdmin || hasReach(scope.device.create)
  const canDelete = scope.isAdmin || hasReach(scope.device.delete)
  return {
    known: true,
    isAdmin: scope.isAdmin,
    canActuate,
    canDelete,
    isViewer: !scope.isAdmin && !canActuate && !canDelete,
    viewableDeviceCount: scope.viewableDeviceCount,
    allDevicesViewable: scope.allDevicesViewable,
    hasNoViewableDevices: !scope.allDevicesViewable && scope.viewableDeviceCount === 0,
  }
}

/** The two fields of the session this module reads. */
export interface SessionScopeInput {
  /** `auth.me.isAdmin` — the top-level flag, present on every hub. */
  readonly isAdmin: boolean
  /** `auth.me.scope`, parsed; `null` on a hub that does not send one. */
  readonly scope: UserScope | null
}

/**
 * Resolve the view from the whole session, not the scope alone.
 *
 * The distinction matters in one case: a hub old enough to have no `scope` but
 * a session that `auth.me.isAdmin` says is an admin. Reading the scope alone
 * would demote them.
 */
export function resolveSessionScopeView(session: SessionScopeInput | null): ScopeView {
  if (session === null) return UNKNOWN_SCOPE_VIEW
  if (session.scope === null) return session.isAdmin ? ADMIN_UNSCOPED_VIEW : UNKNOWN_SCOPE_VIEW
  const view = resolveScopeView(session.scope)
  // A top-level flag and a scope that disagree: trust the ADMIN answer. The
  // two are computed from one value on the hub, so a disagreement is a bug —
  // and of the two ways to resolve it, demoting an admin is the one that
  // removes controls nobody else can reach.
  return session.isAdmin && !view.isAdmin
    ? { ...view, isAdmin: true, canActuate: true, canDelete: true, isViewer: false }
    : view
}

/** Whether a surface of this grade may be drawn. */
export function allowsGrade(view: ScopeView, grade: SurfaceGrade): boolean {
  switch (grade) {
    case 'view':
      return true
    case 'actuate':
      return view.canActuate
    case 'delete':
      return view.canDelete
    case 'admin':
      return view.isAdmin
    default: {
      // Every SurfaceGrade must be answered above; a new one fails to compile.
      const exhaustive: never = grade
      return exhaustive
    }
  }
}
