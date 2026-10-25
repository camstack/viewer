/**
 * The login methods the hub offers (`auth.listLoginMethods`, a PUBLIC query),
 * and how a NATIVE app starts each one (D858). The hub says it per arm, in
 * `app`:
 *
 *   { kind: 'native' }              the app runs it itself (device certificate)
 *   { kind: 'browser', startPath }  the hub's dedicated app flow, in the system auth session
 *   null                            no app path: the app hides the arm
 *
 * A password has no arm and is always native. An arm with NO `app` field (a hub
 * that predates D858) has no app path either and is hidden: the app never
 * falls back to the admin-UI login.
 */
import { z } from 'zod'
import type { FetchLike } from '../auth/hub-auth-wire.js'

/** How the app starts an arm. `hidden` = `app: null`, or no `app` at all. */
export type AppStart =
  | { readonly kind: 'native' }
  | { readonly kind: 'browser'; readonly startPath: string }
  | { readonly kind: 'hidden' }

/** One arm as the login screen needs it. */
export interface LoginMethodView {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly stage: 'primary' | 'second-factor'
  readonly app: AppStart
  /** Which clients may use it (the device-certificate arm names them). */
  readonly clients: readonly string[]
}

const AppStartSchema = z.union([
  z.object({ kind: z.literal('native') }),
  z.object({ kind: z.literal('browser'), startPath: z.string() }),
])
const WireMethodSchema = z.looseObject({
  kind: z.string(),
  id: z.string(),
  label: z.string().optional(),
  stage: z.enum(['primary', 'second-factor']).optional(),
  clients: z.array(z.string()).optional(),
  app: z.unknown().optional(),
})
const WireEnvelopeSchema = z.object({ result: z.object({ data: z.object({ json: z.array(z.unknown()) }) }) })

function appStartOf(raw: unknown): AppStart {
  const parsed = AppStartSchema.safeParse(raw)
  return parsed.success ? parsed.data : { kind: 'hidden' }
}

export function viewsFromWire(items: readonly unknown[]): readonly LoginMethodView[] {
  const views: LoginMethodView[] = []
  for (const item of items) {
    const parsed = WireMethodSchema.safeParse(item)
    if (!parsed.success) continue
    const { kind, id, label, stage, clients, app } = parsed.data
    views.push({
      id,
      kind,
      label: label ?? id,
      stage: stage ?? 'primary',
      app: appStartOf(app),
      clients: clients ?? [],
    })
  }
  return views
}

/** A first-screen arm that opens in the system browser, with where it starts. */
export interface BrowserArm extends LoginMethodView {
  readonly startPath: string
}

/** Arms that become a button on the first screen: the hub's browser flows, shown once each. */
export function primaryBrowserArms(views: readonly LoginMethodView[]): readonly BrowserArm[] {
  const arms: BrowserArm[] = []
  for (const v of views) {
    if (v.stage === 'primary' && v.app.kind === 'browser') arms.push({ ...v, startPath: v.app.startPath })
  }
  return arms
}

/** Does the hub offer the device-certificate arm? */
export function offersDeviceCertificate(views: readonly LoginMethodView[]): boolean {
  return views.some((v) => v.kind === 'device-certificate')
}

/** The device-certificate arm, and this client (`native` | `web`) may use it. */
export function deviceCertificateUsableBy(views: readonly LoginMethodView[], client: 'native' | 'web'): boolean {
  return views.some((v) => v.kind === 'device-certificate' && v.clients.includes(client))
}

/** Ask the hub. `null` when it cannot say (an older hub, offline): the caller falls back. */
export async function fetchLoginMethods(
  serverUrl: string,
  fetchFn: FetchLike = fetch,
): Promise<readonly LoginMethodView[] | null> {
  try {
    const response = await fetchFn(`${serverUrl.replace(/\/+$/, '')}/trpc/auth.listLoginMethods`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    const envelope = WireEnvelopeSchema.safeParse(await response.json())
    return envelope.success ? viewsFromWire(envelope.data.result.data.json) : null
  } catch {
    return null
  }
}
