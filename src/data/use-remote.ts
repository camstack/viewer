import { useCallback, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capMutateOrThrow, capQuery, isRecord } from './cap-query.js'
import {
  parseRemoteCommandList,
  remoteLayoutFromTemplates,
  type RemoteCommandList,
  type RemoteLayout,
} from '../components/camera/remote/remote-layout.js'

/**
 * The `remote` extension of a media player (an infrared TV): which roles a press
 * can reach, the layout to draw, and the press itself. Reads `remote.listCommands`
 * and `template.list` (both `protected`, so any signed-in viewer user), and sends
 * `remote.sendCommand`. A device with no `remote` answers `null` — the control
 * shows no Remote button, it does not claim the device has none.
 */

const REMOTE_STALE_MS = 60_000

/**
 * The bound commands of a device's remote; `null` while unanswered or when the device has no remote.
 * `rethrow` keeps a failed read as an error (the full-screen route). The sheet and the hero leave it
 * off, so a miss stays `null` and the row simply shows no Remote button.
 */
export function useRemoteCommands(
  deviceId: number,
  enabled: boolean,
  rethrow = false,
): UseQueryResult<RemoteCommandList | null> {
  const { controller, state } = useConnection()
  return useQuery<RemoteCommandList | null>({
    queryKey: rethrow ? ['v2', 'remote-commands', deviceId, 'strict'] : ['v2', 'remote-commands', deviceId],
    enabled: enabled && state === 'connected',
    staleTime: REMOTE_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'remote',
        'listCommands',
        { deviceId },
        rethrow ? { rethrow: true } : undefined,
      )
      return parseRemoteCommandList(raw)
    },
  })
}

/**
 * The remote layout linked to a device (`null` while unanswered, or when none is linked).
 * `rethrow` matches {@link useRemoteCommands}.
 */
export function useRemoteLayout(
  templateId: string | null,
  enabled: boolean,
  rethrow = false,
): UseQueryResult<RemoteLayout | null> {
  const { controller, state } = useConnection()
  return useQuery<RemoteLayout | null>({
    queryKey: rethrow ? ['v2', 'remote-layout', templateId, 'strict'] : ['v2', 'remote-layout', templateId],
    enabled: enabled && templateId !== null && state === 'connected',
    staleTime: REMOTE_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system || templateId === null) return null
      const raw = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'template',
        'list',
        { kind: 'remote' },
        rethrow ? { rethrow: true } : undefined,
      )
      return remoteLayoutFromTemplates(raw, templateId)
    },
  })
}

/** A press that went nowhere, as the hub typed it. */
export type RemotePressFailure =
  | 'no-remote'
  | 'unbound-role'
  | 'action-failed'
  | 'unknown-source'
  | 'unbound-step'
  | 'undeclared-channel'
  | 'press-timeout'
  | 'not-routed'
  | 'unreachable'

const REFUSALS: readonly RemotePressFailure[] = [
  'no-remote',
  'unbound-role',
  'action-failed',
  'unknown-source',
  'unbound-step',
  'undeclared-channel',
  'press-timeout',
]

/** The failure of a `remote.sendCommand` answer, or `null` when it was sent or skipped. */
export function pressFailureOf(raw: unknown): RemotePressFailure | null {
  if (!isRecord(raw)) return 'unreachable'
  if (raw.status === 'sent' || raw.status === 'skipped') return null
  if (raw.status === 'not-routed') return 'not-routed'
  if (raw.status === 'refused') return REFUSALS.find((r) => r === raw.reason) ?? 'action-failed'
  return 'unreachable'
}

export interface RemotePress {
  readonly press: (role: string) => Promise<void>
  /** Pick a declared source by its name (`remote.sendMediaCommand` `selectSource`). */
  readonly selectSource: (name: string) => Promise<void>
  readonly failure: RemotePressFailure | null
  /** The hub's own words for this failure, when it sent any. */
  readonly detail: string | null
}

function detailOf(raw: unknown): string | null {
  if (!isRecord(raw) || typeof raw.detail !== 'string' || raw.detail === '') return null
  return raw.detail
}

function thrownMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The typed sentence, then the hub's own words when it sent any. A line with no detail stays exact. */
export function remoteFailureText(line: string, detail: string | null): string {
  return detail === null || detail === '' ? line : `${line} ${detail}`
}

/** Press one role (`repeat: 1`); the typed refusal is kept for the sheet and the full-screen route to say. */
export function useRemotePress(deviceId: number): RemotePress {
  const { controller } = useConnection()
  const [failure, setFailure] = useState<RemotePressFailure | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const send = useCallback(
    async (method: 'sendCommand' | 'sendMediaCommand', input: Record<string, unknown>): Promise<void> => {
      const system = controller.getSystem()
      if (!system) {
        setFailure('unreachable')
        setDetail(null)
        return
      }
      try {
        const raw = await capMutateOrThrow(
          system.trpcClient as unknown as Record<string, unknown>,
          'remote',
          method,
          { deviceId, ...input },
        )
        const next = pressFailureOf(raw)
        setFailure(next)
        setDetail(next === null ? null : detailOf(raw))
      } catch (e: unknown) {
        setFailure('unreachable')
        setDetail(thrownMessage(e))
      }
    },
    [controller, deviceId],
  )
  const press = useCallback((role: string): Promise<void> => send('sendCommand', { role, repeat: 1 }), [send])
  const selectSource = useCallback(
    (name: string): Promise<void> => send('sendMediaCommand', { command: 'selectSource', source: name, repeat: 1 }),
    [send],
  )
  return { press, selectSource, failure, detail }
}
