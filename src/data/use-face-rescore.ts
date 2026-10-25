/**
 * useFaceRescore — the "recompute the percentages" button's server side.
 *
 * A MUTATION, not a query, and deliberately: the operator asks the question at
 * a moment of their choosing (right after a batch of assignments), the answer
 * is only meaningful for that moment, and a query would re-fire it on focus and
 * on reconnect — spending a node round-trip whenever `reembed` is on. See
 * `face-rescore.ts` for why the number already on the track cannot answer this.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import {
  type FaceRescoreClient,
  type FaceRescoreInput,
  type FaceRescoreReport,
  makeFaceRescoreClient,
} from './face-rescore.js'

async function addonsCustomCall(
  trpcClient: unknown,
  args: { addonId: string; action: string; input: unknown },
): Promise<unknown> {
  const client = trpcClient as Record<string, unknown>
  const addons = client.addons
  const fn =
    typeof addons === 'object' || typeof addons === 'function'
      ? (addons as Record<string, unknown> | null)?.custom
      : undefined
  const mutate = fn != null ? (fn as { mutate?: unknown }).mutate : undefined
  if (typeof mutate !== 'function') throw new Error('addons.custom unavailable')
  return await (
    mutate as (i: { addonId: string; action: string; input: unknown }) => Promise<unknown>
  )(args)
}

function clientForTrpc(trpcClient: unknown): FaceRescoreClient {
  return makeFaceRescoreClient({
    addonsCustomMutate: (args) => addonsCustomCall(trpcClient, args),
  })
}

/** The raw client for the job follower; null while not connected. */
export function useFaceRescoreClient(): () => FaceRescoreClient | null {
  const { controller } = useConnection()
  return () => {
    const system = controller.getSystem()
    return system ? clientForTrpc(system.trpcClient) : null
  }
}

export type FaceRescoreMutation = UseMutationResult<FaceRescoreReport, Error, FaceRescoreInput>

export function useFaceRescore(): FaceRescoreMutation {
  const { controller } = useConnection()
  return useMutation<FaceRescoreReport, Error, FaceRescoreInput>({
    mutationFn: async (input) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      return await clientForTrpc(system.trpcClient).rescoreTrack(input)
    },
  })
}
