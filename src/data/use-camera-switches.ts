/**
 * use-camera-switches — the per-camera FUNCTION SWITCH group over the hub
 * ([D62](../../../camstack-server/docs/decisions/adr-0062.md)).
 *
 * `pipelineOrchestrator.getCameraSwitches` composes the group SERVER-side: one
 * bounded fan-out per camera over the four authorities that already owned these
 * functions (`deviceManager.setDisabled`, `setWrapperActive`,
 * `RecordingConfig.enabled`, the notification mute) plus the camera's own
 * microphone. The viewer stores nothing and derives nothing — it renders what
 * the hub resolved and writes back through `setCameraSwitch`, which routes each
 * flip to that same authority.
 *
 * That is the whole safety property, and it is the reason the old standalone
 * "take out of service" button was REPLACED by this group rather than parked
 * next to it: `stream-broker` IS `deviceManager.setDisabled`. Two controls onto
 * one authority is what D62 exists to prevent, and a viewer that kept both
 * would eventually show one on and the other off.
 *
 * ## Cadence
 *
 * A switch moves when a person moves it — a handful of times a month — so the
 * query polls on the app-wide reconcile backstop only, and the real freshness
 * comes from the mutation writing the server's answer straight into the cache
 * plus the live invalidation on `device.enabled` / `device.disabled` /
 * `capability.binding-changed`. `staleTime` is paired with the interval per the
 * rule in `reconcile.ts`; without it every screen re-entry would re-run a
 * five-source fan-out per camera over a WebSocket that does not batch.
 */
import { useMemo } from 'react'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { capMutateOrThrow, capQuery } from './cap-query.js'
import { RECONCILE_MS } from './reconcile.js'
import {
  applySwitchOptimistic,
  parseCameraSwitchGroup,
  switchedOffIds,
  type CameraSwitchGroupView,
} from './camera-switches.js'

/** Query-key root. Shared by the single-camera hook and the list fan-out so a
 *  camera opened from the list reuses the row the list already fetched. */
export const CAMERA_SWITCHES_KEY = 'camera-switches'

/** The key for ONE camera's group. */
export function cameraSwitchesKey(deviceId: number): readonly unknown[] {
  return ['v2', CAMERA_SWITCHES_KEY, deviceId]
}

/**
 * One camera's switch group.
 *
 * Rejects rather than returning null when the payload is unreadable: "the group
 * could not be read" and "this camera has no switches" are different answers
 * and D62 forbids rendering the second when the truth is the first — a guessed
 * group is how an operator learns a week later that a function was off.
 */
export function useCameraSwitches(
  deviceId: number,
  enabled = true,
): UseQueryResult<CameraSwitchGroupView> {
  const { controller, state } = useConnection()
  return useQuery<CameraSwitchGroupView>({
    queryKey: cameraSwitchesKey(deviceId),
    enabled: enabled && Number.isFinite(deviceId) && state === 'connected',
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'pipelineOrchestrator',
        'getCameraSwitches',
        { deviceId },
      )
      const group = parseCameraSwitchGroup(raw)
      if (group === null) throw new Error('camera switches unreadable')
      return group
    },
  })
}

export interface SetCameraSwitchInput {
  readonly switchId: string
  readonly enabled: boolean
}

/**
 * Flip one switch, optimistically, with a real revert.
 *
 * The optimistic write is not a nicety here: the authorities behind these
 * switches take a moment to settle (releasing brokers, detaching a recorder,
 * asking the camera itself about its microphone), and a toggle that sits at its
 * old value for a second reads as "the tap did not register" and gets tapped
 * again. So the row moves at once, the SERVER'S returned group replaces it on
 * success, and on failure the previous group is put back and the error is
 * surfaced — never swallowed. A switch that silently springs back is worse than
 * one that never moved: it tells the operator the camera is in a state it is
 * not.
 */
