import { z } from 'zod'

/** The addon that serves OUR recordings — what `provider` defaults to. */
export const RECORDING_PROVIDER_DEFAULT = 'recorder'

/** Injected as window.__CAMSTACK_RECORDING__ before the page loads (host-set). */
export const recordingConfigSchema = z.object({
  serverUrl: z.string().min(1),
  token: z.string().min(1),
  deviceId: z.number().int().nonnegative(),
  /** Initial playback start (epoch ms). 0 / absent ⇒ idle until the host seeks. */
  startMs: z.number().int().nonnegative().optional(),
  /**
   * WHICH source to play from — the addonId `recording.getPlayback` requires.
   *
   * Optional, and absence means OURS, the same rule the rest of the system
   * uses: a host that predates the D625 split keeps working unchanged, and a
   * host that lets the operator pick a source passes what they picked.
   */
  provider: z.string().min(1).optional(),
})

export type RecordingConfig = z.infer<typeof recordingConfigSchema>

export type RecordingConfigResult =
  | { readonly ok: true; readonly config: RecordingConfig }
  | { readonly ok: false; readonly error: string }

export function parseRecordingConfig(raw: unknown): RecordingConfigResult {
  if (raw === undefined || raw === null) return { ok: false, error: 'config is required' }
  const parsed = recordingConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, config: parsed.data }
}

export function readRecordingConfig(): RecordingConfigResult {
  const raw = (window as unknown as { __CAMSTACK_RECORDING__?: unknown }).__CAMSTACK_RECORDING__
  if (raw === undefined || raw === null)
    return { ok: false, error: 'window.__CAMSTACK_RECORDING__ is not set' }
  return parseRecordingConfig(raw)
}
