/**
 * The hub's server name (D861). Pre-login the PUBLIC `auth.getServerName`
 * answers it; signed in, `system.info` carries the same shape. The name is
 * shown ONLY when the operator set one (`isDefault: false`); otherwise the app
 * keeps its host label. A hub that predates the method answers nothing usable:
 * that is `null`, silently — never an error surface.
 */
import { z } from 'zod'
import type { FetchLike } from '../auth/hub-auth-wire.js'
import { sameHubOrigin, serverDisplayName } from './hub-origin.js'

export const ServerNameSchema = z.object({ name: z.string(), isDefault: z.boolean() })
export type ServerNameInfo = z.infer<typeof ServerNameSchema>

const WireEnvelopeSchema = z.object({ result: z.object({ data: z.object({ json: ServerNameSchema }) }) })

/** The name worth showing, or `null` when it is the default / empty / unreadable. */
export function customServerName(raw: unknown): string | null {
  const parsed = ServerNameSchema.safeParse(raw)
  if (!parsed.success || parsed.data.isDefault) return null
  const name = parsed.data.name.trim()
  return name.length > 0 ? name : null
}

/** Ask the hub (public query). `null` for an old hub, offline, or an unreadable answer. */
export async function fetchServerName(serverUrl: string, fetchFn: FetchLike = fetch): Promise<ServerNameInfo | null> {
  try {
    const response = await fetchFn(`${serverUrl.replace(/\/+$/, '')}/trpc/auth.getServerName`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    const envelope = WireEnvelopeSchema.safeParse(await response.json())
    return envelope.success ? envelope.data.result.data.json : null
  } catch {
    return null
  }
}

/** The custom name the hub has, or `null` (default name, old hub, offline). */
export async function fetchCustomServerName(serverUrl: string, fetchFn: FetchLike = fetch): Promise<string | null> {
  return customServerName(await fetchServerName(serverUrl, fetchFn))
}

interface NamedServer {
  readonly serverUrl: string
  readonly name?: string
}

/** What a saved server is called on screen: its custom hub name, else the host. */
export function serverLabelOf(server: NamedServer): string {
  return server.name !== undefined && server.name !== '' ? server.name : serverDisplayName(server.serverUrl)
}

/** The label for a URL: a saved server with that origin lends its name, else the host. */
export function serverLabelForUrl(servers: readonly NamedServer[], url: string): string {
  const known = servers.find((s) => sameHubOrigin(s.serverUrl, url))
  return known !== undefined ? serverLabelOf(known) : serverDisplayName(url)
}