export function useSetCameraSwitch(
  deviceId: number,
): UseMutationResult<CameraSwitchGroupView, Error, SetCameraSwitchInput, CameraSwitchGroupView | undefined> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const key = cameraSwitchesKey(deviceId)

  return useMutation<CameraSwitchGroupView, Error, SetCameraSwitchInput, CameraSwitchGroupView | undefined>({
    mutationFn: async ({ switchId, enabled }) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capMutateOrThrow(
        system.trpcClient as unknown as Record<string, unknown>,
        'pipelineOrchestrator',
        'setCameraSwitch',
        { deviceId, switchId, enabled },
      )
      const group = parseCameraSwitchGroup(raw)
      // The mutation ANSWERS with the recomposed group. An unreadable answer is
      // a failed write as far as the operator is concerned — we do not know
      // what the camera is doing, so we must not draw a confident toggle.
      if (group === null) throw new Error('camera switches unreadable')
      return group
    },
    onMutate: async ({ switchId, enabled }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CameraSwitchGroupView>(key)
      if (previous !== undefined) {
        queryClient.setQueryData<CameraSwitchGroupView>(
          key,
          applySwitchOptimistic(previous, switchId, enabled),
        )
      }
      return previous
    },
    onError: (_error, _input, previous) => {
      // Put the operator's view back where the hub still has it.
      if (previous !== undefined) queryClient.setQueryData<CameraSwitchGroupView>(key, previous)
    },
    onSuccess: (group) => {
      queryClient.setQueryData<CameraSwitchGroupView>(key, group)
      // `stream-broker` writes `DeviceInfo.disabled`, and recording writes the
      // recording config — both are drawn by other surfaces from their own
      // queries, so one flip has to move all of them or the list and the panel
      // will disagree about the same camera.
      void queryClient.invalidateQueries({ queryKey: ['v2', 'cameras'] })
      void queryClient.invalidateQueries({ queryKey: ['v2', 'recording'] })
    },
  })
}

/** Per-camera switched-off ids, keyed by device id. */
export type SwitchedOffMap = Readonly<Record<number, readonly string[]>>

const EMPTY_MAP: SwitchedOffMap = Object.freeze({})

/**
 * The switched-off ids for a SCREEN of cameras.
 *
 * There is no batch procedure for this (unlike the badge aggregate), so this is
 * a genuine fan-out — which is why it polls on the reconcile backstop and
 * nothing faster, and why it shares `cameraSwitchesKey` with the single-camera
 * hook: opening a camera from the list costs no extra call, and flipping a
 * switch on the detail panel updates the list's badge through the same cache
 * entry.
 *
 * A camera whose group could not be read contributes NO ids — an unknown state
 * must not be badged as "switched off". The badge only ever claims something it
 * was told.
 */
export function useSwitchedOffMap(deviceIds: readonly number[], enabled: boolean): SwitchedOffMap {
  const { controller, state } = useConnection()
  const ids = useMemo(() => [...deviceIds].sort((a, b) => a - b), [deviceIds])
  const active = enabled && state === 'connected'

  const results = useQueries({
    queries: ids.map((deviceId) => ({
      queryKey: cameraSwitchesKey(deviceId),
      enabled: active,
      staleTime: RECONCILE_MS,
      refetchInterval: RECONCILE_MS,
      queryFn: async (): Promise<CameraSwitchGroupView> => {
        const system = controller.getSystem()
        if (!system) throw new Error('not connected')
        const raw: unknown = await capQuery(
          system.trpcClient as unknown as Record<string, unknown>,
          'pipelineOrchestrator',
          'getCameraSwitches',
          { deviceId },
        )
        const group = parseCameraSwitchGroup(raw)
        if (group === null) throw new Error('camera switches unreadable')
        return group
      },
    })),
    combine: (queries): SwitchedOffMap => {
      const byId: Record<number, readonly string[]> = {}
      for (const q of queries) {
        const group = q.data
        if (group === undefined) continue
        const off = switchedOffIds(group.switches)
        if (off.length > 0) byId[group.deviceId] = off
      }
      return Object.keys(byId).length === 0 ? EMPTY_MAP : byId
    },
  })

  return results
}
