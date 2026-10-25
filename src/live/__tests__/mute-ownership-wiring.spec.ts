import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Mute ownership — the wiring, pinned at the source.
 *
 * A camera that speaks when it was told to be silent is a privacy defect, and
 * this one shipped twice: first because the injected mute script ran only when
 * the `muted` PROP changed (a replaced <video> was born unmuted and nothing
 * re-asserted the silence), then again because recorded playback's audio never
 * touches a <video> at all — it is PCM scheduled into an AudioContext inside
 * the embed, reachable ONLY through the `__camstackEmbed.setMuted` handoff to
 * the embed's own muted state (which gates the recorded audio pipeline's gain).
 * The first fix shipped without a guard, which is part of why it came back.
 *
 * The viewer cannot mount components (vitest runs `node`, no renderer — see
 * `docs/roadmap.md`), so these are source assertions in the style of
 * `theater/__tests__/zone-shape-wiring.spec.ts`. The embed-side halves are
 * guarded in camstack-server: `embed/src/playback/__tests__/audio-pipeline.spec.ts`,
 * `embed/src/playback/__tests__/webcodecs-playback-tier.spec.ts` and
 * `embed/src/pages/__tests__/recorded-mute-wiring.spec.ts`.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('in-place camera swap carries the live target', () => {
  const src = read('live/LiveViewWebView.tsx')

  it('setDevice includes target so a quality pick survives the remount', () => {
    // Absent target ⇒ the page keeps the boot-time adaptive dial while the
    // quality chip still shows High.
    expect(src).toContain("kind: 'setDevice'")
    expect(src).toContain("target.kind === 'profile'")
    expect(src).toContain("kind: 'adaptive'")
  })
})

describe('mute reaches every audio surface (iOS/native WebView player)', () => {
  const src = read('live/LiveViewWebView.tsx')

  it('the injected script writes the live element directly AND hands mute to the embed owner', () => {
    // Direct write: silences the CURRENT <video> immediately.
    expect(src).toContain('v.muted=${m}')
    // Handoff: the ONLY route to replacement elements, the embed enforcer, and
    // recorded (AudioContext) audio. Dropping it re-opens the playback leak.
    expect(src).toContain('window.__camstackEmbed.setMuted&&window.__camstackEmbed.setMuted(${m})')
  })

  it('the mute effect re-asserts on element replacement, not only on the muted value', () => {
    // `target` (make-before-break stream swap) and `state` (new stream attach)
    // are deliberate deps: a fresh <video> is born unmuted, the HTML default.
    expect(src).toContain('}, [muted, target, state])')
  })
})

describe('mute reaches every audio surface (web iframe player)', () => {
  const src = read('live/LiveView.web.tsx')

  it('a mute change is posted to the embed (same owner, postMessage transport)', () => {
    expect(src).toContain("postCommand({ kind: 'setMuted', value: muted }), [muted, postCommand])")
  })

  it('the embed boot config carries the muted value for a fresh page', () => {
    // A remount (liveReloadKey / go-live) builds a new embed; the config seed is
    // what makes it start silent instead of waiting for the first toggle.
    expect(src).toContain('muted,')
  })
})

describe('the screen owns ONE muted state for both live and recorded', () => {
  const src = read('screens/CameraDetailScreen.tsx')

  it('audio-on-open is applied exactly once per session, then the user owns the toggle', () => {
    expect(src).toContain('audioApplied.current = true')
    // The MODE, resolved against this camera's memory — never the raw setting.
    // `audioOnOpen` stopped being a boolean on 2026-09-15 (`on` / `off` /
    // `last-selected`), and `!mode` would be `false` for all three: every
    // camera would open speaking, including the ones an operator had silenced.
    expect(src).toContain('setMuted(opensMuted(settings.stream.audioOnOpen, storedAudioOn))')
    expect(src).not.toContain('setMuted(!settings.stream.audioOnOpen)')
  })

  it('the opening mute waits for the per-camera memory, not only for settings', () => {
    // `last-selected` read against an unhydrated camera-prefs store says
    // "never chosen" for every camera, so a cold start would silently ignore
    // the operator's last choice on all of them.
    expect(src).toContain('if (hydrated && prefsHydrated && !audioApplied.current)')
  })

  it('stream quality restore waits for the same per-camera hydration', () => {
    // Without `prefsHydrated` a cold start marked the default `auto` applied
    // against an empty store and never re-read the remembered High.
    expect(src).toContain('if (!prefsHydrated || qualityApplied.current) return')
  })

  it('a camera SWAP re-resolves the mode; it does not just force silence', () => {
    // The swap is an open. `setMuted(true)` there made `last-selected` mean
    // "muted" for every camera after the first.
    expect(src).not.toContain('setServedTier(null)\n    setMuted(true)')
  })

  it('ONLY the manual toggle writes the remembered choice', () => {
    // Remembering an automatic mute would make the memory a copy of the last
    // RESOLUTION rather than the last decision, and `last-selected` would
    // decay into "muted".
    // Exactly ONE call site in the whole screen.
    expect(src.split('setCameraAudioOn(').length - 1).toBe(1)
    expect(src).toContain('setCameraAudioOn(deviceId, !next)')
  })

  it('the single muted state feeds the player prop', () => {
    expect(src).toContain('muted={muted}')
  })
})
