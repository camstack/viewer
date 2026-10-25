import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cameraClipProvider,
  parseCameraPrefs,
  resetCameraPrefsEntry,
  setCameraClipProviderEntry,
  setLocalNameEntry,
} from '../camera-prefs-store.js'

const STORE = join(process.cwd(), 'src', 'store', 'camera-prefs-store.ts')

/** Strip block and line comments — a guard polices CODE, not prose that merely
 *  names the thing it forbids (the same rule `clip-surface-wiring.spec.ts` has). */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('setCameraClipProviderEntry', () => {
  it('stores the SOURCE id the operator picked', () => {
    // The finer grain, and the thing his label says. The addon that serves it
    // comes off the `listSources` row at read time — a source→addon table in
    // the app would be a second authority on provider identity (D557).
    const prefs = setCameraClipProviderEntry(resetCameraPrefsEntry(), 107, 'native:reolink:onboard')
    expect(cameraClipProvider(prefs, 107)).toBe('native:reolink:onboard')
  })

  it('stores ABSENCE for the default, so a camera merely looked at carries no document', () => {
    const chosen = setCameraClipProviderEntry(resetCameraPrefsEntry(), 107, 'native:reolink:onboard')
    const cleared = setCameraClipProviderEntry(chosen, 107, undefined)
    expect(cameraClipProvider(cleared, 107)).toBeUndefined()
    expect(cleared.byId[107]).toBeUndefined()
  })

  it('is per camera — never a global one', () => {
    // "Mai mischiate provider diversi" is a rule about one camera at a time,
    // and 592 keeping its SD card says nothing about 3628.
    const prefs = setCameraClipProviderEntry(resetCameraPrefsEntry(), 107, 'native:reolink:onboard')
    expect(cameraClipProvider(prefs, 3628)).toBeUndefined()
  })

  it('leaves this camera’s other settings alone', () => {
    const named = setLocalNameEntry(resetCameraPrefsEntry(), 107, 'Garden')
    const next = setCameraClipProviderEntry(named, 107, 'analytics')
    expect(next.byId[107]?.localName).toBe('Garden')
    expect(next.byId[107]?.clipProvider).toBe('analytics')
  })

  it('does not mutate the document it was given', () => {
    const before = resetCameraPrefsEntry()
    setCameraClipProviderEntry(before, 107, 'analytics')
    expect(before.byId[107]).toBeUndefined()
  })

  it('treats an empty or blank pick as no pick', () => {
    const prefs = setCameraClipProviderEntry(resetCameraPrefsEntry(), 107, '   ')
    expect(cameraClipProvider(prefs, 107)).toBeUndefined()
  })
})

describe('the stored pick survives a restart', () => {
  it('round-trips through the AsyncStorage document', () => {
    const prefs = setCameraClipProviderEntry(resetCameraPrefsEntry(), 107, 'native:reolink:onboard')
    const reloaded = parseCameraPrefs(JSON.stringify(prefs))
    expect(cameraClipProvider(reloaded, 107)).toBe('native:reolink:onboard')
  })

  it('keeps a source id this build has never heard of', () => {
    // Open vocabulary: the hub owns it. A pick this release does not recognise
    // must not be scrubbed on load — the operator made it, and the rows it is
    // checked against arrive from the hub, not from this bundle.
    const prefs = setCameraClipProviderEntry(resetCameraPrefsEntry(), 107, 'native:hikvision:onboard')
    const reloaded = parseCameraPrefs(JSON.stringify(prefs))
    expect(cameraClipProvider(reloaded, 107)).toBe('native:hikvision:onboard')
  })

  it('drops a stored pick that is not a string', () => {
    const reloaded = parseCameraPrefs(JSON.stringify({ byId: { 107: { clipProvider: 42 } }, order: [] }))
    expect(cameraClipProvider(reloaded, 107)).toBeUndefined()
  })
})

describe('the multi-source VIEW FILTER is gone', () => {
  it('the store holds one provider per camera, never a list of sources', () => {
    // `clipSources` was a DENY list for a fan-out surface (`ClipSourceChips`)
    // that was deleted, and it never had a reader again. The operator has since
    // settled the opposite contract — *"la sorgente … come provider di quella
    // camera. Mai mischiate provider diversi"* — and `listClips` now takes ONE
    // `provider`. A leftover that describes the right design for a retired
    // contract reads as verification, so it goes rather than sits unused.
    const src = code(STORE)
    expect(src).not.toContain('clipSources')
    expect(src).not.toContain('toggleCameraClipSource')
    expect(src).not.toContain('normalizeClipSources')
  })

  it('this store still writes NO hub state', () => {
    // D62: a per-camera switch stores nothing of its own — it writes the
    // authority that already owned the function. This is not that: it is which
    // of a camera's EXISTING sources this viewer is looking at, the same kind
    // of per-installation choice as `quality` and `audioOn`. Turning a source
    // on or off is somebody else's decision on somebody else's surface, and
    // D557 § 3 rejected a second knob over it — so this must never grow a
    // `setWrapperActive`.
    const src = code(STORE)
    expect(src).not.toContain('setWrapperActive')
    expect(src).not.toContain('trpc')
  })
})
