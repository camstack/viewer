import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source guards for D570 — a clip plays in the camera's OWN frame.
 *
 * Every assertion here exists because the easy version of this change is to
 * leave the modal where it is and add a second way in. Two ways to open one
 * thing is how the two diverge, and the modal's own failure (a live session
 * streaming behind a sheet) is invisible by construction — nobody can see the
 * thing that is still running.
 */
const SRC = join(process.cwd(), 'src')
const TIMELINE = join(SRC, 'components', 'camera', 'theater', 'TheaterTimeline.tsx')
const SCREEN = join(SRC, 'screens', 'CameraDetailScreen.tsx')
const STAGE = join(SRC, 'components', 'camera', 'clips', 'ClipStageView.tsx')
const MACHINE = join(SRC, 'recording', 'playback-machine.ts')

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the clip player is a SHEET, and it holds no opinion about the machine', () => {
  it('the screen owns it and mounts it at the ROOT, never inside the stream box', () => {
    // 1.0.512 mounted it inside `streamBox` with the machine held in a `clip`
    // mode. That mode removed the only brake on the go-live echo and wedged
    // the app on 3629. Until a clip can enter the broker's own recorded path,
    // a second player is honest and a mode is not.
    const src = code(SCREEN)
    expect(src).toContain('useClipStage')
    expect(src).toContain('ClipStageView')
    const box = src.slice(src.indexOf('const streamBox'))
    expect(box.slice(0, box.indexOf('const wallStage'))).not.toContain('ClipStageView')
  })

  it('renders in a Modal — a second player that says it is one', () => {
    expect(code(STAGE)).toContain('<Modal')
  })

  it('the timeline still mounts no clip player of its own', () => {
    const src = code(TIMELINE)
    expect(src).not.toContain('MediaViewerModal')
    expect(src).not.toContain('useClipPlayback')
  })

  it('still loops off the ROW’s decision, never a literal', () => {
    const src = code(STAGE)
    expect(src).toContain('repeat={stage.loop}')
    expect(src).not.toContain('repeat={true}')
  })

  it('the machine knows nothing about clips — no mode, no action, no flag', () => {
    // The strongest form of "the clips surface is not part of the playback
    // machine": the word does not appear in it. `go-live-terminator.spec.ts`
    // holds the behavioural half.
    const src = code(MACHINE)
    expect(src).not.toContain('CLIP_')
    expect(src).not.toContain("'clip'")
    expect(src).not.toContain('attachClip')
  })

  it('and the live gate has no clip branch either', () => {
    expect(code(join(SRC, 'live', 'battery-stream-gate.ts'))).not.toContain("'clip'")
  })
})

describe('the tile’s save control is the magnifier’s corner, and it never lies', () => {
  it('sits in the card’s existing actions row rather than a second corner', () => {
    const src = code(join(SRC, 'components', 'camera', 'theater', 'ClusterCard.tsx'))
    expect(src).toContain('onSaveClip')
    // The same row the lens uses — `styles.actions` / `styles.action`.
    const row = src.slice(src.indexOf('styles.actions'))
    expect(row.slice(0, 2_500)).toContain('onSaveClip')
    expect(row.slice(0, 2_500)).toContain('styles.action,')
  })

  it('never offers a download of a clip the provider refused', () => {
    const src = code(join(SRC, 'clips', 'clip-download.ts'))
    expect(src).toContain("kind: 'refused'")
    // And it is not hidden: hiding makes "cannot be served" and "this build has
    // no download" the same blank corner.
    expect(src).not.toContain('hidden')
  })
})
