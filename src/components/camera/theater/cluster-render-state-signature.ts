/**
 * The key that decides when `theater:clusters render state` is written.
 *
 * The line carries the data the timeline drew from (event count and range,
 * zone filter outcome, cluster and activity counts, day window). The effect
 * that writes it re-runs on layout changes too (card width, zoom, size), which
 * used to log a fresh line each time. The signature holds the DATA fields only:
 * geometry and scroll-dependent counts stay on the line as context, but a
 * layout recompute alone writes nothing.
 */
export interface ClusterRenderStateInputs {
  readonly deviceId: string | number
  readonly objectEvents: number
  readonly objectEventRange: { readonly first: string; readonly last: string } | null
  readonly zone: unknown
  readonly clusters: number
  readonly activity: { readonly recording: number; readonly motion: number; readonly audio: number }
  readonly dayWindow: unknown
}

export function clusterRenderStateSignature(inputs: ClusterRenderStateInputs): string {
  return JSON.stringify([
    inputs.deviceId,
    inputs.objectEvents,
    inputs.objectEventRange,
    inputs.zone,
    inputs.clusters,
    inputs.activity.recording,
    inputs.activity.motion,
    inputs.activity.audio,
    inputs.dayWindow,
  ])
}
