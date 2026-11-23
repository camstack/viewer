import { describe, expect, it } from 'vitest'

import {
  AGENT_SESSION_STORAGE_KEY,
  agentBaseUrl,
  nodeHasOwnUi,
  nodeListState,
  nodeOpenBlock,
  orderNodes,
  parseSessionToken,
  parseTicket,
  pickAgentHost,
  sessionInjection,
} from '../node-agent.js'

const hub = { id: 'hub', name: 'Hub', isHub: true, isOnline: true }
const online = { id: 'b', name: 'Beta', isHub: false, isOnline: true }
const offline = { id: 'a', name: 'Alpha', isHub: false, isOnline: false }

describe('the nodes list states', () => {
  it('unanswered is loading, a failed read is could-not-read, never an empty list (D315)', () => {
    expect(nodeListState({ isPending: true, isError: false, data: undefined })).toEqual({ kind: 'loading' })
    expect(nodeListState({ isPending: false, isError: true, data: undefined })).toEqual({ kind: 'could-not-read' })
  })

  it('an answer carries its completeness flag', () => {
    const state = nodeListState({ isPending: false, isError: false, data: { nodes: [offline, hub, online], complete: false } })
    expect(state).toEqual({ kind: 'ready', nodes: [hub, online, offline], complete: false })
  })

  it('orders the hub, online, then offline', () => {
    expect(orderNodes([offline, online, hub]).map((n) => n.id)).toEqual(['hub', 'b', 'a'])
  })

  it('only an online agent node has its own UI', () => {
    expect(nodeHasOwnUi(hub)).toBe(false)
    expect(nodeHasOwnUi(offline)).toBe(false)
    expect(nodeHasOwnUi(online)).toBe(true)
  })
})

describe('reaching a node', () => {
  it('picks a LAN IPv4, skipping loopback, link-local, docker bridge and CGNAT', () => {
    expect(pickAgentHost(['127.0.0.1', '172.17.0.2', '100.64.1.1', '169.254.3.3', 'fe80::1', '192.168.1.40'])).toBe('192.168.1.40')
    expect(pickAgentHost(['172.17.0.2', '127.0.0.1'])).toBeNull()
    expect(pickAgentHost([])).toBeNull()
  })

  it('refuses a host that could smuggle a path or credentials into the URL', () => {
    expect(pickAgentHost(['evil.example/x'])).toBeNull()
    expect(agentBaseUrl('192.168.1.40')).toBe('http://192.168.1.40:4444/')
  })

  it('says why a node cannot be opened, in the order it can be fixed', () => {
    expect(nodeOpenBlock(false, '192.168.1.40')).toBe('off-lan')
    expect(nodeOpenBlock(false, null)).toBe('off-lan')
    expect(nodeOpenBlock(true, null)).toBe('no-address')
    expect(nodeOpenBlock(true, '192.168.1.40')).toBeNull()
  })

  it('reads the ticket and the tab session from untrusted answers', () => {
    expect(parseTicket({ ticket: 't1' })).toBe('t1')
    expect(parseTicket({ ticket: '' })).toBeNull()
    expect(parseTicket('x')).toBeNull()
    expect(parseSessionToken({ token: 's1' })).toBe('s1')
    expect(parseSessionToken({})).toBeNull()
  })

  it('injects the session into tab storage before load, escaping the token', () => {
    const script = sessionInjection('a"b')
    expect(script).toContain(JSON.stringify(AGENT_SESSION_STORAGE_KEY))
    expect(script).toContain(JSON.stringify('a"b'))
  })
})
