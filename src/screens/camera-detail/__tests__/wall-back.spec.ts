/**
 * The ONE "back" while a wall is up (#700): collapse first, leave second.
 */
import { describe, expect, it, vi } from 'vitest'

import { createLeave } from '../wall-back.js'

function actions(showing: boolean) {
  const state = { showing }
  const collapseWall = vi.fn(() => {
    state.showing = false
  })
  const leaveCamera = vi.fn()
  return { state, collapseWall, leaveCamera, leave: createLeave({ wallShowing: () => state.showing, collapseWall, leaveCamera }) }
}

describe('createLeave', () => {
  it('with a wall up, back collapses it and does NOT leave the camera', () => {
    const a = actions(true)
    a.leave()
    expect(a.collapseWall).toHaveBeenCalledTimes(1)
    expect(a.leaveCamera).not.toHaveBeenCalled()
  })

  it('with no wall, back leaves the camera', () => {
    const a = actions(false)
    a.leave()
    expect(a.leaveCamera).toHaveBeenCalledTimes(1)
    expect(a.collapseWall).not.toHaveBeenCalled()
  })

  it('two presses in a row: collapse, then leave', () => {
    const a = actions(true)
    a.leave()
    a.leave()
    expect(a.collapseWall).toHaveBeenCalledTimes(1)
    expect(a.leaveCamera).toHaveBeenCalledTimes(1)
  })

  it('reads the wall at CALL time, so a stale closure cannot collapse a gone wall', () => {
    const a = actions(true)
    a.state.showing = false
    a.leave()
    expect(a.collapseWall).not.toHaveBeenCalled()
    expect(a.leaveCamera).toHaveBeenCalledTimes(1)
  })
})
