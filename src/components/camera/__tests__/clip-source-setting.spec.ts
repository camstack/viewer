import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GRID_ROW_OWNER, ROW_GROUP, VIEW_OPTION_ROWS, isRowVisible } from '../../../grid/view-options-scope.js'

const SRC = join(process.cwd(), 'src')
const SURFACE = join(SRC, 'components', 'camera', 'CameraViewOptionsSurface.tsx')
const ROW = join(SRC, 'components', 'camera', 'ClipSourceRow.tsx')

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the clip-source setting is a row of the camera’s own menu', () => {
  it('is registered in the ONE scope list both menus render from', () => {
    // A row added to the surface and not to the registry is a row that silently
    // appears in a grid cell as well — which is the "one picture, two controls,
    // two documents" duplication `view-options-scope` exists to end.
    expect(VIEW_OPTION_ROWS).toContain('clipSource')
  })

  it('sits under the TIMELINE heading, beside the other clip control', () => {
    // The clips list IS the timeline in clips mode. A "Clips" heading of its
    // own would split one question in two — the mistake D557 § 1 corrected on
    // the admin side by folding its clips tab into Recording.
    expect(ROW_GROUP.clipSource).toBe('timeline')
  })

  it('is owned by the CELL on a wall, never by the bar', () => {
    // `clusterLabel` is the bar's because one band serves every tile. A clip
    // source is the opposite: it is per camera by the operator's own rule
    // ("come provider di quella camera"), and a wall-wide pick would set 24
    // cameras to a source only one of them has.
    expect(GRID_ROW_OWNER.clipSource).toBe('cell')
  })

  it('is drawn on a single camera and in a grid cell alike', () => {
    expect(isRowVisible('clipSource', 'single')).toBe(true)
    expect(isRowVisible('clipSource', 'grid-cell')).toBe(true)
  })
})

describe('the picker writes the preference and NOTHING else', () => {
  it('stores the pick in the per-camera prefs document', () => {
    expect(code(ROW)).toContain('useCameraClipProvider')
  })

  it('never writes a hub authority', () => {
    // Sources are not enabled or disabled here: each exists because of a
    // configuration that lives somewhere else, and a second knob over somebody
    // else's decision is what D557 § 3 rejected by name. This picker chooses
    // what to LOOK at.
    const src = code(ROW)
    expect(src).not.toContain('setWrapperActive')
    expect(src).not.toContain('setCameraSwitch')
    expect(src).not.toContain('useMutation')
  })

  it('offers the sources the HUB listed, never a hard-coded pair', () => {
    const src = code(ROW)
    expect(src).toContain('clipSourcePickerOptions')
    expect(src).not.toContain("'native:reolink:onboard'")
    expect(src).not.toContain("'provider-reolink'")
  })

  it('is the shared select row, not a control of its own', () => {
    // "non componenti nuovi anonimi" — the operator, about the admin side, and
    // it is the same rule here: the repo has a themed, tested select row.
    expect(code(ROW)).toContain('SelectRow')
  })

  it('draws nothing while the camera’s sources are unknown', () => {
    // An empty or single-entry picker reads as a defect, and the fix would then
    // be looked for in the UI rather than in the binding store where it is
    // (D557 § 4). Not-yet-known must never look like not-installed (D315).
    expect(code(ROW)).toContain('options.length < 2')
  })

  it('is mounted by the ONE per-camera surface', () => {
    expect(code(SURFACE)).toContain('ClipSourceRow')
    expect(code(SURFACE)).toContain("isRowVisible('clipSource', context)")
  })
})
