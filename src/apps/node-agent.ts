/**
 * node-agent — the Nodes list of the drawer and the way into a node's own UI
 * (the agent UI on port 4444), as pure rules.
 *
 * A node's UI is reached by a one-time unlock ticket minted by the hub; the app
 * redeems it itself (`POST /api/agent/session`) and seeds the tab session into
 * the page before it loads, so nothing secret is ever in a URL. The address is
 * picked the way the Admin's node card picks it, from the node's own LAN
 * addresses — which is why this is a local-network-only door.
 */
import type { NodeDirectory, NodeDirectoryEntry } from '@camstack/types'

export const AGENT_UI_PORT = 4444
/** The key the agent UI reads its tab session from. */
export const AGENT_SESSION_STORAGE_KEY = 'camstack_agent_ui_session'
/** The Admin's Nodes page, relative to the hub. */
export const ADMIN_NODES_PATH = '/system/nodes'

/** What the Nodes block of the drawer shows. */
export type NodeListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'could-not-read' }
  | {
      readonly kind: 'ready'
      readonly nodes: readonly NodeDirectoryEntry[]
      /** `false`: the history never answered, so offline nodes may be missing. */
      readonly complete: boolean
    }

export interface NodeListSource {
  readonly isPending: boolean
  readonly isError: boolean
  readonly data: NodeDirectory | undefined
}

/** Unanswered is `loading`, a failed read is `could-not-read` — never an empty list (D315). */
export function nodeListState(source: NodeListSource): NodeListState {
  if (source.data !== undefined) {
    return { kind: 'ready', nodes: orderNodes(source.data.nodes), complete: source.data.complete }
  }
  return source.isError && !source.isPending ? { kind: 'could-not-read' } : { kind: 'loading' }
}

/** The hub first, then online nodes, then offline; by name inside each. */
export function orderNodes(nodes: readonly NodeDirectoryEntry[]): readonly NodeDirectoryEntry[] {
  const rank = (n: NodeDirectoryEntry): number => (n.isHub ? 0 : n.isOnline ? 1 : 2)
  return [...nodes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** The hub's own UI is the Admin, so only an agent node gets a UI of its own here. */
export function nodeHasOwnUi(node: NodeDirectoryEntry): boolean {
  return !node.isHub && node.isOnline
}

function isDockerBridge(ip: string): boolean {
  return ip.startsWith('172.17.')
}

function isCarrierGradeNat(ip: string): boolean {
  const m = /^100\.(\d+)\./.exec(ip)
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127
}

function isPrivateLan(ip: string): boolean {
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  const m = /^172\.(\d+)\./.exec(ip)
  return m !== null && Number(m[1]) >= 16 && Number(m[1]) <= 31 && !isDockerBridge(ip)
}

/** A host safe to put in `http://{host}:4444/`. */
export function isAgentHost(host: string): boolean {
  const t = host.trim()
  return t.length > 0 && !/[/?#@:]/.test(t)
}

/** A LAN IPv4 of the node (loopback, link-local, docker bridge and CGNAT skipped), or `null`. */
export function pickAgentHost(localIps: readonly string[]): string | null {
  const v4 = localIps.filter((ip) => !ip.includes(':') && isAgentHost(ip))
  const lan = v4.find((ip) => !ip.startsWith('127.') && !ip.startsWith('169.254.') && !isCarrierGradeNat(ip) && isPrivateLan(ip))
  if (lan !== undefined) return lan
  return v4.find((ip) => !ip.startsWith('127.') && !ip.startsWith('169.254.') && !isDockerBridge(ip)) ?? null
}

export function agentBaseUrl(host: string): string {
  return `http://${host}:${AGENT_UI_PORT}/`
}

/** The unlock ticket from a mint answer, or `null`. */
export function parseTicket(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const ticket: unknown = Reflect.get(raw, 'ticket')
  return typeof ticket === 'string' && ticket.length > 0 ? ticket : null
}

/** The tab session token from `POST /api/agent/session`, or `null`. */
export function parseSessionToken(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const token: unknown = Reflect.get(raw, 'token')
  return typeof token === 'string' && token.length > 0 ? token : null
}

/** The script that seeds the redeemed session before the agent UI loads. */
export function sessionInjection(token: string): string {
  return `try { window.sessionStorage.setItem(${JSON.stringify(AGENT_SESSION_STORAGE_KEY)}, ${JSON.stringify(token)}); } catch (e) {} true;`
}

/** Why a node cannot be opened from here, in the order the user can fix it. */
export type NodeOpenBlock = 'off-lan' | 'no-address' | null

export function nodeOpenBlock(routeIsLocal: boolean, host: string | null): NodeOpenBlock {
  if (!routeIsLocal) return 'off-lan'
  return host === null ? 'no-address' : null
}
