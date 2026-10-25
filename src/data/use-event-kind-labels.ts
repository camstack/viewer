/**
 * useEventKindLabels — the app's TRANSLATED event taxonomy as a plain
 * dictionary, for a consumer that cannot call a resolver function.
 *
 * `useEventKindResolver` answers "what is this one class called?" for a surface
 * that names one class at a time. The shared row logic (`shared/events`:
 * `resolveRowTitle`, `kindLabelFor`) takes the whole `kind → label` map instead,
 * so it can run identically in the app and in the browser embed (see
 * `events/kind-labels.ts` for why that dictionary has to exist at all).
 *
 * The taxonomy fetch is the SAME query the resolver uses — the global camera set
 * and `useEventKinds`' 60 s cache — so adding this hook beside a resolver on the
 * same screen costs no extra round trip.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCameras } from './use-cameras.js'
import { useEventKinds } from './use-event-kinds.js'
import { kindLabelsFromDescriptors } from '../events/kind-labels.js'

/** `{ '<kind>': '<translated label>' }`. EMPTY while the taxonomy is in flight
 *  — an embed with no dictionary renders the raw id, never a blank. */
export function useEventKindLabels(): Readonly<Record<string, string>> {
  const { t } = useTranslation()
  const { data: cameras } = useCameras()
  // The taxonomy is effectively global; resolving against the whole set is what
  // keeps a per-camera caller from minting its own cache entry (see
  // `use-event-kind-resolver` for the measured cost of not doing this).
  const allIds = useMemo(() => (cameras ?? []).map((camera) => camera.id), [cameras])
  const { data: descriptors } = useEventKinds(allIds)

  // Rebuilt when `t` changes identity — which is exactly what a language
  // switch does, and the event the embed's `kindLabels` patch exists for.
  return useMemo(() => kindLabelsFromDescriptors(descriptors, t), [descriptors, t])
}
