/**
 * useEventKindResolver — the shared "class id → translated label / taxonomy glyph"
 * resolver every event-kind surface should use, so the reel + events tiles render
 * the SAME translated labels the theater timeline already does (via ClusterCard's
 * `eventKindLabel(desc, t)`), instead of the raw English class id.
 *
 * It fetches the hub's event-kind descriptors (`pipelineAnalytics.listEventKinds`)
 * for a device set — the taxonomy is effectively global, so an omitted/empty set
 * falls back to ALL cameras — and exposes stable resolvers bound to the active
 * language. Unknown classes degrade to the raw id (label) / neutral glyph (icon),
 * matching the descriptor-driven fallbacks in `event-kind-icons`.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from '../lib/icons.js'
import { useCameras } from './use-cameras.js'
import { useEventKinds } from './use-event-kinds.js'
import { audioKindId, resolveEventKindIcon } from '../components/events/event-kind-icons.js'
import { resolveAudioLabelText, resolveEventLabelText } from './event-label-vocabulary.js'
import type { EventKindDescriptor } from './event-kinds.js'

export interface EventKindResolver {
  /** Translated label for a class id — its own `eventKind.<kind>` key, else its
   *  MACRO's, else the hub descriptor's English, else the raw id shown as-is.
   *  Never a bare key and never empty; see `event-label-vocabulary`. */
  readonly resolveLabel: (className: string) => string
  /** Taxonomy glyph for a class id (descriptor `iconId`), else the neutral fallback. */
  readonly resolveIcon: (className: string) => LucideIcon
  /**
   * Taxonomy glyph for a BARE audio-macro label (`dog`, `siren`, …). Audio
   * events persist the macro id un-namespaced, but the taxonomy + glyph dict
   * key audio subs under `audio-<id>` — so we prefix before resolving. This
   * hits the audio glyph (`audio-dog` → dog-in-audio-context) and never
   * collides with the VIDEO detection sub of the same bare id. Unmapped audio
   * labels fall back to the audio `Volume2` glyph, not the neutral `Tag`.
   */
  readonly resolveAudioIcon: (label: string) => LucideIcon
  /** Translated label for a BARE audio label (`dog`, `Bark`) — looked up
   *  namespaced (`audio-<id>`), resolved through the audio catalogs' macro when
   *  the raw classifier label has no key, and falling back to the BARE label. */
  readonly resolveAudioLabel: (label: string) => string
  /** The raw descriptor for a class id, when the taxonomy advertises it. */
  readonly descriptorFor: (className: string) => EventKindDescriptor | undefined
}

/**
 * Build an {@link EventKindResolver}. Pass a device set to scope the taxonomy
 * fetch; omit (or pass an empty set) to resolve across every camera.
 */
export function useEventKindResolver(deviceIds?: readonly number[]): EventKindResolver {
  const { t } = useTranslation()
  const { data: cameras } = useCameras()
  const allIds = useMemo(() => (cameras ?? []).map((c) => c.id), [cameras])
  // ALWAYS the global set, whatever the caller scoped to.
  //
  // The taxonomy is effectively global (see the module header), and the query
  // key is the id LIST — so a per-camera caller minted its own cache entry and
  // shared nothing. Measured: with one badge per card plus the reel's all-ids
  // fetch, `listEventKinds` ran roughly 2N times in the first minute on an
  // N-camera install, over a WebSocket with no batching link.
  //
  // Resolving against the global set is also strictly BETTER, not merely
  // cheaper: a scoped set that omits a class makes its label fall back to the
  // raw English id. `deviceIds` is kept in the signature because callers pass it
  // to express intent, and because a future taxonomy that genuinely differs per
  // device would need it back.
  void deviceIds
  const { data: descriptors } = useEventKinds(allIds)

  const kindById = useMemo(() => {
    const m = new Map<string, EventKindDescriptor>()
    for (const d of descriptors ?? []) m.set(d.kind, d)
    return m
  }, [descriptors])

  return useMemo<EventKindResolver>(() => {
    const lookup = (className: string): EventKindDescriptor | undefined =>
      kindById.get(className) ?? kindById.get(className.toLowerCase())
    return {
      descriptorFor: lookup,
      // The descriptor contributes its ENGLISH label and nothing else: its
      // `labelKey` is `eventKind.<kind>`, which the rule already tries first.
      // What the rule adds is every case the descriptor list does not cover —
      // a macro switched off, a batch still in flight, a raw classifier label —
      // where this used to answer with the raw id.
      resolveLabel: (className) => resolveEventLabelText(className, t, lookup(className)?.label),
      resolveIcon: (className) => {
        const d = lookup(className)
        return resolveEventKindIcon(d ? d.iconId : className.toLowerCase())
      },
      resolveAudioIcon: (label) => resolveEventKindIcon(audioKindId(label)),
      resolveAudioLabel: (label) =>
        resolveAudioLabelText(label, t, lookup(audioKindId(label))?.label),
    }
  }, [kindById, t])
}
