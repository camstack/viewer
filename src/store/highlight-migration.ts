/**
 * highlight-migration — the storage half of the one-time move of the per-camera
 * highlight into the global document (`highlight-global.ts` holds the rule).
 *
 * Reads the raw camera-prefs blob of the bound hub (the typed store no longer
 * knows a `highlight` field) and the old overlay master switch, folds them into
 * `AppSettings.highlight`, and stamps it. Runs after the settings hydrate; a
 * stamped document makes every later run a no-op.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { parseOverlayConfig } from '../components/camera/overlay/overlay-config.js'
import { OVERLAY_CONFIG_STORAGE_KEY } from './overlay-config-store.js'
import { CAMERA_PREFS_STORAGE_KEY } from './camera-prefs-store.js'
import { foldLegacyHighlight, type LegacyHighlight } from './highlight-global.js'
import { scopedStorageKey } from './server-scope.js'
import { useSettingsStore } from './settings-store.js'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Every highlight blob a camera-prefs document carries, in camera-id order. */
export function legacyHighlightsOf(rawPrefs: unknown): readonly LegacyHighlight[] {
  if (!isRecord(rawPrefs) || !isRecord(rawPrefs.byId)) return []
  return Object.keys(rawPrefs.byId)
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((id) => {
      const pref = (rawPrefs.byId as Record<string, unknown>)[id]
      return isRecord(pref) && isRecord(pref.highlight) ? [pref.highlight as LegacyHighlight] : []
    })
}

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

/** Fold once; no-op when the document is already stamped. */
export async function runHighlightMigrationOnce(): Promise<void> {
  const state = useSettingsStore.getState()
  const serverId = state.accountServerId
  if (serverId === null || state.settings.highlight.rev > 0) return
  const prefs = await readJson(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, serverId))
  const overlayRaw = await readJson(scopedStorageKey(OVERLAY_CONFIG_STORAGE_KEY, serverId))
  const overlay = parseOverlayConfig(overlayRaw)
  const masterOff = overlay.legacyMasterOff || overlay.highlightDefaultOff
  // Re-read: a settings write may have landed during the awaits above.
  const current = useSettingsStore.getState().settings.highlight
  const next = foldLegacyHighlight(current, legacyHighlightsOf(prefs), masterOff)
  if (next !== current) useSettingsStore.getState().patchHighlight(next)
}
