/**
 * face-suggestion-dismiss-store — DEVICE-LOCAL persistence of the faceIds whose
 * "suggested identity" prompt the operator dismissed (tapped IGNORA). The server
 * has no dismiss cap method yet, so a dismissal is purely a client concern: we
 * remember it here so the suggestion stays hidden across navigation and app
 * restarts on THIS device only. A future server-side dismiss (a `faceGallery`
 * cap method) would make this cross-device — until then it is intentionally
 * local.
 *
 * Mirrors `camera-prefs-store`: the mutation logic is a set of *pure*, immutable
 * reducers (unit-tested in isolation); the zustand store is thin glue that holds
 * the value, applies a reducer, and persists to AsyncStorage. Loading is lazy
 * via `hydrate()` (idempotent). Corrupt storage degrades to an empty set, never
 * throwing.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'

/** AsyncStorage key for the persisted dismissed-faceId list. */
export const FACE_SUGGESTION_DISMISS_STORAGE_KEY = '@camstack/v2/face-suggestion-dismissed'

// ── Pure reducers / parsing (unit-tested) ─────────────────────────────────────

/** Add a faceId to the dismissed set, returning a NEW set (never mutates the
 *  input). Empty ids are ignored. Pure. */
export function addDismissedEntry(current: ReadonlySet<string>, faceId: string): Set<string> {
  const next = new Set(current)
  if (faceId.length > 0) next.add(faceId)
  return next
}

/** Parse persisted JSON (a string array) into a dismissed-faceId set. Never
 *  throws: corrupt/unknown storage degrades to an empty set; non-string / empty
 *  entries are dropped. Pure. */
export function parseDismissed(raw: string | null): Set<string> {
  if (!raw) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set()
  }
}

// ── zustand store (glue) ───────────────────────────────────────────────────────

interface FaceSuggestionDismissState {
  /** faceIds whose suggestion prompt is dismissed (device-local). */
  readonly dismissed: ReadonlySet<string>
  /** True once `hydrate()` has loaded persisted dismissals. */
  readonly hydrated: boolean
  hydrate: () => Promise<void>
  /** Dismiss a face's suggestion (idempotent). Persists best-effort. */
  dismiss: (faceId: string) => void
}

/** Persist the current set (serialised as a string array). Best-effort: a
 *  storage failure is logged but never blocks the in-memory update the operator
 *  already sees. */
function persist(dismissed: ReadonlySet<string>): void {
  void AsyncStorage.setItem(
    FACE_SUGGESTION_DISMISS_STORAGE_KEY,
    JSON.stringify([...dismissed]),
  ).catch((e: unknown) => {
    log.error('faces', 'face-suggestion-dismiss-store persist failed', { error: e instanceof Error ? e.message : String(e) })
  })
}

export const useFaceSuggestionDismissStore = create<FaceSuggestionDismissState>((set, get) => ({
  dismissed: new Set<string>(),
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const raw = await AsyncStorage.getItem(FACE_SUGGESTION_DISMISS_STORAGE_KEY)
      set({ dismissed: parseDismissed(raw), hydrated: true })
    } catch (e) {
      log.error('faces', 'face-suggestion-dismiss-store hydrate failed', { error: e instanceof Error ? e.message : String(e) })
      set({ hydrated: true })
    }
  },

  dismiss: (faceId) => {
    const dismissed = addDismissedEntry(get().dismissed, faceId)
    set({ dismissed })
    persist(dismissed)
  },
}))
