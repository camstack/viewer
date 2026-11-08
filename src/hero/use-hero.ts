/**
 * use-hero — the hub's hero model for the viewer: ONE batch for a list of rows,
 * one model for a detail, and the call a hero control sends.
 *
 * `hero-layout.getRowModels` answers a whole room in one request (≤ 500 ids,
 * `null` per unknown device), so a list never asks per device. Both reads carry
 * the session's `canActuate`: the hub lists what this session must not see in
 * `gated` and the row model leaves that control out.
 *
 * Actuation does not change: a hero control names `{ cap, method, args }`, the
 * same cap method the old per-type control called. After a call the hero
 * queries are invalidated so the state is read back, not assumed.
 */
import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { HeroAction, HeroModel, HeroRowModel } from '@camstack/types'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from '../data/cap-query.js'
import { useCapMutator } from '../data/use-accessory-controls.js'
import { RECONCILE_MS } from '../data/reconcile.js'
import { parseHeroModel, parseHeroRowModels } from './hero-parse.js'
import { capRouterKey } from './hero-view.js'

/** The hub accepts at most this many ids per `getRowModels`. */
export const HERO_ROW_MODELS_MAX = 500
const HERO_CAP_KEY = 'heroLayout'
const HERO_QUERY_ROOT = ['v2', 'hero'] as const

/** Ids in a stable order, deduplicated and capped: the cache key and the request. */
export function rowIdsKey(deviceIds: readonly number[]): readonly number[] {
  return [...new Set(deviceIds)].sort((a, b) => a - b).slice(0, HERO_ROW_MODELS_MAX)
}

export interface HeroRowModels {
  /** The model of a device, or `null` (unknown to the hub, unreadable, or not asked for). */
  readonly byId: ReadonlyMap<number, HeroRowModel>
}

const EMPTY_ROWS: HeroRowModels = { byId: new Map() }

/** One request for every row of a list. `data` is `undefined` until the hub has answered. */
export function useHeroRowModels(
  deviceIds: readonly number[],
  canActuate: boolean,
): UseQueryResult<HeroRowModels> {
  const { controller, state } = useConnection()
  const ids = useMemo(() => rowIdsKey(deviceIds), [deviceIds])
  return useQuery<HeroRowModels>({
    queryKey: [...HERO_QUERY_ROOT, 'rows', ids, canActuate],
    enabled: state === 'connected' && ids.length > 0,
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY_ROWS
      const raw = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        HERO_CAP_KEY,
        'getRowModels',
        { deviceIds: ids, canActuate },
        { rethrow: true },
      )
      const models = parseHeroRowModels(raw)
      const byId = new Map<number, HeroRowModel>()
      models.forEach((model, index) => {
        const id = ids[index]
        if (model !== null && id !== undefined) byId.set(id, model)
      })
      return { byId }
    },
  })
}

/** The full hero model of one device; `null` when the hub does not know it. */
export function useHeroModel(deviceId: number, canActuate: boolean): UseQueryResult<HeroModel | null> {
  const { controller, state } = useConnection()
  return useQuery<HeroModel | null>({
    queryKey: [...HERO_QUERY_ROOT, 'model', deviceId, canActuate],
    enabled: state === 'connected',
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        HERO_CAP_KEY,
        'getHeroModel',
        { deviceId, canActuate },
        { rethrow: true },
      )
      return parseHeroModel(raw)
    },
  })
}

export interface HeroCaller {
  readonly pending: boolean
  readonly error: string | null
  /** Send a hero action's cap call (the device id is added), then re-read the hero. */
  readonly runAction: (action: HeroAction) => Promise<void>
  /** Send a value to a slider / picker's call. */
  readonly runValue: (call: { cap: string; method: string; valueArg: string }, value: string | number) => Promise<void>
}

export function useHeroCaller(deviceId: number): HeroCaller {
  const mutator = useCapMutator(deviceId)
  const queryClient = useQueryClient()
  const reread = useCallback(
    () => queryClient.invalidateQueries({ queryKey: HERO_QUERY_ROOT }),
    [queryClient],
  )
  const runAction = useCallback(
    async (action: HeroAction): Promise<void> => {
      await mutator.run(capRouterKey(action.call.cap), action.call.method, action.call.args)
      await reread()
    },
    [mutator, reread],
  )
  const runValue = useCallback(
    async (call: { cap: string; method: string; valueArg: string }, value: string | number): Promise<void> => {
      await mutator.run(capRouterKey(call.cap), call.method, { [call.valueArg]: value })
      await reread()
    },
    [mutator, reread],
  )
  return { pending: mutator.pending, error: mutator.error, runAction, runValue }
}
